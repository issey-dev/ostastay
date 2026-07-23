import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { resolveChargeTax } from "@/lib/tax-calc";
import { resolveBusinessDate } from "@/lib/business-date";
import { addMinutesToTime, rateForDate, computeAppointmentTotal } from "@/lib/spa";
import { dayStart, getAvailableRooms, getAvailableTherapists, getCompatibleRoomIds } from "@/lib/spa-availability";
import { withResourceLocks, roomLockKey, therapistLockKey } from "@/lib/spa-resource-lock";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  treatment: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  participants: {
    include: {
      reservation: { include: { primaryGuest: true, assignments: { include: { room: true } } } },
      therapist: { select: { id: true, displayName: true } },
    },
  },
};

// Lists a property's appointments for one date — the booking page's "today's
// schedule" list. The full tape-chart grid is Phase 4; this is a plain list for now.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const dateParam = searchParams.get("date");
    if (!propertyId || !dateParam) {
      return NextResponse.json({ error: "propertyId and date are required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    const date = new Date(dateParam);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const appointments = await prisma.spaAppointment.findMany({
      where: { propertyId, appointmentDate: dayStart(date) },
      include: includeShape,
      orderBy: [{ startTime: "asc" }],
    });
    return NextResponse.json(appointments);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Books a treatment for one or more in-house guests sharing one room and one time
// window, each with their own therapist (SPA_PLAN.md §3 row 7 / §7). Walk-in support
// (folioId instead of reservationId, per participant) is Phase 3 — every participant
// must be an in-house reservationId for now, matching how Excursions' own booking
// route was in-house-only in its Phase 2.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "create");

    const body = await request.json();
    const { propertyId, treatmentId, appointmentDate, startTime, roomId: requestedRoomId, notes } = body;
    const participantsInput: { reservationId?: string; therapistId?: string; notes?: string }[] = Array.isArray(body.participants)
      ? body.participants
      : [];

    if (!propertyId || !treatmentId || !appointmentDate || !startTime) {
      return NextResponse.json({ error: "propertyId, treatmentId, appointmentDate, and startTime are required" }, { status: 400 });
    }
    if (participantsInput.length === 0) {
      return NextResponse.json({ error: "At least one participant is required" }, { status: 400 });
    }
    for (const p of participantsInput) {
      if (!p.reservationId) {
        return NextResponse.json({ error: "Each participant currently requires reservationId (walk-in booking isn't available yet)" }, { status: 400 });
      }
    }

    const treatment = await prisma.spaTreatment.findUnique({
      where: { id: treatmentId },
      include: { rates: true, chargeCode: { include: { taxProfile: { include: { rates: true } } } }, property: true },
    });
    if (!treatment || treatment.propertyId !== propertyId) {
      return NextResponse.json({ error: "Treatment not found at this property" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    if (!treatment.isActive) {
      return NextResponse.json({ error: "This treatment is not currently active" }, { status: 400 });
    }
    if (!treatment.allowInHouseGuest) {
      return NextResponse.json({ error: "This treatment cannot be booked for in-house guests" }, { status: 400 });
    }
    const partySize = participantsInput.length;
    if (partySize > treatment.maxParticipants) {
      return NextResponse.json({ error: `This treatment allows at most ${treatment.maxParticipants} participant(s)` }, { status: 400 });
    }

    const date = new Date(appointmentDate);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid appointmentDate" }, { status: 400 });
    }

    const rate = rateForDate(treatment.rates, date);
    if (!rate) {
      return NextResponse.json({ error: "No price is configured for this treatment on this date" }, { status: 400 });
    }
    const priceSnapshot = computeAppointmentTotal(rate, treatment.pricingMode, partySize);

    const treatmentEndTime = addMinutesToTime(startTime, treatment.defaultDurationMinutes);
    const blockedUntilTime = addMinutesToTime(treatmentEndTime, treatment.cleanupBufferMinutes);
    const blockedFromTime = addMinutesToTime(startTime, -treatment.preparationBufferMinutes);

    // Resolve every in-house reservation up front (outside the lock — read-only,
    // doesn't touch shared spa resources) and validate they belong to this property.
    const reservationIds = participantsInput.map((p) => p.reservationId!);
    const reservations = await prisma.reservation.findMany({
      where: { id: { in: reservationIds } },
      include: { folios: { where: { isClosed: false } }, primaryGuest: true },
    });
    const reservationById = new Map(reservations.map((r) => [r.id, r]));
    for (const id of reservationIds) {
      const r = reservationById.get(id);
      if (!r || r.propertyId !== propertyId) {
        return NextResponse.json({ error: "Reservation not found at this property" }, { status: 404 });
      }
    }
    const billingReservation = reservationById.get(reservationIds[0])!;
    const billingFolio = billingReservation.folios[0];
    if (!billingFolio) {
      return NextResponse.json({ error: "The primary guest has no open folio to bill this appointment to" }, { status: 400 });
    }

    const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });
    const allowAutoAssignment = settings?.allowAutoAssignment ?? true;
    const requireRoomAtBooking = settings?.requireRoomAtBooking ?? true;
    const requireTherapistAtBooking = settings?.requireTherapistAtBooking ?? true;
    const chargeTiming = settings?.chargeTiming ?? "AT_BOOKING";

    // Lock every resource that COULD be assigned to this booking (every therapist
    // qualified for the treatment, every compatible room) — not just the ones
    // ultimately chosen — so the whole "check candidates -> pick -> insert" sequence
    // below is race-free against any other concurrent Spa booking touching the same
    // candidate pool (SPA_PLAN.md §7's corrected concurrency strategy).
    const [allQualified, allCompatibleRoomIds] = await Promise.all([
      prisma.spaTherapistTreatment.findMany({ where: { treatmentId, qualified: true }, select: { therapistId: true } }),
      getCompatibleRoomIds(propertyId, treatmentId),
    ]);
    const lockKeys = [
      ...allQualified.map((q) => therapistLockKey(propertyId, q.therapistId)),
      ...Array.from(allCompatibleRoomIds.keys()).map((roomId) => roomLockKey(propertyId, roomId)),
      ...(requestedRoomId ? [roomLockKey(propertyId, requestedRoomId)] : []),
    ];

    const result = await withResourceLocks(lockKeys, async () => {
      // Resolve the room.
      let roomId: string | null = null;
      const roomCandidates = await getAvailableRooms({ propertyId, treatmentId, partySize, date, blockedFromTime, blockedUntilTime });
      if (requestedRoomId) {
        if (!roomCandidates.some((r) => r.id === requestedRoomId)) {
          return { error: "The requested room is not available for this treatment/time" };
        }
        roomId = requestedRoomId;
      } else if (allowAutoAssignment) {
        roomId = roomCandidates[0]?.id ?? null;
      }
      if (!roomId && requireRoomAtBooking) {
        return { error: "No room is available for this treatment/time" };
      }

      // Resolve a therapist per participant, in order, excluding therapists already
      // assigned earlier in this same request.
      const assignedTherapistIds: string[] = [];
      const resolvedParticipants: { reservationId: string; therapistId: string | null; notes: string | null }[] = [];
      for (const p of participantsInput) {
        const candidates = await getAvailableTherapists({
          propertyId,
          treatmentId,
          date,
          blockedFromTime,
          blockedUntilTime,
          excludeTherapistIds: assignedTherapistIds,
        });
        let therapistId: string | null = null;
        if (p.therapistId) {
          if (!candidates.some((c) => c.id === p.therapistId)) {
            return { error: `The requested therapist is not available for participant ${resolvedParticipants.length + 1}` };
          }
          therapistId = p.therapistId;
        } else if (allowAutoAssignment) {
          therapistId = candidates[0]?.id ?? null;
        }
        if (!therapistId && requireTherapistAtBooking) {
          return { error: `No therapist is available for participant ${resolvedParticipants.length + 1}` };
        }
        if (therapistId) assignedTherapistIds.push(therapistId);
        resolvedParticipants.push({ reservationId: p.reservationId!, therapistId, notes: p.notes || null });
      }

      // Charge/folio (AT_BOOKING only — AT_COMPLETION defers posting to the
      // "complete" action, not built until Phase 5; the appointment is still created
      // now with paymentStatus NOT_POSTED and no folio link).
      let folioId: string | null = null;
      let folioLineItemId: string | null = null;
      let paymentStatus = "NOT_POSTED";

      const created = await prisma.$transaction(async (tx) => {
        if (chargeTiming === "AT_BOOKING") {
          const enterpriseSettings = await tx.enterpriseSettings.findUnique({ where: { enterpriseId: treatment.property.enterpriseId } });
          const { baseAmount, taxAmount, serviceChargeAmount } = resolveChargeTax({
            chargeCode: treatment.chargeCode,
            inputAmount: priceSnapshot,
            settings: enterpriseSettings,
            pricesIncludeTaxes: treatment.property.pricesIncludeTaxes,
          });
          const lineItem = await tx.folioLineItem.create({
            data: {
              folioId: billingFolio.id,
              chargeCodeId: treatment.chargeCodeId,
              amount: baseAmount,
              taxAmount,
              serviceChargeAmount,
              description: `${treatment.name} — ${appointmentDate} ${startTime}${partySize > 1 ? ` (${partySize} guests)` : ""}`,
              date: resolveBusinessDate(treatment.property),
            },
          });
          folioId = billingFolio.id;
          folioLineItemId = lineItem.id;
          paymentStatus = "POSTED_TO_FOLIO";
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
            notes: notes || null,
            bookedByUserId: ctx.userId,
            participants: {
              create: resolvedParticipants.map((p, i) => ({
                participantIndex: i + 1,
                reservationId: p.reservationId,
                therapistId: p.therapistId,
                notes: p.notes,
              })),
            },
          },
          include: includeShape,
        });
      });

      return { appointment: created };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const guestLabel = `${billingReservation.primaryGuest.firstName} ${billingReservation.primaryGuest.lastName ?? ""}`.trim();
    await logActivity({
      ctx,
      module: "SPA",
      action: "CREATE",
      entityType: "SpaAppointment",
      entityId: result.appointment.id,
      description: `Booked ${treatment.name} for ${guestLabel}${partySize > 1 ? ` + ${partySize - 1} other(s)` : ""}`,
    });

    return NextResponse.json(result.appointment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
