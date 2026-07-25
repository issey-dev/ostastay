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
      requestedTherapist: { select: { id: true, displayName: true } },
    },
  },
};

// Lists a property's appointments for one date — the booking page's "today's
// schedule" list. The full tape-chart grid is Phase 4; this is a plain list for now.
// With `openWalkIns=true` instead of `date`: every still-open walk-in-billed
// appointment regardless of date — the "pay later" retrieval path, same reasoning as
// GET /api/excursions/bookings (nothing else in the app has a browsable list of open
// walk-in folios; SpaAppointment.folioId makes this possible here too).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    if (searchParams.get("openWalkIns") === "true") {
      const appointments = await prisma.spaAppointment.findMany({
        where: {
          propertyId,
          appointmentStatus: { notIn: ["CANCELLED"] },
          folio: { isClosed: false },
          participants: { some: { participantIndex: 1, walkInGuestName: { not: null } } },
        },
        include: includeShape,
        orderBy: [{ createdAt: "desc" }],
      });
      return NextResponse.json(appointments);
    }

    // Date-range mode (from/to), optionally filtered to one therapist — powers the Spa
    // Schedule calendar. A therapist matches an appointment if any participant is assigned
    // to them.
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from && to) {
      const therapistId = searchParams.get("therapistId");
      const rangeAppointments = await prisma.spaAppointment.findMany({
        where: {
          propertyId,
          appointmentDate: { gte: dayStart(new Date(from)), lte: dayStart(new Date(to)) },
          ...(therapistId ? { participants: { some: { therapistId } } } : {}),
        },
        include: includeShape,
        orderBy: [{ appointmentDate: "asc" }, { startTime: "asc" }],
      });
      return NextResponse.json(rangeAppointments);
    }

    const dateParam = searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json({ error: "date, from/to range, or openWalkIns=true is required" }, { status: 400 });
    }
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

// Books a treatment for one or more guests sharing one room and one time window, each
// with their own therapist (SPA_PLAN.md §3 row 7 / §7). Billing is always
// single-folio, resolved from participant 1 (SPA_PLAN.md §4):
//   - reservationId  -> the guest's own open room folio (in-house).
//   - folioId        -> an already-open walk-in folio (opened first via the existing
//                        POST /api/folios/walk-in, same as Excursions' Phase 3) — only
//                        valid for participant 1, since that's the only participant
//                        billing ever looks at.
// Any OTHER participant (a couple/group treatment's companions) can be either
// reservationId (another in-house guest) or a plain walkInGuestName/Contact with no
// folio at all — they're not billed separately, so they don't need one.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "create");

    const body = await request.json();
    const { propertyId, treatmentId, appointmentDate, startTime, roomId: requestedRoomId, notes } = body;
    const participantsInput: {
      reservationId?: string;
      folioId?: string;
      walkInGuestName?: string;
      walkInGuestContact?: string;
      // A specific requested therapist (existing field, unchanged meaning: "book this
      // exact person or fail") — validated against real candidates below either way.
      therapistId?: string;
      // Hard gender filter, only consulted when therapistId is absent — a named
      // request already implies a specific person, a gender filter would be moot.
      requestedGender?: string;
      notes?: string;
    }[] = Array.isArray(body.participants) ? body.participants : [];

    if (!propertyId || !treatmentId || !appointmentDate || !startTime) {
      return NextResponse.json({ error: "propertyId, treatmentId, appointmentDate, and startTime are required" }, { status: 400 });
    }
    if (participantsInput.length === 0) {
      return NextResponse.json({ error: "At least one participant is required" }, { status: 400 });
    }
    for (let i = 0; i < participantsInput.length; i++) {
      const p = participantsInput[i];
      const identityCount = [p.reservationId, p.folioId, p.walkInGuestName].filter(Boolean).length;
      if (identityCount !== 1) {
        return NextResponse.json({ error: `Participant ${i + 1} needs exactly one of reservationId, folioId, or walkInGuestName` }, { status: 400 });
      }
      if (p.folioId && i > 0) {
        return NextResponse.json({ error: "Only the first participant can be billed to a walk-in folio (folioId)" }, { status: 400 });
      }
      if (p.walkInGuestName && i === 0) {
        return NextResponse.json({ error: "The first participant must be an in-house reservation or an already-open walk-in folio (folioId) — plain walk-in name isn't billable yet" }, { status: 400 });
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
    const primary = participantsInput[0];
    if (primary.reservationId && !treatment.allowInHouseGuest) {
      return NextResponse.json({ error: "This treatment cannot be booked for in-house guests" }, { status: 400 });
    }
    if (primary.folioId && !treatment.allowWalkIn) {
      return NextResponse.json({ error: "This treatment cannot be booked for walk-in guests" }, { status: 400 });
    }
    const partySize = participantsInput.length;
    if (partySize > treatment.maxParticipants) {
      return NextResponse.json({ error: `This treatment allows at most ${treatment.maxParticipants} participant(s)` }, { status: 400 });
    }

    const date = new Date(appointmentDate);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid appointmentDate" }, { status: 400 });
    }
    // Found via live-testing: nothing previously stopped a calendar date before the
    // property's business date from being booked at all — a stray UI click (or a
    // direct API call) could confirm and charge an appointment for a date that had
    // already passed, with no rejection anywhere in the stack. Date-only guard, not
    // time-of-day — a same-day booking whose slot has already elapsed today is a
    // separate, more granular check the availability engine doesn't do yet either
    // (see SPA_PLAN.md §21's existing note on this class of gap).
    if (dayStart(date) < dayStart(resolveBusinessDate(treatment.property))) {
      return NextResponse.json({ error: "Cannot book an appointment for a date that has already passed" }, { status: 400 });
    }

    const rate = rateForDate(treatment.rates, date);
    if (!rate) {
      return NextResponse.json({ error: "No price is configured for this treatment on this date" }, { status: 400 });
    }
    const priceSnapshot = computeAppointmentTotal(rate, treatment.pricingMode, partySize);

    const treatmentEndTime = addMinutesToTime(startTime, treatment.defaultDurationMinutes);
    const blockedUntilTime = addMinutesToTime(treatmentEndTime, treatment.cleanupBufferMinutes);
    const blockedFromTime = addMinutesToTime(startTime, -treatment.preparationBufferMinutes);

    // Resolve every in-house reservation referenced by ANY participant up front
    // (read-only, doesn't touch shared spa resources) and validate each belongs to
    // this property.
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
        return NextResponse.json({ error: "Reservation not found at this property" }, { status: 404 });
      }
    }

    // Resolve the billing folio from participant 1 — either their own open room
    // folio, or an already-open walk-in folio (never a reservation's own folio
    // smuggled in through folioId, same guard Excursions' booking route uses).
    let billingFolioId: string;
    let billingGuestLabel: string;
    let primaryWalkInIdentity: { walkInGuestName: string; walkInGuestContact: string | null } | null = null;
    if (primary.reservationId) {
      const reservation = reservationById.get(primary.reservationId)!;
      // In-house appointments must fall WITHIN the guest's stay — the charge is realized on
      // their room folio, so it can't sit outside the dates they're actually here. An
      // out-of-stay date should be booked as a walk-in instead.
      const apptMs = dayStart(date).getTime();
      if (apptMs < dayStart(new Date(reservation.checkInDate)).getTime() || apptMs > dayStart(new Date(reservation.checkOutDate)).getTime()) {
        return NextResponse.json(
          { error: "This date is outside the guest's stay. Book within their stay dates, or use the walk-in option.", outsideStay: true },
          { status: 400 }
        );
      }
      const folio = reservation.folios[0];
      if (!folio) {
        return NextResponse.json({ error: "The primary guest has no open folio to bill this appointment to" }, { status: 400 });
      }
      billingFolioId = folio.id;
      billingGuestLabel = `${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName ?? ""}`.trim();
    } else {
      const folio = await prisma.folio.findUnique({ where: { id: primary.folioId! } });
      if (!folio || folio.propertyId !== propertyId) {
        return NextResponse.json({ error: "Folio not found at this property" }, { status: 404 });
      }
      if (folio.reservationId) {
        return NextResponse.json({ error: "This folio belongs to a reservation — use reservationId instead" }, { status: 400 });
      }
      if (folio.isClosed) {
        return NextResponse.json({ error: "This walk-in bill is already closed" }, { status: 400 });
      }
      billingFolioId = folio.id;
      billingGuestLabel = folio.walkInGuestName || "Walk-in guest";
      primaryWalkInIdentity = { walkInGuestName: folio.walkInGuestName ?? "Walk-in guest", walkInGuestContact: folio.walkInGuestContact };
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
      const resolvedParticipants: {
        reservationId: string | null;
        walkInGuestName: string | null;
        walkInGuestContact: string | null;
        therapistId: string | null;
        requestedTherapistId: string | null;
        requestedGender: string | null;
        notes: string | null;
      }[] = [];
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
            return { error: `The requested therapist is not available for participant ${i + 1}` };
          }
          therapistId = p.therapistId;
        } else if (allowAutoAssignment) {
          therapistId = candidates[0]?.id ?? null;
        }
        if (!therapistId && requireTherapistAtBooking) {
          const reason = requestedGender ? ` (${requestedGender.toLowerCase()} requested)` : "";
          return { error: `No therapist is available for participant ${i + 1}${reason}` };
        }
        if (therapistId) assignedTherapistIds.push(therapistId);

        // Identity: participant 1 either resolves to its own reservation, or (if
        // billed via folioId) the identity snapshotted off that walk-in folio above.
        // Every other participant is either another reservation or a plain
        // walk-in name/contact typed at booking time — see the file header.
        const walkIn = i === 0 ? primaryWalkInIdentity : p.walkInGuestName ? { walkInGuestName: p.walkInGuestName, walkInGuestContact: p.walkInGuestContact ?? null } : null;
        resolvedParticipants.push({
          reservationId: p.reservationId ?? null,
          walkInGuestName: walkIn?.walkInGuestName ?? null,
          walkInGuestContact: walkIn?.walkInGuestContact ?? null,
          therapistId,
          requestedTherapistId: p.therapistId ?? null,
          requestedGender,
          notes: p.notes || null,
        });
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
              folioId: billingFolioId,
              chargeCodeId: treatment.chargeCodeId,
              amount: baseAmount,
              taxAmount,
              serviceChargeAmount,
              description: `${treatment.name} — ${appointmentDate} ${startTime}${partySize > 1 ? ` (${partySize} guests)` : ""}`,
              date: resolveBusinessDate(treatment.property),
            },
          });
          folioId = billingFolioId;
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
                walkInGuestName: p.walkInGuestName,
                walkInGuestContact: p.walkInGuestContact,
                therapistId: p.therapistId,
                requestedTherapistId: p.requestedTherapistId,
                requestedGender: p.requestedGender,
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

    // Remember the request for next time — ONLY when it reflects a genuine, honored
    // ask (requestedTherapistId set and it's exactly who got assigned), never for a
    // gender filter or a plain auto-assign. Walk-in participants have no Profile to
    // attach a preference to, so this only ever applies to reservation-linked guests.
    // Best-effort: a failure here shouldn't undo an otherwise-successful booking.
    for (const p of result.appointment.participants) {
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
      entityId: result.appointment.id,
      description: `Booked ${treatment.name} for ${billingGuestLabel}${partySize > 1 ? ` + ${partySize - 1} other(s)` : ""}`,
    });

    return NextResponse.json(result.appointment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
