import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingError } from "@/lib/booking-error";
import { resolveBusinessDate } from "@/lib/business-date";
import { addMinutesToTime, combineAppointmentDateTime, rateForDate } from "@/lib/spa";
import { computeSlotsForDay, dayStart, isDayFeasible, type TherapistRequirement } from "@/lib/spa-availability";
import { confirmSpaHold, createSpaAppointment, expireStaleSpaHolds, quoteSpaTreatment, type SpaQuote } from "@/lib/spa-booking";
import { systemActorContext } from "@/lib/system-actor";
import type { ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import { activityGate, guestSchema, newPublicRef, paymentSchema, type ActivityGate } from "@/lib/website-api/activity-common";
import { activityBookingResult } from "@/lib/website-api/activity-bookings";
import { notifyBookingChange } from "@/lib/booking-events";

// The Booking API's Spa endpoints (BOOKING_API_ADDONS_PLAN.md Phase 3): treatments, free
// times, quote, hold, book. Lookup and cancel are module-generic (activity-bookings.ts).
//
// Resource assignment is the desk's own engine (spa-availability.ts / spa-booking.ts):
// therapist and room are chosen automatically and never exposed (B-9); the only
// preference a guest can express is a therapist gender, and only where the property
// offers it. A hold is a real TENTATIVE appointment with its therapist(s) and room
// assigned, so the desk sees it on the schedule and nobody else can take those resources
// until it expires. Online bookings always post their charge at booking, whatever
// SpaSettings.chargeTiming says, because the guest was quoted (and may have paid) a price.

const MAX_RANGE_DAYS = 31;
const MAX_ACTIVE_HOLDS_PER_KEY = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDay(v: string | null | undefined, label: string): Date {
  if (!v || !DAY.test(v)) throw new BookingError(400, "INVALID_DATES", `${label} must be YYYY-MM-DD`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new BookingError(400, "INVALID_DATES", `${label} is not a real date`);
  return d;
}

/** A treatment this key may sell: at this property, active, published, open to walk-ins. */
async function sellableTreatment(propertyId: string, treatmentId: string) {
  const treatment = await prisma.spaTreatment.findFirst({
    where: { id: treatmentId, propertyId, isActive: true, publishOnline: true, allowWalkIn: true },
    include: { property: true },
  });
  if (!treatment) throw new BookingError(404, "TREATMENT_NOT_FOUND", "Treatment not found.");
  return treatment;
}

function requirementsFor(gate: ActivityGate, partySize: number, gender: string | null | undefined): TherapistRequirement[] {
  if (gender && !(gate.settings?.offerGenderPreference ?? true)) {
    throw new BookingError(400, "VALIDATION", "This property does not take therapist gender preferences online.", {
      details: { gender: "Not offered" },
    });
  }
  return Array.from({ length: partySize }, () => ({ requestedGender: gender ?? null }));
}

function assertPartySize(partySize: number, max: number) {
  if (!Number.isInteger(partySize) || partySize < 1) throw new BookingError(400, "VALIDATION", "partySize must be at least 1");
  if (partySize > max) throw new BookingError(400, "PARTY_TOO_LARGE", `This treatment is for at most ${max} guest(s).`);
}

function assertBookableTime(gate: ActivityGate, property: { businessDate: Date | null } & Parameters<typeof resolveBusinessDate>[0], date: Date, startTime: string) {
  if (dayStart(date) < dayStart(resolveBusinessDate(property))) {
    throw new BookingError(400, "ARRIVAL_IN_PAST", "That date has already passed.");
  }
  const closesAt = combineAppointmentDateTime(date, startTime).getTime() - (gate.settings?.leadHours ?? 2) * 3_600_000;
  if (Date.now() >= closesAt) {
    throw new BookingError(409, "BOOKING_CUTOFF", "Online booking for this time has closed. Please contact the property.");
  }
}

async function cancellationHours(propertyId: string): Promise<number> {
  const s = await prisma.spaSettings.findUnique({ where: { propertyId }, select: { cancellationCutoffHours: true } });
  return s?.cancellationCutoffHours ?? 4;
}

// ---------------------------------------------------------------------------------------
// Catalogue

export async function spaCatalogue(key: ResolvedWebsiteKey, propertyId: string) {
  const gate = await activityGate(key, propertyId, "SPA", "read");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const today = resolveBusinessDate(property);
  const treatments = await prisma.spaTreatment.findMany({
    where: { propertyId, isActive: true, publishOnline: true, allowWalkIn: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { rates: true, category: true },
  });
  const categories = new Map<string, { name: string; order: number; treatments: unknown[] }>();
  for (const t of treatments) {
    const cat = categories.get(t.categoryId) ?? { name: t.category.name, order: t.category.displayOrder, treatments: [] };
    const rate = rateForDate(t.rates, today);
    cat.treatments.push({
      id: t.id,
      name: t.name,
      description: t.publicDescription,
      inclusions: t.inclusions,
      imageUrls: t.imageUrls,
      durationMinutes: t.defaultDurationMinutes,
      maxGuests: t.maxParticipants,
      // PER_PERSON: price is per guest. FLAT: one price for the whole party.
      pricingMode: t.pricingMode,
      price: rate?.price ?? null,
    });
    categories.set(t.categoryId, cat);
  }
  return {
    propertyId,
    currency: property.defaultCurrency,
    pricesIncludeTaxes: property.pricesIncludeTaxes,
    booking: {
      enabled: gate.bookable,
      code: gate.status.code,
      reason: gate.status.reason,
      holdMinutes: gate.settings?.holdMinutes ?? 10,
      leadHours: gate.settings?.leadHours ?? 2,
      genderPreferenceOffered: gate.settings?.offerGenderPreference ?? true,
      freeCancellationHours: await cancellationHours(propertyId),
      paidOnlineAccepted: !!gate.settings?.onlinePaymentMethodId,
      policies: gate.settings?.policies ?? null,
    },
    categories: [...categories.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map(({ name, treatments: items }) => ({ name, treatments: items })),
  };
}

// ---------------------------------------------------------------------------------------
// Availability

export async function spaAvailability(
  key: ResolvedWebsiteKey,
  propertyId: string,
  q: { treatmentId: string | null; date: string | null; from: string | null; to: string | null; partySize: string | null; gender: string | null }
) {
  const gate = await activityGate(key, propertyId, "SPA", "read");
  if (!q.treatmentId) throw new BookingError(400, "VALIDATION", "treatmentId is required", { details: { treatmentId: "Required" } });
  const treatment = await sellableTreatment(propertyId, q.treatmentId);
  const partySize = q.partySize ? parseInt(q.partySize) : 1;
  assertPartySize(partySize, treatment.maxParticipants);
  const gender = q.gender ? q.gender.toUpperCase() : null;
  if (gender && gender !== "MALE" && gender !== "FEMALE") {
    throw new BookingError(400, "VALIDATION", "gender must be MALE or FEMALE", { details: { gender: "MALE or FEMALE" } });
  }
  const requirements = requirementsFor(gate, partySize, gender);
  const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });
  const businessDay = dayStart(resolveBusinessDate(treatment.property));

  if (q.from || q.to) {
    const from = parseDay(q.from, "from");
    const to = parseDay(q.to, "to");
    if (to < from) throw new BookingError(400, "INVALID_DATES", "to must not be before from");
    if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_RANGE_DAYS) {
      throw new BookingError(400, "STAY_TOO_LONG", `At most ${MAX_RANGE_DAYS} days per call`);
    }
    const days = [];
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const available =
        gate.bookable && d >= businessDay &&
        (await isDayFeasible({ propertyId, treatmentId: treatment.id, date: d, treatment, settings, partySize, requirements }));
      days.push({ date: d.toISOString().slice(0, 10), available });
    }
    return { treatmentId: treatment.id, partySize, days };
  }

  const date = parseDay(q.date, "date");
  const leadMs = (gate.settings?.leadHours ?? 2) * 3_600_000;
  const slots =
    date < businessDay
      ? []
      : await computeSlotsForDay({ propertyId, treatmentId: treatment.id, date, treatment, settings, partySize, requirements });
  const now = Date.now();
  return {
    treatmentId: treatment.id,
    date: date.toISOString().slice(0, 10),
    partySize,
    durationMinutes: treatment.defaultDurationMinutes,
    slots: slots.map((s) => ({
      startTime: s.startTime,
      endTime: addMinutesToTime(s.startTime, treatment.defaultDurationMinutes),
      available: gate.bookable && s.available && combineAppointmentDateTime(date, s.startTime).getTime() - leadMs > now,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Quote

export const spaQuoteSchema = z.object({
  treatmentId: z.string().min(1),
  date: z.string().regex(DAY, "YYYY-MM-DD"),
  partySize: z.number().int().min(1).max(20).default(1),
});

export function publicSpaQuote(q: SpaQuote, date: string) {
  return {
    treatmentId: q.treatmentId,
    date,
    partySize: q.partySize,
    currency: q.currency,
    pricesIncludeTaxes: q.pricesIncludeTaxes,
    totals: {
      base: q.charge.baseAmount,
      serviceCharge: q.charge.serviceCharge,
      taxes: q.charge.tax,
      levies: q.charge.levies,
      grandTotal: q.charge.grandTotal,
    },
    lines: q.charge.lines,
  };
}

export async function spaQuote(key: ResolvedWebsiteKey, propertyId: string, body: z.infer<typeof spaQuoteSchema>) {
  await activityGate(key, propertyId, "SPA", "read");
  const treatment = await sellableTreatment(propertyId, body.treatmentId);
  assertPartySize(body.partySize, treatment.maxParticipants);
  const date = parseDay(body.date, "date");
  return { quote: publicSpaQuote(await quoteSpaTreatment(treatment.id, date, body.partySize), body.date) };
}

// ---------------------------------------------------------------------------------------
// Hold

export const spaHoldSchema = z.object({
  treatmentId: z.string().min(1),
  date: z.string().regex(DAY, "YYYY-MM-DD"),
  startTime: z.string().regex(HHMM, "HH:MM"),
  partySize: z.number().int().min(1).max(20).default(1),
  gender: z.enum(["MALE", "FEMALE"]).optional().nullable(),
});

export async function createSpaHold(
  key: ResolvedWebsiteKey,
  propertyId: string,
  body: z.infer<typeof spaHoldSchema>,
  requestIp: string | null
) {
  const gate = await activityGate(key, propertyId, "SPA", "write");
  const treatment = await sellableTreatment(propertyId, body.treatmentId);
  assertPartySize(body.partySize, treatment.maxParticipants);
  const date = parseDay(body.date, "date");
  assertBookableTime(gate, treatment.property, date, body.startTime);
  const requirements = requirementsFor(gate, body.partySize, body.gender);

  await expireStaleSpaHolds(propertyId);
  const live = await prisma.apiActivityBooking.count({ where: { keyId: key.id, status: "HELD", holdExpiresAt: { gt: new Date() } } });
  if (live >= MAX_ACTIVE_HOLDS_PER_KEY) {
    throw new BookingError(429, "TOO_MANY_HOLDS", "Too many holds are open for this key. Book or let some expire first.");
  }

  const quote = await quoteSpaTreatment(treatment.id, date, body.partySize);
  const expiresAt = new Date(Date.now() + (gate.settings?.holdMinutes ?? 10) * 60_000);
  const actor = await systemActorContext(key.enterpriseId);
  let holdId = "";
  await createSpaAppointment(actor, {
    propertyId,
    treatmentId: treatment.id,
    appointmentDate: body.date,
    startTime: body.startTime,
    newWalkIn: { name: "Online hold", contact: null },
    participants: requirements.map((r, i) => (i === 0 ? { requestedGender: r.requestedGender ?? undefined } : { walkInGuestName: `Guest ${i + 1}`, requestedGender: r.requestedGender ?? undefined })),
    hold: { expiresAt },
    source: "WEBSITE_API",
    notes: "Held online while the guest pays",
    onCreated: async (tx, appointment) => {
      const row = await tx.apiActivityBooking.create({
        data: {
          enterpriseId: key.enterpriseId,
          propertyId,
          keyId: key.id,
          module: "SPA",
          publicRef: newPublicRef("SPA"),
          status: "HELD",
          holdExpiresAt: expiresAt,
          adults: body.partySize,
          quotedTotal: quote.charge.grandTotal,
          currency: quote.currency,
          requestIp,
          spaAppointmentId: appointment.id,
        },
      });
      holdId = row.id;
    },
  });

  return { hold: { holdId, expiresAt: expiresAt.toISOString(), startTime: body.startTime, quote: publicSpaQuote(quote, body.date) } };
}

// ---------------------------------------------------------------------------------------
// Book

export const spaBookSchema = z
  .object({
    holdId: z.string().min(1).optional(),
    treatmentId: z.string().min(1).optional(),
    date: z.string().regex(DAY, "YYYY-MM-DD").optional(),
    startTime: z.string().regex(HHMM, "HH:MM").optional(),
    partySize: z.number().int().min(1).max(20).optional(),
    gender: z.enum(["MALE", "FEMALE"]).optional().nullable(),
    guest: guestSchema,
    // Names of the other guests in a couple/group treatment, in order. Optional.
    companions: z.array(z.string().trim().min(1).max(100)).max(19).optional(),
    payment: paymentSchema,
    expectedTotal: z.number().min(0).optional().nullable(),
    remarks: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((b) => !!b.holdId || (!!b.treatmentId && !!b.date && !!b.startTime), {
    message: "Send a holdId, or treatmentId, date and startTime",
    path: ["holdId"],
  });

export async function bookSpa(
  key: ResolvedWebsiteKey,
  propertyId: string,
  body: z.infer<typeof spaBookSchema>,
  idempotencyKey: string,
  requestIp: string | null
): Promise<{ status: 200 | 201; body: unknown }> {
  const prior = await prisma.apiActivityBooking.findUnique({ where: { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } } });
  if (prior) {
    if (prior.propertyId !== propertyId || prior.module !== "SPA") {
      throw new BookingError(409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different request.");
    }
    if (prior.status === "CONFIRMED") return { status: 200, body: { booking: await activityBookingResult(prior.id, { replayed: true }) } };
    if (prior.status === "FAILED") await prisma.apiActivityBooking.delete({ where: { id: prior.id } });
  }

  const gate = await activityGate(key, propertyId, "SPA", "write");
  const paid = body.payment.status === "PAID";
  if (paid && !gate.settings?.onlinePaymentMethodId) {
    throw new BookingError(
      409,
      "PAYMENT_NOT_CONFIGURED",
      "The property does not accept bookings paid online yet. Send payment.status UNPAID (pay at the property) or ask the property to set this up."
    );
  }

  const hold = body.holdId
    ? await prisma.apiActivityBooking.findFirst({ where: { id: body.holdId, keyId: key.id, propertyId, module: "SPA" } })
    : null;
  if (body.holdId) {
    if (!hold || !hold.spaAppointmentId) throw new BookingError(404, "HOLD_NOT_FOUND", "Hold not found.");
    if (hold.status === "CONFIRMED") throw new BookingError(409, "HOLD_USED", "This hold has already been booked.");
    if (hold.status !== "HELD" || !hold.holdExpiresAt || hold.holdExpiresAt <= new Date()) {
      throw new BookingError(409, "HOLD_EXPIRED", "The hold has expired. Check availability and try again.");
    }
  }

  const recordFailure = async (e: BookingError) => {
    if (hold) return;
    await prisma.apiActivityBooking
      .create({
        data: {
          enterpriseId: key.enterpriseId, propertyId, keyId: key.id, module: "SPA", publicRef: newPublicRef("SPA"),
          status: "FAILED", problem: `${e.code}: ${e.message}`.slice(0, 500), idempotencyKey,
          adults: body.partySize ?? 1, guestFirstName: body.guest.firstName, guestLastName: body.guest.lastName ?? null,
          guestEmail: body.guest.email.toLowerCase(), requestIp,
        },
      })
      .catch(() => undefined);
  };

  try {
    const publicRef = hold?.publicRef ?? newPublicRef("SPA");
    const guestName = [body.guest.firstName, body.guest.lastName].filter(Boolean).join(" ");
    const contact = [body.guest.email, body.guest.phone].filter(Boolean).join(" · ");
    const currency = (await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { defaultCurrency: true } })).defaultCurrency;
    const notesFor = (total: number, amountMismatch: boolean) =>
      [
        `Booked online (ref ${publicRef})`,
        gate.settings?.deskRemark,
        paid
          ? `Paid online${body.payment.provider ? ` via ${body.payment.provider}` : ""}${body.payment.reference ? ` — ref ${body.payment.reference}` : ""}`
          : "To pay at the property",
        amountMismatch
          ? `CHECK PAYMENT: website reported ${body.payment.amount ?? "?"} ${body.payment.currency ?? currency}; the total is ${total.toFixed(2)} ${currency}`
          : null,
        body.remarks ? `Guest: ${body.remarks}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    const mismatch = (total: number) =>
      paid &&
      ((body.payment.amount != null && Math.abs(body.payment.amount - total) > 0.005) ||
        (!!body.payment.currency && body.payment.currency.toUpperCase() !== currency.toUpperCase()));
    // The price the website confirmed must be what is posted, to the cent — checked
    // against the ACTUAL posting inside the transaction, so it rolls back if not.
    const assertExpected = (posted: number) => {
      if (body.expectedTotal != null && Math.abs(body.expectedTotal - posted) > 0.005) {
        throw new BookingError(409, "PRICE_CHANGED", `The price is now ${posted.toFixed(2)} ${currency}. Re-quote and confirm with the guest.`, {
          details: { expectedTotal: body.expectedTotal, total: posted },
        });
      }
    };
    const rowData = (total: number) => ({
      status: "CONFIRMED",
      problem: null,
      idempotencyKey,
      holdExpiresAt: null,
      guestFirstName: body.guest.firstName,
      guestLastName: body.guest.lastName ?? null,
      guestEmail: body.guest.email.toLowerCase(),
      guestPhone: body.guest.phone ?? null,
      remarks: body.remarks ?? null,
      paymentStatus: body.payment.status,
      paymentProvider: body.payment.provider ?? null,
      paymentReference: body.payment.reference ?? null,
      paymentAmount: body.payment.amount ?? null,
      paymentCurrency: body.payment.currency?.toUpperCase() ?? null,
      amountMismatch: mismatch(total),
      quotedTotal: total,
      currency,
      requestIp,
    });
    const settlement = paid ? { paymentMethodId: gate.settings!.onlinePaymentMethodId!, referenceNumber: body.payment.reference || publicRef } : null;
    const actor = await systemActorContext(key.enterpriseId);
    let recordId = hold?.id ?? "";
    let appointmentId = hold?.spaAppointmentId ?? "";

    if (hold) {
      await confirmSpaHold(actor, hold.spaAppointmentId!, {
        guest: { name: guestName, contact },
        companions: body.companions ?? [],
        // Notes are written with the final figure below, once posted.
        notes: notesFor(hold.quotedTotal ?? 0, mismatch(hold.quotedTotal ?? 0)),
        settlement,
        onConfirmed: async (tx, appointment, posted) => {
          assertExpected(posted.grandTotal);
          const { count } = await tx.apiActivityBooking.updateMany({
            where: { id: hold.id, status: "HELD" },
            data: rowData(posted.grandTotal),
          });
          if (count === 0) throw new BookingError(409, "HOLD_USED", "This hold has already been booked.");
          await tx.spaAppointment.update({ where: { id: appointment.id }, data: { notes: notesFor(posted.grandTotal, mismatch(posted.grandTotal)) } });
        },
      });
    } else {
      const treatment = await sellableTreatment(propertyId, body.treatmentId!);
      const partySize = body.partySize ?? 1;
      assertPartySize(partySize, treatment.maxParticipants);
      const date = parseDay(body.date, "date");
      assertBookableTime(gate, treatment.property, date, body.startTime!);
      const requirements = requirementsFor(gate, partySize, body.gender);
      const created = await createSpaAppointment(actor, {
        propertyId,
        treatmentId: treatment.id,
        appointmentDate: body.date!,
        startTime: body.startTime!,
        newWalkIn: { name: guestName, contact },
        participants: requirements.map((r, i) =>
          i === 0
            ? { requestedGender: r.requestedGender ?? undefined }
            : { walkInGuestName: body.companions?.[i - 1] || `Guest ${i + 1}`, requestedGender: r.requestedGender ?? undefined }
        ),
        forceChargeAtBooking: true,
        settlement,
        source: "WEBSITE_API",
        notes: null,
        onCreated: async (tx, appointment, posted) => {
          const total = posted!.grandTotal;
          assertExpected(total);
          const row = await tx.apiActivityBooking.create({
            data: {
              ...rowData(total),
              enterpriseId: key.enterpriseId,
              propertyId,
              keyId: key.id,
              module: "SPA",
              publicRef,
              adults: partySize,
              spaAppointmentId: appointment.id,
            },
          });
          recordId = row.id;
          await tx.spaAppointment.update({ where: { id: appointment.id }, data: { notes: notesFor(total, mismatch(total)) } });
        },
      });
      appointmentId = created.id;
    }

    notifyBookingChange("booking.confirmed", { spaAppointmentId: appointmentId });
    return { status: 201, body: { booking: await activityBookingResult(recordId, { replayed: false }) } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.apiActivityBooking.findUnique({ where: { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } } });
      if (winner?.status === "CONFIRMED") return { status: 200, body: { booking: await activityBookingResult(winner.id, { replayed: true }) } };
    }
    if (e instanceof BookingError) await recordFailure(e);
    throw e;
  }
}
