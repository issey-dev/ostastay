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
  /** "Charge & pay now" — in-house only, AT_BOOKING only. */
  settlement?: { paymentMethodId: string; referenceNumber: string | null } | null;
};

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
  for (let i = 0; i < participantsInput.length; i++) {
    const p = participantsInput[i];
    const identityCount = [p.reservationId, p.folioId, p.walkInGuestName].filter(Boolean).length;
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
  if (primary.folioId && !treatment.allowWalkIn) {
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
  let billingFolioId: string;
  let billingGuestLabel: string;
  let primaryWalkInIdentity: { walkInGuestName: string; walkInGuestContact: string | null } | null = null;
  if (primary.reservationId) {
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
  const chargeTiming = settings?.chargeTiming ?? "AT_BOOKING";

  // No outlet, no posting (owner rule 2026-07-30). AT_COMPLETION bookings can still be
  // created — their posting is blocked at completion instead (src/lib/spa-lifecycle.ts).
  if (chargeTiming === "AT_BOOKING" && !spaOutlet) {
    throw new BookingError(
      400,
      "NO_OUTLET",
      "No Spa Outlet is linked — link one under Controls > Spa (it applies to every property) before posting spa charges."
    );
  }

  let settlement: { paymentMethodId: string; referenceNumber: string | null } | null = null;
  if (input.settlement) {
    if (!primary.reservationId) {
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
    const folioId: string = billingFolioId;
    let folioLineItemId: string | null = null;
    let paymentStatus = "NOT_POSTED";
    if (chargeTiming === "AT_BOOKING") {
      const postableCode = await tx.chargeCode.findUniqueOrThrow({
        where: { id: treatment.chargeCodeId },
        include: chargeCodeInclude(),
      });
      // Through the one posting service: the outlet's Tax Rule wins, and the Spa group's
      // own SVC/GST codes post alongside via this code's generates.
      const posted = await postCharge(tx, {
        folioId: billingFolioId,
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

      // Charge & pay now: settle the WHOLE posting (charge plus everything it generated).
      if (settlement && shiftId) {
        await tx.payment.create({
          data: {
            folioId: billingFolioId,
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

    return tx.spaAppointment.create({
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
        appointmentStatus: "CONFIRMED",
        paymentStatus,
        folioId,
        folioLineItemId,
        notes: input.notes || null,
        bookedByUserId: ctx.userId,
        participants: { create: resolvedParticipants },
      },
      include: spaAppointmentInclude,
    });
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
    description: `Booked ${treatment.name} for ${billingGuestLabel}${partySize > 1 ? ` + ${partySize - 1} other(s)` : ""}${settlement ? " — paid now" : ""}`,
  });

  return appointment;
}
