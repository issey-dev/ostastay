import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BookingError } from "@/lib/booking-error";
import { resolveBusinessDate } from "@/lib/business-date";
import { combineDepartureDateTime, rateForDate } from "@/lib/excursions";
import {
  createExcursionBooking,
  occupiedSeats,
  quoteExcursion,
  assertDepartureOpen,
  type ExcursionParty,
  type ExcursionQuote,
} from "@/lib/excursion-booking";
import { lockKeys, lockKey, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { systemActorContext } from "@/lib/system-actor";
import type { ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import {
  activityGate,
  guestSchema,
  newPublicRef,
  partySchema,
  paymentSchema,
  type ActivityGate,
} from "@/lib/website-api/activity-common";
import { activityBookingResult } from "@/lib/website-api/activity-bookings";
import { notifyBookingChange } from "@/lib/booking-events";

// The Booking API's Excursions endpoints (BOOKING_API_ADDONS_PLAN.md Phase 2):
// catalogue, departures, quote, hold, book. Lookup and cancel are module-generic, in
// activity-bookings.ts. Every write goes through createExcursionBooking — the same code
// the desk books with — acting as the enterprise's "Online Bookings" system user.
//
// Bookings are instant (owner, 2026-09-23): accepted whenever seats allow, refused
// otherwise. The website takes payment itself and reports PAID/UNPAID.

const MAX_WINDOW_DAYS = 62;
const MAX_ACTIVE_HOLDS_PER_KEY = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Rate = { adultPrice: number; childPrice: number; infantPrice: number; flatPrice: number | null };

function publicPrices(pricingMode: string, rate: Rate | null) {
  if (!rate) return null;
  return pricingMode === "FLAT"
    ? { flat: rate.flatPrice ?? 0 }
    : { adult: rate.adultPrice, child: rate.childPrice, infant: rate.infantPrice };
}

function bookingBlock(gate: ActivityGate) {
  return {
    enabled: gate.bookable,
    code: gate.status.code,
    reason: gate.status.reason,
    holdMinutes: gate.settings?.holdMinutes ?? 10,
    leadHours: gate.settings?.leadHours ?? 2,
    maxPartySize: gate.settings?.maxPartySize ?? 10,
    paidOnlineAccepted: !!gate.settings?.onlinePaymentMethodId,
    policies: gate.settings?.policies ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Catalogue

export async function excursionCatalogue(key: ResolvedWebsiteKey, propertyId: string) {
  const gate = await activityGate(key, propertyId, "EXCURSIONS", "read");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const today = resolveBusinessDate(property);
  const types = await prisma.excursionType.findMany({
    where: { propertyId, isActive: true, publishOnline: true },
    orderBy: { name: "asc" },
    include: { rates: true },
  });
  return {
    propertyId,
    currency: property.defaultCurrency,
    pricesIncludeTaxes: property.pricesIncludeTaxes,
    booking: bookingBlock(gate),
    excursions: types.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.publicDescription,
      inclusions: t.inclusions,
      imageUrls: t.imageUrls,
      pricingMode: t.pricingMode,
      // Today's rate card. A departure on a date with a different rate shows its own.
      prices: publicPrices(t.pricingMode, rateForDate(t.rates, today)),
      freeCancellationHours: t.cutoffHours,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Departures

function parseDay(v: string | null, label: string): Date {
  if (!v || !DAY.test(v)) throw new BookingError(400, "INVALID_DATES", `${label} must be YYYY-MM-DD`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new BookingError(400, "INVALID_DATES", `${label} is not a real date`);
  return d;
}

export async function excursionDepartures(
  key: ResolvedWebsiteKey,
  propertyId: string,
  q: { from: string | null; to: string | null; excursionId: string | null }
) {
  const gate = await activityGate(key, propertyId, "EXCURSIONS", "read");
  const from = parseDay(q.from, "from");
  const to = parseDay(q.to, "to");
  if (to < from) throw new BookingError(400, "INVALID_DATES", "to must not be before from");
  if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_WINDOW_DAYS) {
    throw new BookingError(400, "STAY_TOO_LONG", `At most ${MAX_WINDOW_DAYS} days per call`);
  }

  const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
  const businessDay = resolveBusinessDate(property);
  const start = from < businessDay ? businessDay : from;
  const leadMs = (gate.settings?.leadHours ?? 2) * 3_600_000;
  const now = new Date();

  const departures = await prisma.excursionDeparture.findMany({
    where: {
      departureDate: { gte: start, lte: to },
      status: "SCHEDULED",
      excursionType: { propertyId, isActive: true, publishOnline: true, ...(q.excursionId ? { id: q.excursionId } : {}) },
    },
    orderBy: [{ departureDate: "asc" }, { departureTime: "asc" }],
    include: { excursionType: { include: { rates: true } } },
  });

  // Seats taken per departure, in two grouped queries rather than two per departure:
  // CONFIRMED bookings (also the "is it guaranteed" count) and live Booking API holds.
  const ids = departures.map((d) => d.id);
  const [bookedRows, heldRows] = await Promise.all([
    prisma.excursionBooking.groupBy({
      by: ["departureId"],
      where: { departureId: { in: ids }, status: "CONFIRMED" },
      _sum: { adultCount: true, childCount: true, infantCount: true },
    }),
    prisma.apiActivityBooking.groupBy({
      by: ["excursionDepartureId"],
      where: { excursionDepartureId: { in: ids }, status: "HELD", holdExpiresAt: { gt: now } },
      _sum: { adults: true, children: true, infants: true },
    }),
  ]);
  const bookedBy = new Map(bookedRows.map((r) => [r.departureId, (r._sum.adultCount ?? 0) + (r._sum.childCount ?? 0) + (r._sum.infantCount ?? 0)]));
  const heldBy = new Map(heldRows.map((r) => [r.excursionDepartureId, (r._sum.adults ?? 0) + (r._sum.children ?? 0) + (r._sum.infants ?? 0)]));

  const rows = [];
  for (const d of departures) {
    const startsAt = combineDepartureDateTime(d.departureDate, d.departureTime);
    if (startsAt <= now) continue;
    const booked = bookedBy.get(d.id) ?? 0;
    const taken = booked + (heldBy.get(d.id) ?? 0);
    const seatsLeft = Math.max(0, d.capacity - taken);
    const closesAt = new Date(startsAt.getTime() - leadMs);
    const prices = publicPrices(d.excursionType.pricingMode, rateForDate(d.excursionType.rates, d.departureDate));
    rows.push({
      id: d.id,
      excursionId: d.excursionTypeId,
      date: d.departureDate.toISOString().slice(0, 10),
      time: d.departureTime,
      meetingTime: d.meetingTime,
      meetingPoint: d.meetingPoint,
      capacity: d.capacity,
      seatsLeft,
      minGuests: d.minCapacity,
      // A departure below its minimum may still be called off by the property.
      guaranteed: d.minCapacity == null || booked >= d.minCapacity,
      bookingClosesAt: closesAt.toISOString(),
      prices,
      bookable: gate.bookable && seatsLeft > 0 && now < closesAt && !!prices,
    });
  }
  return {
    propertyId,
    from: start.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    currency: property.defaultCurrency,
    bookingEnabled: gate.bookable,
    departures: rows,
  };
}

// ---------------------------------------------------------------------------------------
// Quote

export const quoteSchema = z.object({ departureId: z.string().min(1) }).and(partySchema);

/** A departure this key may sell: at this property, of a published active excursion. */
async function sellableDeparture(propertyId: string, departureId: string) {
  const departure = await prisma.excursionDeparture.findFirst({
    where: { id: departureId, excursionType: { propertyId, isActive: true, publishOnline: true } },
    include: { excursionType: true },
  });
  if (!departure) throw new BookingError(404, "DEPARTURE_NOT_FOUND", "Departure not found.");
  return departure;
}

function toParty(p: { adults: number; children: number; infants: number }): ExcursionParty {
  return { adultCount: p.adults, childCount: p.children, infantCount: p.infants };
}

export function publicQuote(q: ExcursionQuote) {
  return {
    departureId: q.departureId,
    excursionId: q.excursionTypeId,
    adults: q.party.adultCount,
    children: q.party.childCount,
    infants: q.party.infantCount,
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

function checkPartyAndCutoff(
  gate: ActivityGate,
  departure: { departureDate: Date; departureTime: string },
  party: ExcursionParty,
  opts: { skipCutoff?: boolean } = {}
) {
  const size = party.adultCount + party.childCount + party.infantCount;
  if (party.adultCount + party.childCount < 1) {
    throw new BookingError(400, "INVALID_PARTY", "At least one adult or child is required.");
  }
  const max = gate.settings?.maxPartySize ?? 10;
  if (size > max) throw new BookingError(400, "PARTY_TOO_LARGE", `At most ${max} guests per online booking.`);
  if (!opts.skipCutoff) {
    const closesAt = combineDepartureDateTime(departure.departureDate, departure.departureTime).getTime() -
      (gate.settings?.leadHours ?? 2) * 3_600_000;
    if (Date.now() >= closesAt) {
      throw new BookingError(409, "BOOKING_CUTOFF", "Online booking for this departure has closed. Please contact the property.");
    }
  }
}

export async function excursionQuote(key: ResolvedWebsiteKey, propertyId: string, body: z.infer<typeof quoteSchema>) {
  const gate = await activityGate(key, propertyId, "EXCURSIONS", "read");
  const departure = await sellableDeparture(propertyId, body.departureId);
  const party = toParty(body);
  checkPartyAndCutoff(gate, departure, party, { skipCutoff: true });
  const quote = await quoteExcursion(departure.id, party);
  const taken = await occupiedSeats(prisma, departure.id);
  const seatsLeft = Math.max(0, departure.capacity - taken);
  const size = party.adultCount + party.childCount + party.infantCount;
  let available = gate.bookable && seatsLeft >= size;
  try {
    assertDepartureOpen(departure);
    checkPartyAndCutoff(gate, departure, party);
  } catch {
    available = false;
  }
  return { quote: { ...publicQuote(quote), available, seatsLeft } };
}

// ---------------------------------------------------------------------------------------
// Hold

export const holdSchema = quoteSchema;

export async function createExcursionHold(
  key: ResolvedWebsiteKey,
  propertyId: string,
  body: z.infer<typeof holdSchema>,
  requestIp: string | null
) {
  const gate = await activityGate(key, propertyId, "EXCURSIONS", "write");
  const departure = await sellableDeparture(propertyId, body.departureId);
  const party = toParty(body);
  checkPartyAndCutoff(gate, departure, party);
  assertDepartureOpen(departure);
  const quote = await quoteExcursion(departure.id, party);

  // A key can't sit on the whole inventory: live holds are capped per key.
  const live = await prisma.apiActivityBooking.count({ where: { keyId: key.id, status: "HELD", holdExpiresAt: { gt: new Date() } } });
  if (live >= MAX_ACTIVE_HOLDS_PER_KEY) {
    throw new BookingError(429, "TOO_MANY_HOLDS", "Too many holds are open for this key. Book or let some expire first.");
  }

  const size = party.adultCount + party.childCount + party.infantCount;
  const holdMinutes = gate.settings?.holdMinutes ?? 10;
  const hold = await prisma.$transaction(async (tx) => {
    await lockKeys(tx, [lockKey.excursionDeparture(departure.id)]);
    const current = await tx.excursionDeparture.findUniqueOrThrow({ where: { id: departure.id } });
    assertDepartureOpen(current);
    const taken = await occupiedSeats(tx, departure.id);
    if (taken + size > current.capacity) {
      const left = Math.max(0, current.capacity - taken);
      throw new BookingError(409, "SOLD_OUT", `Only ${left} seat${left === 1 ? "" : "s"} left on this departure.`, {
        details: { seatsLeft: left },
      });
    }
    return tx.apiActivityBooking.create({
      data: {
        enterpriseId: key.enterpriseId,
        propertyId,
        keyId: key.id,
        module: "EXCURSIONS",
        publicRef: newPublicRef("EXCURSIONS"),
        status: "HELD",
        holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),
        excursionDepartureId: departure.id,
        adults: party.adultCount,
        children: party.childCount,
        infants: party.infantCount,
        quotedTotal: quote.charge.grandTotal,
        currency: quote.currency,
        requestIp,
      },
    });
  }, BOOKING_TX_OPTIONS);

  return {
    hold: {
      holdId: hold.id,
      expiresAt: hold.holdExpiresAt!.toISOString(),
      quote: publicQuote(quote),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Book

export const bookSchema = z
  .object({
    holdId: z.string().min(1).optional(),
    departureId: z.string().min(1).optional(),
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    infants: z.number().int().min(0).max(100).optional(),
    guest: guestSchema,
    payment: paymentSchema,
    expectedTotal: z.number().min(0).optional().nullable(),
    remarks: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((b) => !!b.holdId || (!!b.departureId && b.adults !== undefined), {
    message: "Send a holdId, or a departureId with adults (and children/infants)",
    path: ["holdId"],
  });

export async function bookExcursion(
  key: ResolvedWebsiteKey,
  propertyId: string,
  body: z.infer<typeof bookSchema>,
  idempotencyKey: string,
  requestIp: string | null
): Promise<{ status: 200 | 201; body: unknown }> {
  // Replay: the same Idempotency-Key under this key returns the booking it made.
  const prior = await prisma.apiActivityBooking.findUnique({ where: { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } } });
  if (prior) {
    if (prior.propertyId !== propertyId || prior.module !== "EXCURSIONS") {
      throw new BookingError(409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different request.");
    }
    if (prior.status === "CONFIRMED") return { status: 200, body: { booking: await activityBookingResult(prior.id, { replayed: true }) } };
    // A FAILED attempt is retried with the same key: clear it and try again.
    if (prior.status === "FAILED") await prisma.apiActivityBooking.delete({ where: { id: prior.id } });
  }

  const gate = await activityGate(key, propertyId, "EXCURSIONS", "write");

  // What is being booked: a live hold, or a departure + party directly.
  let hold: Awaited<ReturnType<typeof prisma.apiActivityBooking.findFirst>> = null;
  let departureId: string;
  let party: ExcursionParty;
  if (body.holdId) {
    hold = await prisma.apiActivityBooking.findFirst({ where: { id: body.holdId, keyId: key.id, propertyId, module: "EXCURSIONS" } });
    if (!hold || !hold.excursionDepartureId) throw new BookingError(404, "HOLD_NOT_FOUND", "Hold not found.");
    if (hold.status === "CONFIRMED") throw new BookingError(409, "HOLD_USED", "This hold has already been booked.");
    if (hold.status !== "HELD" || !hold.holdExpiresAt || hold.holdExpiresAt <= new Date()) {
      throw new BookingError(409, "HOLD_EXPIRED", "The hold has expired. Check availability and try again.");
    }
    departureId = hold.excursionDepartureId;
    party = { adultCount: hold.adults, childCount: hold.children, infantCount: hold.infants };
  } else {
    departureId = body.departureId!;
    party = toParty({ adults: body.adults ?? 0, children: body.children ?? 0, infants: body.infants ?? 0 });
  }

  const recordFailure = async (e: BookingError) => {
    if (hold) return; // the hold row stays as it was; nothing new to audit
    await prisma.apiActivityBooking
      .create({
        data: {
          enterpriseId: key.enterpriseId,
          propertyId,
          keyId: key.id,
          module: "EXCURSIONS",
          publicRef: newPublicRef("EXCURSIONS"),
          status: "FAILED",
          problem: `${e.code}: ${e.message}`.slice(0, 500),
          idempotencyKey,
          excursionDepartureId: departureId,
          adults: party.adultCount,
          children: party.childCount,
          infants: party.infantCount,
          guestFirstName: body.guest.firstName,
          guestLastName: body.guest.lastName ?? null,
          guestEmail: body.guest.email.toLowerCase(),
          requestIp,
        },
      })
      .catch(() => undefined);
  };

  try {
    const departure = await sellableDeparture(propertyId, departureId);
    // A live hold was granted before the cutoff; honour it.
    checkPartyAndCutoff(gate, departure, party, { skipCutoff: !!hold });

    const quote = await quoteExcursion(departure.id, party);
    const total = quote.charge.grandTotal;
    if (body.expectedTotal != null && Math.abs(body.expectedTotal - total) > 0.005) {
      throw new BookingError(409, "PRICE_CHANGED", `The price is now ${total.toFixed(2)} ${quote.currency}. Re-quote and confirm with the guest.`, {
        details: { expectedTotal: body.expectedTotal, total },
      });
    }

    const paid = body.payment.status === "PAID";
    if (paid && !gate.settings?.onlinePaymentMethodId) {
      throw new BookingError(
        409,
        "PAYMENT_NOT_CONFIGURED",
        "The property does not accept bookings paid online yet. Send payment.status UNPAID (pay at the property) or ask the property to set this up."
      );
    }
    const amountMismatch =
      paid &&
      ((body.payment.amount != null && Math.abs(body.payment.amount - total) > 0.005) ||
        (!!body.payment.currency && body.payment.currency.toUpperCase() !== quote.currency.toUpperCase()));

    const publicRef = hold?.publicRef ?? newPublicRef("EXCURSIONS");
    const guestName = [body.guest.firstName, body.guest.lastName].filter(Boolean).join(" ");
    const contact = [body.guest.email, body.guest.phone].filter(Boolean).join(" · ");
    const notes = [
      `Booked online (ref ${publicRef})`,
      gate.settings?.deskRemark,
      paid
        ? `Paid online${body.payment.provider ? ` via ${body.payment.provider}` : ""}${body.payment.reference ? ` — ref ${body.payment.reference}` : ""}`
        : "To pay at the property",
      amountMismatch
        ? `CHECK PAYMENT: website reported ${body.payment.amount ?? "?"} ${body.payment.currency ?? quote.currency}; the total is ${total.toFixed(2)} ${quote.currency}`
        : null,
      body.remarks ? `Guest: ${body.remarks}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const actor = await systemActorContext(key.enterpriseId);
    const rowData = {
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
      amountMismatch,
      currency: quote.currency,
      requestIp,
    };

    let recordId = hold?.id ?? "";
    const created = await createExcursionBooking(actor, {
      departureId: departure.id,
      guest: { kind: "NEW_WALK_IN", name: guestName, contact },
      ...party,
      notes,
      settlement: paid
        ? { paymentMethodId: gate.settings!.onlinePaymentMethodId!, referenceNumber: body.payment.reference || publicRef }
        : null,
      source: "API",
      consumeHoldId: hold?.id ?? null,
      onCreated: async (tx, booking, posted) => {
        if (hold) {
          // Convert the hold exactly once, even if two booking calls race for it.
          const { count } = await tx.apiActivityBooking.updateMany({
            where: { id: hold.id, status: "HELD" },
            data: { ...rowData, quotedTotal: posted.grandTotal, excursionBookingId: booking.id },
          });
          if (count === 0) throw new BookingError(409, "HOLD_USED", "This hold has already been booked.");
        } else {
          const row = await tx.apiActivityBooking.create({
            data: {
              ...rowData,
              enterpriseId: key.enterpriseId,
              propertyId,
              keyId: key.id,
              module: "EXCURSIONS",
              publicRef,
              excursionDepartureId: departure.id,
              adults: party.adultCount,
              children: party.childCount,
              infants: party.infantCount,
              quotedTotal: posted.grandTotal,
              excursionBookingId: booking.id,
            },
          });
          recordId = row.id;
        }
      },
    });

    notifyBookingChange("booking.confirmed", { excursionBookingId: created.id });
    return { status: 201, body: { booking: await activityBookingResult(recordId, { replayed: false }) } };
  } catch (e) {
    // Two calls with the same Idempotency-Key raced: the loser's row hit the unique index
    // and its whole booking rolled back. Answer with the winner's booking.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.apiActivityBooking.findUnique({ where: { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } } });
      if (winner?.status === "CONFIRMED") return { status: 200, body: { booking: await activityBookingResult(winner.id, { replayed: true }) } };
    }
    if (e instanceof BookingError) await recordFailure(e);
    throw e;
  }
}
