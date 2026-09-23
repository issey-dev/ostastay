import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPropertyModuleAccess, type AuthContext } from "@/lib/scope";
import { resolvePaymentChargeCodeId } from "@/lib/posting/post-payment";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { resolveBusinessDate } from "@/lib/business-date";
import { addMinutesToTime, rateForDate, computeAppointmentTotal } from "@/lib/spa";
import { dayStart, getAvailableRooms, getAvailableTherapists, getCompatibleRoomIds } from "@/lib/spa-availability";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";
import { lockKeys, lockKey, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { BookingError } from "@/lib/booking-error";
import { previewCharge, type ChargePreview } from "@/lib/posting/preview-charge";

// The ONE place a SpaAppointment is created. Extracted from POST /api/spa/appointments
// (BOOKING_API_ADDONS_PLAN.md Phase 0 §2) so the desk and the public Booking API share one
// code path for resource assignment, pricing and posting.
//
// Books a treatment for one or more guests sharing one room and one time window, each
// with their own therapist (SPA_PLAN.md §3 row 7 / §7). Billing is always single-folio,
// resolved from participant 1 (SPA_PLAN.md §4):
//   - reservationId -> the guest's own open room folio (in-house).
//   - folioId       -> an already-open walk-in folio (POST /api/folios/walk-in) — only
//                      valid for participant 1, the only participant billing looks at.
// Any OTHER participant (a couple/group treatment's companions) can be another in-house
// reservation or a plain walkInGuestName/Contact with no folio — never billed separately.

export const spaAppointmentInclude = {
  treatment: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  folio: { select: { id: true, isClosed: true, taxInvoiceNumber: true } },
  participants: {
    include: {
      reservation: { include: { primaryGuest: true, assignments: { include: { room: true } } } },
      therapist: { select: { id: true, displayName: true } },
      requestedTherapist: { select: { id: true, displayName: true } },
    },
  },
} as const;

export type SpaParticipantInput = {
  reservationId?: string;
  folioId?: string;
  walkInGuestName?: string;
  walkInGuestContact?: string;
  /** A specific requested therapist: "book this exact person or fail". */
  therapistId?: string;
  /** Hard gender filter, only consulted when therapistId is absent. */
  requestedGender?: string;
  notes?: string;
};

export type CreateSpaAppointmentInput = {
  propertyId: string;
  treatmentId: string;
  /** YYYY-MM-DD */
  appointmentDate: string;
  /** HH:MM */
  startTime: string;
  roomId?: string | null;
  notes?: string | null;
  participants: SpaParticipantInput[];
  /** Settle the posted gross now — "charge & pay now" at the desk (in-house), or a booking
   *  the website reports as PAID (new walk-in). AT_BOOKING only. */
  settlement?: { paymentMethodId: string; referenceNumber: string | null } | null;
  /** Participant 1 is a NEW walk-in (the Booking API — online guests are never linked to
   *  a stay): their bill is opened inside the booking transaction. participants[0] then
   *  carries only preferences (requestedGender, notes). */
  newWalkIn?: { name: string; contact: string | null } | null;
  /** A Booking API hold: TENTATIVE, therapist(s) and room assigned and blocked until
   *  expiresAt, nothing posted and no bill yet. Confirmed with confirmSpaHold. */
  hold?: { expiresAt: Date } | null;
  /** Post now even under AT_COMPLETION — an online guest has been quoted, and may have
   *  paid, a fixed price, so the charge is on the bill from the start. */
  forceChargeAtBooking?: boolean;
  source?: "FRONT_DESK" | "WEBSITE_API";
  /** Runs inside the booking transaction, under the resource locks, after the appointment
   *  is written — the Booking API records its own row here so the two commit together. */
  onCreated?: (tx: Prisma.TransactionClient, appointment: CreatedAppointment, posted: { grandTotal: number } | null) => Promise<void>;
};

type CreatedAppointment = Prisma.SpaAppointmentGetPayload<{ include: typeof spaAppointmentInclude }>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createSpaAppointment(ctx: AuthContext, input: CreateSpaAppointmentInput) {
  const { propertyId, treatmentId, appointmentDate, startTime, participants: participantsInput } = input;
  const requestedRoomId = input.roomId || null;

  if (!propertyId || !treatmentId || !appointmentDate || !startTime) {
    throw new BookingError(400, "VALIDATION", "propertyId, treatmentId, appointmentDate, and startTime are required");
  }
  if (!HHMM.test(startTime)) throw new BookingError(400, "VALIDATION", "startTime must be HH:MM");
  if (participantsInput.length === 0) {
    throw new BookingError(400, "VALIDATION", "At least one participant is required");
  }
  const newWalkIn = input.newWalkIn ?? null;
  if (newWalkIn && !newWalkIn.name.trim()) throw new BookingError(400, "VALIDATION", "The guest's name is required");
  for (let i = 0; i < participantsInput.length; i++) {
    const p = participantsInput[i];
    const identityCount = [p.reservationId, p.folioId, p.walkInGuestName].filter(Boolean).length;
    if (i === 0 && newWalkIn) {
      if (identityCount !== 0) throw new BookingError(400, "VALIDATION", "Participant 1 is the new walk-in guest");
      continue;
    }
    if (identityCount !== 1) {
      throw new BookingError(400, "VALIDATION", `Participant ${i + 1} needs exactly one of reservationId, folioId, or walkInGuestName`);
    }
    if (p.folioId && i > 0) {
      throw new BookingError(400, "VALIDATION", "Only the first participant can be billed to a walk-in folio (folioId)");
    }
    if (p.walkInGuestName && i === 0) {
      throw new BookingError(
        400,
        "VALIDATION",
        "The first participant must be an in-house reservation or an already-open walk-in folio (folioId) — plain walk-in name isn't billable yet"
      );
    }
  }

  const treatment = await prisma.spaTreatment.findUnique({
    where: { id: treatmentId },
    include: { rates: true, property: true },
  });
  if (!treatment || treatment.propertyId !== propertyId) {
    throw new BookingError(404, "TREATMENT_NOT_FOUND", "Treatment not found at this property");
  }
  await assertPropertyModuleAccess(ctx, propertyId, "SPA");

  if (!treatment.isActive) throw new BookingError(400, "TREATMENT_INACTIVE", "This treatment is not currently active");
  const primary = participantsInput[0];
  if (primary.reservationId && !treatment.allowInHouseGuest) {
    throw new BookingError(400, "IN_HOUSE_NOT_ALLOWED", "This treatment cannot be booked for in-house guests");
  }
  if ((primary.folioId || newWalkIn) && !treatment.allowWalkIn) {
    throw new BookingError(400, "WALK_IN_NOT_ALLOWED", "This treatment cannot be booked for walk-in guests");
  }
  const partySize = participantsInput.length;
  if (partySize > treatment.maxParticipants) {
    throw new BookingError(400, "PARTY_TOO_LARGE", `This treatment allows at most ${treatment.maxParticipants} participant(s)`);
  }

  const date = new Date(appointmentDate);
  if (isNaN(date.getTime())) throw new BookingError(400, "INVALID_DATES", "Invalid appointmentDate");
  // Found via live-testing: nothing previously stopped a date before the property's
  // business date from being booked and charged. Date-only guard; same-day elapsed slots
  // are the availability engine's concern (SPA_PLAN.md §21).
  if (dayStart(date) < dayStart(resolveBusinessDate(treatment.property))) {
    throw new BookingError(400, "ARRIVAL_IN_PAST", "Cannot book an appointment for a date that has already passed");
  }

  const rate = rateForDate(treatment.rates, date);
  if (!rate) throw new BookingError(400, "NO_RATE", "No price is configured for this treatment on this date");
  const priceSnapshot = computeAppointmentTotal(rate, treatment.pricingMode, partySize);

  const treatmentEndTime = addMinutesToTime(startTime, treatment.defaultDurationMinutes);
  const blockedUntilTime = addMinutesToTime(treatmentEndTime, treatment.cleanupBufferMinutes);
  const blockedFromTime = addMinutesToTime(startTime, -treatment.preparationBufferMinutes);

  // Every in-house reservation referenced by ANY participant must belong to this property.
  const reservationIds = participantsInput.map((p) => p.reservationId).filter((id): id is string => !!id);
  const reservations = reservationIds.length
    ? await prisma.reservation.findMany({
        where: { id: { in: reservationIds } },
        include: { folios: { where: { isClosed: false } }, primaryGuest: true },
      })
    : [];
  const reservationById = new Map(reservations.map((r) => [r.id, r]));
  for (const id of reservationIds) {
    const r = reservationById.get(id);
    if (!r || r.propertyId !== propertyId) {
      throw new BookingError(404, "RESERVATION_NOT_FOUND", "Reservation not found at this property");
    }
  }

  // The billing folio, from participant 1 — never a reservation's own folio smuggled in
  // through folioId.
  let billingFolioId: string | null;
  let billingGuestLabel: string;
  let primaryWalkInIdentity: { walkInGuestName: string; walkInGuestContact: string | null } | null = null;
  if (newWalkIn) {
    billingFolioId = null; // opened inside the transaction (or, for a hold, at confirmation)
    billingGuestLabel = newWalkIn.name.trim();
    primaryWalkInIdentity = { walkInGuestName: newWalkIn.name.trim(), walkInGuestContact: newWalkIn.contact };
  } else if (primary.reservationId) {
    const reservation = reservationById.get(primary.reservationId)!;
    // In-house appointments must fall WITHIN the guest's stay — the charge is realized on
    // their room folio. An out-of-stay date should be booked as a walk-in instead.
    const apptMs = dayStart(date).getTime();
    if (apptMs < dayStart(new Date(reservation.checkInDate)).getTime() || apptMs > dayStart(new Date(reservation.checkOutDate)).getTime()) {
      throw new BookingError(
        400,
        "OUTSIDE_STAY",
        "This date is outside the guest's stay. Book within their stay dates, or use the walk-in option.",
        { outsideStay: true }
      );
    }
    const folio = reservation.folios[0];
    if (!folio) throw new BookingError(400, "NO_OPEN_FOLIO", "The primary guest has no open folio to bill this appointment to");
    billingFolioId = folio.id;
    billingGuestLabel = `${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName ?? ""}`.trim();
  } else {
    const folio = await prisma.folio.findUnique({ where: { id: primary.folioId! } });
    if (!folio || folio.propertyId !== propertyId) throw new BookingError(404, "FOLIO_NOT_FOUND", "Folio not found at this property");
    if (folio.reservationId) {
      throw new BookingError(400, "FOLIO_IS_RESERVATION", "This folio belongs to a reservation — use reservationId instead");
    }
    if (folio.isClosed) throw new BookingError(400, "FOLIO_CLOSED", "This walk-in bill is already closed");
    billingFolioId = folio.id;
    billingGuestLabel = folio.walkInGuestName || "Walk-in guest";
    primaryWalkInIdentity = { walkInGuestName: folio.walkInGuestName ?? "Walk-in guest", walkInGuestContact: folio.walkInGuestContact };
  }

  const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });
  // The hub-wide Spa Outlet — REQUIRED for any folio posting from this module.
  const enterpriseSettings = await prisma.enterpriseSettings.findUnique({
    where: { enterpriseId: treatment.property.enterpriseId },
    include: { spaOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  const spaOutlet = enterpriseSettings?.spaOutlet ?? null;
  const allowAutoAssignment = settings?.allowAutoAssignment ?? true;
  const requireRoomAtBooking = settings?.requireRoomAtBooking ?? true;
  const requireTherapistAtBooking = settings?.requireTherapistAtBooking ?? true;
  // A hold posts nothing; an online booking always posts now (see forceChargeAtBooking).
  const chargeTiming = input.hold ? "ON_CONFIRM" : input.forceChargeAtBooking ? "AT_BOOKING" : settings?.chargeTiming ?? "AT_BOOKING";

  // No outlet, no posting (owner rule 2026-07-30). AT_COMPLETION bookings can still be
  // created — their posting is blocked at completion instead (src/lib/spa-lifecycle.ts).
  if (chargeTiming === "AT_BOOKING" && !spaOutlet) {
    throw new BookingError(
      400,
      "NO_OUTLET",
      "No Spa Outlet is linked — link one in the Hub (Charge Codes › Spa Outlet) before posting spa charges."
    );
  }

  let settlement: { paymentMethodId: string; referenceNumber: string | null } | null = null;
  if (input.settlement) {
    if (!primary.reservationId && !newWalkIn) {
      throw new BookingError(400, "SETTLEMENT_NOT_ALLOWED", "Pay-now settlement is only available for in-house guests.");
    }
    if (chargeTiming !== "AT_BOOKING") {
      throw new BookingError(400, "SETTLEMENT_NOT_ALLOWED", "Pay-now settlement isn't available when charges are deferred to completion.");
    }
    const method = await prisma.paymentMethod.findUnique({ where: { id: input.settlement.paymentMethodId } });
    if (!method || method.enterpriseId !== ctx.enterpriseId) {
      throw new BookingError(404, "PAYMENT_METHOD_NOT_FOUND", "Payment method not found");
    }
    settlement = { paymentMethodId: method.id, referenceNumber: input.settlement.referenceNumber };
  }

  // Lock every resource that COULD be assigned (every qualified therapist, every
  // compatible room) — not just the ones ultimately chosen — so "check candidates -> pick
  // -> insert" is race-free against any other booking touching the same candidate pool.
  const [allQualified, allCompatibleRoomIds] = await Promise.all([
    prisma.spaTherapistTreatment.findMany({ where: { treatmentId, qualified: true }, select: { therapistId: true } }),
    getCompatibleRoomIds(propertyId, treatmentId),
  ]);
  const resourceLocks = [
    ...allQualified.map((q) => lockKey.spaTherapist(propertyId, q.therapistId)),
    ...Array.from(allCompatibleRoomIds.keys()).map((roomId) => lockKey.spaRoom(propertyId, roomId)),
    ...(requestedRoomId ? [lockKey.spaRoom(propertyId, requestedRoomId)] : []),
  ];

  // The caller's cashier drawer for the AT_BOOKING charge and any pay-now settlement (A7).
  const shiftId = chargeTiming === "AT_BOOKING" ? (await ensureOpenShift(ctx, propertyId)).id : null;

  const appointment = await prisma.$transaction(async (tx) => {
    await lockKeys(tx, resourceLocks);

    // Resolve the room. Availability reads run under the lock (see db-lock.ts for why
    // reads through the global client are still consistent here).
    let roomId: string | null = null;
    const roomCandidates = await getAvailableRooms({ propertyId, treatmentId, partySize, date, blockedFromTime, blockedUntilTime });
    if (requestedRoomId) {
      if (!roomCandidates.some((r) => r.id === requestedRoomId)) {
        throw new BookingError(400, "SLOT_UNAVAILABLE", "The requested room is not available for this treatment/time");
      }
      roomId = requestedRoomId;
    } else if (allowAutoAssignment) {
      roomId = roomCandidates[0]?.id ?? null;
    }
    if (!roomId && requireRoomAtBooking) {
      throw new BookingError(400, "SLOT_UNAVAILABLE", "No room is available for this treatment/time");
    }

    // A therapist per participant, in order, excluding therapists already picked earlier
    // in this same request.
    const assignedTherapistIds: string[] = [];
    const resolvedParticipants = [];
    for (let i = 0; i < participantsInput.length; i++) {
      const p = participantsInput[i];
      const requestedGender = p.therapistId ? null : p.requestedGender || null;
      const candidates = await getAvailableTherapists({
        propertyId,
        treatmentId,
        date,
        blockedFromTime,
        blockedUntilTime,
        excludeTherapistIds: assignedTherapistIds,
        requiredTherapistId: p.therapistId,
        requiredGender: requestedGender,
      });
      let therapistId: string | null = null;
      if (p.therapistId) {
        if (!candidates.some((c) => c.id === p.therapistId)) {
          throw new BookingError(400, "SLOT_UNAVAILABLE", `The requested therapist is not available for participant ${i + 1}`);
        }
        therapistId = p.therapistId;
      } else if (allowAutoAssignment) {
        therapistId = candidates[0]?.id ?? null;
      }
      if (!therapistId && requireTherapistAtBooking) {
        const reason = requestedGender ? ` (${requestedGender.toLowerCase()} requested)` : "";
        throw new BookingError(400, "SLOT_UNAVAILABLE", `No therapist is available for participant ${i + 1}${reason}`);
      }
      if (therapistId) assignedTherapistIds.push(therapistId);

      // Participant 1 is its own reservation or the identity snapshotted off its walk-in
      // folio; every other participant is a reservation or a plain walk-in name/contact.
      const walkIn =
        i === 0
          ? primaryWalkInIdentity
          : p.walkInGuestName
            ? { walkInGuestName: p.walkInGuestName, walkInGuestContact: p.walkInGuestContact ?? null }
            : null;
      resolvedParticipants.push({
        participantIndex: i + 1,
        reservationId: p.reservationId ?? null,
        walkInGuestName: walkIn?.walkInGuestName ?? null,
        walkInGuestContact: walkIn?.walkInGuestContact ?? null,
        therapistId,
        requestedTherapistId: p.therapistId ?? null,
        requestedGender,
        notes: p.notes || null,
      });
    }

    // Charge/folio: AT_BOOKING posts now; AT_COMPLETION posts from the priceSnapshot at
    // completion (spa-lifecycle.ts). Either way the appointment remembers the folio it
    // bills to, so completion lands on the walk-in bill the desk opened for it rather than
    // a new one (paymentStatus NOT_POSTED + no folioLineItemId = "nothing posted yet").
    const folioId: string | null =
      billingFolioId ??
      (newWalkIn && !input.hold
        ? (
            await tx.folio.create({
              data: { propertyId, folioNumber: 1, walkInGuestName: newWalkIn.name.trim(), walkInGuestContact: newWalkIn.contact },
            })
          ).id
        : null);
    let folioLineItemId: string | null = null;
    let paymentStatus = "NOT_POSTED";
    let postedTotal: number | null = null;
    if (chargeTiming === "AT_BOOKING") {
      const postableCode = await tx.chargeCode.findUniqueOrThrow({
        where: { id: treatment.chargeCodeId },
        include: chargeCodeInclude(),
      });
      // Through the one posting service: the outlet's Tax Rule wins, and the Spa group's
      // own SVC/GST codes post alongside via this code's generates.
      const posted = await postCharge(tx, {
        folioId: folioId!,
        chargeCode: postableCode,
        inputAmount: priceSnapshot,
        settings: enterpriseSettings,
        pricesIncludeTaxes: treatment.property.pricesIncludeTaxes,
        date: resolveBusinessDate(treatment.property),
        description: `${treatment.name} — ${appointmentDate} ${startTime}${partySize > 1 ? ` (${partySize} guests)` : ""}`,
        outlet: spaOutlet,
        outletId: spaOutlet?.id ?? null,
        shiftId,
        postingContext: { adults: partySize, children: 0, nights: 1 },
      });
      folioLineItemId = posted.parent.id;
      paymentStatus = "POSTED_TO_FOLIO";
      postedTotal = posted.grandTotal;

      // Charge & pay now: settle the WHOLE posting (charge plus everything it generated).
      if (settlement && shiftId) {
        await tx.payment.create({
          data: {
            folioId: folioId!,
            paymentMethodId: settlement.paymentMethodId,
            shiftId,
            chargeCodeId: await resolvePaymentChargeCodeId(tx, settlement.paymentMethodId),
            amount: posted.grandTotal,
            referenceNumber: settlement.referenceNumber,
          },
        });
        paymentStatus = "PAID";
      }
    }

    const created = await tx.spaAppointment.create({
      data: {
        propertyId,
        treatmentId,
        treatmentNameSnapshot: treatment.name,
        durationMinutesSnapshot: treatment.defaultDurationMinutes,
        preparationBufferMinutesSnapshot: treatment.preparationBufferMinutes,
        cleanupBufferMinutesSnapshot: treatment.cleanupBufferMinutes,
        partySize,
        priceSnapshot,
        currencySnapshot: treatment.property.defaultCurrency,
        appointmentDate: dayStart(date),
        startTime,
        treatmentEndTime,
        blockedUntilTime,
        roomId,
        appointmentStatus: input.hold ? "TENTATIVE" : "CONFIRMED",
        holdExpiresAt: input.hold?.expiresAt ?? null,
        paymentStatus,
        folioId,
        folioLineItemId,
        notes: input.notes || null,
        bookedByUserId: ctx.userId,
        ...(input.source ? { source: input.source } : {}),
        participants: { create: resolvedParticipants },
      },
      include: spaAppointmentInclude,
    });
    if (input.onCreated) await input.onCreated(tx, created, postedTotal === null ? null : { grandTotal: postedTotal });
    return created;
  }, BOOKING_TX_OPTIONS);

  // Remember the request for next time — ONLY when it reflects a genuine, honored ask
  // (requestedTherapistId set and it's exactly who got assigned). Walk-ins have no
  // Profile to attach a preference to. Best-effort: never undoes a successful booking.
  for (const p of appointment.participants) {
    if (p.reservationId && p.requestedTherapistId && p.requestedTherapistId === p.therapistId) {
      const profileId = p.reservation?.primaryGuest?.upid;
      if (profileId) {
        await prisma.spaGuestTherapistPreference
          .upsert({
            where: { profileId_propertyId: { profileId, propertyId } },
            update: { therapistId: p.requestedTherapistId },
            create: { profileId, propertyId, therapistId: p.requestedTherapistId },
          })
          .catch(() => {});
      }
    }
  }

  await logActivity({
    ctx,
    module: "SPA",
    action: "CREATE",
    entityType: "SpaAppointment",
    entityId: appointment.id,
    description: `${input.hold ? "Held (online)" : "Booked"} ${treatment.name} for ${billingGuestLabel}${partySize > 1 ? ` + ${partySize - 1} other(s)` : ""}${settlement ? " — paid now" : ""}${input.source === "WEBSITE_API" && !input.hold ? " (online)" : ""}`,
  });

  return appointment;
}

// ---------------------------------------------------------------------------------------
// Booking API: quotes, confirming holds, expiring stale holds

export type SpaQuote = {
  treatmentId: string;
  partySize: number;
  /** The rate-card amount before the tax engine (what postCharge is given). */
  priceBeforeTax: number;
  charge: ChargePreview;
  currency: string;
  pricesIncludeTaxes: boolean;
};

/** What this treatment for this party on this date would cost, computed by the posting
 *  code the booking uses (previewCharge). Writes nothing. */
export async function quoteSpaTreatment(treatmentId: string, date: Date, partySize: number): Promise<SpaQuote> {
  const treatment = await prisma.spaTreatment.findUnique({ where: { id: treatmentId }, include: { rates: true, property: true } });
  if (!treatment) throw new BookingError(404, "TREATMENT_NOT_FOUND", "Treatment not found.");
  if (partySize < 1 || partySize > treatment.maxParticipants) {
    throw new BookingError(400, "PARTY_TOO_LARGE", `This treatment is for 1 to ${treatment.maxParticipants} guest(s).`);
  }
  const rate = rateForDate(treatment.rates, date);
  if (!rate) throw new BookingError(400, "NO_RATE", "No price is configured for this treatment on this date");
  const enterpriseSettings = await prisma.enterpriseSettings.findUnique({
    where: { enterpriseId: treatment.property.enterpriseId },
    include: { spaOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  const spaOutlet = enterpriseSettings?.spaOutlet ?? null;
  if (!spaOutlet) throw new BookingError(400, "NO_OUTLET", "No Spa Outlet is linked.");
  const priceBeforeTax = computeAppointmentTotal(rate, treatment.pricingMode, partySize);
  const chargeCode = await prisma.chargeCode.findUniqueOrThrow({ where: { id: treatment.chargeCodeId }, include: chargeCodeInclude() });
  const charge = await previewCharge(treatment.propertyId, {
    chargeCode,
    inputAmount: priceBeforeTax,
    settings: enterpriseSettings,
    pricesIncludeTaxes: treatment.property.pricesIncludeTaxes,
    date: resolveBusinessDate(treatment.property),
    description: treatment.name,
    outlet: spaOutlet,
    outletId: spaOutlet.id,
    postingContext: { adults: partySize, children: 0, nights: 1 },
  });
  return {
    treatmentId,
    partySize,
    priceBeforeTax,
    charge,
    currency: treatment.property.defaultCurrency,
    pricesIncludeTaxes: treatment.property.pricesIncludeTaxes,
  };
}

/**
 * Turn a Booking API hold (TENTATIVE) into a CONFIRMED appointment: name the guests, open
 * their walk-in bill, post the charge from the price fixed when the hold was made, and
 * settle it if the website reports it paid. Runs under the hold's own resource locks and
 * only while the hold is still live — once it has expired its therapist and room may
 * already belong to someone else, so an expired hold is refused, never re-checked.
 */
export async function confirmSpaHold(
  ctx: AuthContext,
  appointmentId: string,
  input: {
    guest: { name: string; contact: string | null };
    companions: string[];
    notes?: string | null;
    settlement?: { paymentMethodId: string; referenceNumber: string | null } | null;
    onConfirmed?: (tx: Prisma.TransactionClient, appointment: CreatedAppointment, posted: { grandTotal: number }) => Promise<void>;
  }
) {
  const hold = await prisma.spaAppointment.findUnique({
    where: { id: appointmentId },
    include: { participants: { orderBy: { participantIndex: "asc" } }, treatment: true, property: true },
  });
  if (!hold) throw new BookingError(404, "HOLD_NOT_FOUND", "Hold not found.");
  await assertPropertyModuleAccess(ctx, hold.propertyId, "SPA");

  const enterpriseSettings = await prisma.enterpriseSettings.findUnique({
    where: { enterpriseId: hold.property.enterpriseId },
    include: { spaOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  const spaOutlet = enterpriseSettings?.spaOutlet ?? null;
  if (!spaOutlet) throw new BookingError(400, "NO_OUTLET", "No Spa Outlet is linked.");
  if (input.settlement) {
    const method = await prisma.paymentMethod.findUnique({ where: { id: input.settlement.paymentMethodId } });
    if (!method || method.enterpriseId !== ctx.enterpriseId) throw new BookingError(404, "PAYMENT_METHOD_NOT_FOUND", "Payment method not found");
  }
  const chargeCode = await prisma.chargeCode.findUniqueOrThrow({ where: { id: hold.treatment.chargeCodeId }, include: chargeCodeInclude() });
  const shift = await ensureOpenShift(ctx, hold.propertyId);
  const locks = [
    ...(hold.roomId ? [lockKey.spaRoom(hold.propertyId, hold.roomId)] : []),
    ...hold.participants.filter((p) => p.therapistId).map((p) => lockKey.spaTherapist(hold.propertyId, p.therapistId!)),
  ];
  const name = input.guest.name.trim();
  if (!name) throw new BookingError(400, "VALIDATION", "The guest's name is required");

  const appointment = await prisma.$transaction(async (tx) => {
    await lockKeys(tx, locks);
    const current = await tx.spaAppointment.findUniqueOrThrow({ where: { id: appointmentId } });
    if (current.appointmentStatus !== "TENTATIVE") throw new BookingError(409, "HOLD_USED", "This hold has already been booked.");
    if (!current.holdExpiresAt || current.holdExpiresAt <= new Date()) {
      throw new BookingError(409, "HOLD_EXPIRED", "The hold has expired. Check availability and try again.");
    }

    const folio = await tx.folio.create({
      data: { propertyId: hold.propertyId, folioNumber: 1, walkInGuestName: name, walkInGuestContact: input.guest.contact },
    });
    const posted = await postCharge(tx, {
      folioId: folio.id,
      chargeCode,
      inputAmount: hold.priceSnapshot,
      settings: enterpriseSettings,
      pricesIncludeTaxes: hold.property.pricesIncludeTaxes,
      date: resolveBusinessDate(hold.property),
      description: `${hold.treatmentNameSnapshot} — ${hold.appointmentDate.toISOString().slice(0, 10)} ${hold.startTime}${hold.partySize > 1 ? ` (${hold.partySize} guests)` : ""}`,
      outlet: spaOutlet,
      outletId: spaOutlet.id,
      shiftId: shift.id,
      postingContext: { adults: hold.partySize, children: 0, nights: 1 },
    });
    if (input.settlement) {
      await tx.payment.create({
        data: {
          folioId: folio.id,
          paymentMethodId: input.settlement.paymentMethodId,
          shiftId: shift.id,
          chargeCodeId: await resolvePaymentChargeCodeId(tx, input.settlement.paymentMethodId),
          amount: posted.grandTotal,
          referenceNumber: input.settlement.referenceNumber,
        },
      });
    }
    // Name the party: participant 1 is the booking guest, the rest their companions.
    for (const p of hold.participants) {
      const guestName = p.participantIndex === 1 ? name : input.companions[p.participantIndex - 2]?.trim() || `Guest ${p.participantIndex}`;
      await tx.spaAppointmentParticipant.update({
        where: { id: p.id },
        data: { walkInGuestName: guestName, walkInGuestContact: p.participantIndex === 1 ? input.guest.contact : null },
      });
    }
    await tx.spaAppointment.update({
      where: { id: appointmentId },
      data: {
        appointmentStatus: "CONFIRMED",
        holdExpiresAt: null,
        folioId: folio.id,
        folioLineItemId: posted.parent.id,
        paymentStatus: input.settlement ? "PAID" : "POSTED_TO_FOLIO",
        notes: input.notes || null,
      },
    });
    const confirmed = await tx.spaAppointment.findUniqueOrThrow({ where: { id: appointmentId }, include: spaAppointmentInclude });
    if (input.onConfirmed) await input.onConfirmed(tx, confirmed, { grandTotal: posted.grandTotal });
    return confirmed;
  }, BOOKING_TX_OPTIONS);

  await logActivity({
    ctx,
    module: "SPA",
    action: "CREATE",
    entityType: "SpaAppointment",
    entityId: appointmentId,
    description: `Booked ${hold.treatmentNameSnapshot} for ${name}${hold.partySize > 1 ? ` + ${hold.partySize - 1} other(s)` : ""} (online)${input.settlement ? " — paid online" : ""}`,
  });
  return appointment;
}

/**
 * Lazy expiry (SPA_PLAN.md §7): Booking API holds past their time stop blocking on their
 * own (getBlockingAppointments); this tidies the rows so the desk's schedule doesn't show
 * them as tentative forever. Called from the read paths that would display them.
 */
export async function expireStaleSpaHolds(propertyId: string): Promise<void> {
  const now = new Date();
  const stale = await prisma.spaAppointment.findMany({
    where: { propertyId, appointmentStatus: "TENTATIVE", holdExpiresAt: { lte: now } },
    select: { id: true },
  });
  if (stale.length === 0) return;
  const ids = stale.map((a) => a.id);
  await prisma.$transaction([
    prisma.spaAppointment.updateMany({
      where: { id: { in: ids }, appointmentStatus: "TENTATIVE" },
      data: { appointmentStatus: "CANCELLED", cancelledAt: now, cancellationReasonCode: "HOLD_EXPIRED" },
    }),
    prisma.apiActivityBooking.updateMany({ where: { spaAppointmentId: { in: ids }, status: "HELD" }, data: { status: "EXPIRED" } }),
  ]);
}
