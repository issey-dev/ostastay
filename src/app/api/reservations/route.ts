import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { materializeReservationAllocations } from "@/lib/allocations-server";
import { validateSpecialRequestCodes } from "@/lib/special-requests";
import { findTypeAvailabilityConflicts, hasRoomConflict } from "@/lib/availability";
import { allocateSequenceNumber } from "@/lib/document-sequence";
import { logActivity } from "@/lib/activity-log";
import { assignmentsAreContiguous, detectScheduledRoomMove } from "@/lib/reservation-assignments";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const reservations = await prisma.reservation.findMany({
      where: { propertyId },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: {
            roomType: true,
            room: {
              include: {
                housekeepingTasks: {
                  where: { taskType: 'SPECIAL_REQUEST' },
                  orderBy: { createdAt: 'desc' }
                }
              }
            },
            ratePlan: true
          }
        },
        folios: { include: { payments: { select: { amount: true, isRefund: true } } } },
        allocations: {
          include: {
            allocation: {
              include: { rates: true, chargeCode: { select: { code: true } } },
            },
          },
        },
        specialRequests: true,
      },
      orderBy: { checkInDate: 'asc' },
      take: 100, // Limit for dashboard performance
    });
    return NextResponse.json(reservations);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "create");

    const body = await request.json();

    if (!body.propertyId || !body.primaryGuestId || !body.checkInDate || !body.checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (new Date(body.checkOutDate) <= new Date(body.checkInDate)) {
      return NextResponse.json({ error: "Check-out date must be after check-in date" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const primaryGuest = await prisma.profile.findUnique({ where: { upid: body.primaryGuestId } });
    if (!primaryGuest || primaryGuest.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Guest profile not found" }, { status: 404 });
    }

    // Defaults the initial folio's settlement method to City Ledger when the attached
    // TA/corporate profile is an activated credit account — staff can still override it
    // afterward in the Folio Panel; not re-evaluated on later edits so an override isn't
    // silently clobbered. payeeProfileId is set alongside it so the folio is
    // identifiable as this account's invoice throughout the stay (shown on printed
    // documents, etc) — the actual transfer to the account only happens at checkout
    // (see check-out/route.ts), not here.
    let initialSettlementMethod = "DIRECT";
    let initialPayeeProfileId: string | null = null;
    if (body.travelAgentId) {
      const travelAgent = await prisma.profile.findUnique({ where: { upid: body.travelAgentId } });
      if (!travelAgent || travelAgent.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Travel agent profile not found" }, { status: 404 });
      }
      if (travelAgent.isCreditAccount) {
        initialSettlementMethod = "CITY_LEDGER";
        initialPayeeProfileId = travelAgent.upid;
      }
    }

    if (Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0) {
      const accompanying = await prisma.profile.findMany({ where: { upid: { in: body.accompanyingGuestIds } } });
      if (accompanying.length !== body.accompanyingGuestIds.length || accompanying.some((p) => p.enterpriseId !== ctx.enterpriseId)) {
        return NextResponse.json({ error: "One or more accompanying guest profiles were not found" }, { status: 404 });
      }
      // Hard cap: accompanying guests can't exceed the pax not already occupied by the
      // primary guest (adults + children, minus the primary guest's own slot).
      const maxAccompanying = Math.max(0, (parseInt(body.adults) || 1) + (parseInt(body.children) || 0) - 1);
      if (body.accompanyingGuestIds.length > maxAccompanying) {
        return NextResponse.json({ error: `Only ${maxAccompanying} accompanying guest(s) can be attached for ${body.adults} adult(s) and ${body.children || 0} child(ren).` }, { status: 400 });
      }
    }

    const specialRequests = await validateSpecialRequestCodes(ctx.enterpriseId, body.specialRequestCodes);
    if (!specialRequests.ok) {
      return NextResponse.json({ error: specialRequests.error }, { status: 400 });
    }

    const assignmentsInput = body.assignments ? body.assignments : [
      {
        roomTypeId: body.roomTypeId,
        roomId: body.roomId || null,
        ratePlanId: body.ratePlanId,
        overrideRate: body.overrideRate || null,
        startDate: new Date(body.checkInDate),
        endDate: new Date(body.checkOutDate)
      }
    ];

    // Hard rule: split-stay segments must be back-to-back with no gaps between them.
    if (!assignmentsAreContiguous(assignmentsInput)) {
      return NextResponse.json({ error: "Segments must run back-to-back with no gaps between stays." }, { status: 400 });
    }

    // Non-blocking: a room type whose maxOccupancy is exceeded by this reservation's
    // adults+children (infants don't count toward occupancy, same convention as Green
    // Tax) still books — front desk may legitimately override for a crib, rollaway,
    // etc. — but the response flags it so the UI can surface a warning.
    const totalOccupants = (parseInt(body.adults) || 1) + (parseInt(body.children) || 0);
    const overCapacityRoomTypes = new Set<string>();

    for (const a of assignmentsInput) {
      const [roomType, ratePlan, room] = await Promise.all([
        prisma.roomType.findUnique({ where: { id: a.roomTypeId } }),
        prisma.ratePlan.findUnique({ where: { id: a.ratePlanId } }),
        a.roomId ? prisma.room.findUnique({ where: { id: a.roomId } }) : Promise.resolve(null),
      ]);
      if (!roomType || roomType.propertyId !== body.propertyId) {
        return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
      }
      if (!roomType.isActive) {
        return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 });
      }
      if (!ratePlan || ratePlan.propertyId !== body.propertyId) {
        return NextResponse.json({ error: "Rate plan does not belong to this property" }, { status: 400 });
      }
      if (a.roomId && (!room || room.propertyId !== body.propertyId || room.status === "OUT_OF_SERVICE")) {
        return NextResponse.json({ error: "Room does not belong to this property or is out of service" }, { status: 400 });
      }
      if (totalOccupants > roomType.maxOccupancy) {
        overCapacityRoomTypes.add(`${roomType.name} (max ${roomType.maxOccupancy})`);
      }
      // A specifically-requested room must actually be free for the segment's dates.
      if (a.roomId) {
        const roomTaken = await hasRoomConflict({
          roomId: a.roomId,
          startDate: new Date(a.startDate),
          endDate: new Date(a.endDate),
        });
        if (roomTaken) {
          return NextResponse.json(
            { error: `Room ${room?.roomNumber ?? ""} is already booked for the selected dates` },
            { status: 409 }
          );
        }
      }
    }

    // Type-level overbooking guard: block the booking outright when any night of any
    // segment would exceed the sellable rooms of that type (see src/lib/availability.ts).
    // This runs whether or not a specific room was picked — unassigned bookings hold
    // inventory too.
    const availabilityConflicts = await findTypeAvailabilityConflicts({
      propertyId: body.propertyId,
      segments: assignmentsInput.map((a: { roomTypeId: string; startDate: string | Date; endDate: string | Date }) => ({
        roomTypeId: a.roomTypeId,
        startDate: new Date(a.startDate),
        endDate: new Date(a.endDate),
      })),
    });
    if (availabilityConflicts.length > 0) {
      return NextResponse.json({ error: availabilityConflicts.join("; ") }, { status: 409 });
    }

    // Fetch EnterpriseSettings to determine confirmation number format.
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } });

    // Sequential confirmation number via the Sequence Manager's REGISTRATION_NO
    // counter (Controls > Reservations) — the app owner's explicit "sequential
    // numbers only" rule; replaces the old Math.random() string, which could collide
    // (raw 500) and gave staff no usable reference ordering. Prefix and zero-pad
    // length come from EnterpriseSettings; when no prefix is configured, the
    // property's own (globally unique) code is used — confirmationNo is globally
    // unique while sequences are per-property, so a bare "000001" from two different
    // properties would otherwise collide.
    const bookedProperty = await prisma.property.findUnique({ where: { id: body.propertyId } });
    const prefix = settings?.resConfirmPrefix || `${bookedProperty?.code ?? "RES"}-`;
    const length = settings?.resConfirmLength || 6;
    let seq = await allocateSequenceNumber(body.propertyId, "REGISTRATION_NO");
    let confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`;
    // confirmationNo is globally unique; pre-sequence reservations used random strings
    // that could (rarely) occupy a number we generate — skip past any taken value
    // rather than 500 on the unique constraint. Concurrent creates are safe without
    // this loop: the sequence increment itself is atomic, so they never share a seq.
    for (let attempt = 0; attempt < 5; attempt++) {
      const taken = await prisma.reservation.findUnique({ where: { confirmationNo }, select: { id: true } });
      if (!taken) break;
      seq = await allocateSequenceNumber(body.propertyId, "REGISTRATION_NO");
      confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`;
    }

    const newReservation = await prisma.reservation.create({
      data: {
        confirmationNo,
        propertyId: body.propertyId,
        primaryGuestId: body.primaryGuestId,
        travelAgentId: body.travelAgentId,
        checkInDate: new Date(body.checkInDate),
        checkOutDate: new Date(body.checkOutDate),
        adults: parseInt(body.adults) || 1,
        children: parseInt(body.children) || 0,
        infants: parseInt(body.infants) || 0,
        mealPlan: body.mealPlan || "NONE",
        remarks: body.remarks || null,
        status: "RESERVED", // Default status
        hasScheduledRoomMove: detectScheduledRoomMove(assignmentsInput),
        assignments: {
          create: assignmentsInput
        },
        accompanyingGuests: Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0 ? {
          create: body.accompanyingGuestIds.map((id: string) => ({ profileId: id }))
        } : undefined,
        specialRequests: specialRequests.codes.length > 0 ? {
          create: specialRequests.codes.map((code) => ({ code }))
        } : undefined,
        // Auto-create the Master Folio (Window 1) for the reservation
        folios: {
          create: {
            folioNumber: 1,
            propertyId: body.propertyId,
            settlementMethod: initialSettlementMethod,
            payeeProfileId: initialPayeeProfileId,
          }
        }
      },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: {
            roomType: true,
            room: {
              include: {
                housekeepingTasks: {
                  where: { taskType: 'SPECIAL_REQUEST' },
                  orderBy: { createdAt: 'desc' }
                }
              }
            },
            ratePlan: true
          }
        },
        folios: true,
        specialRequests: true,
      }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "CREATE",
      entityType: "Reservation",
      entityId: newReservation.id,
      description: `Created reservation ${confirmationNo} for ${primaryGuest.firstName} ${primaryGuest.lastName ?? ""}`.trim() +
        ` (${new Date(body.checkInDate).toISOString().slice(0, 10)} → ${new Date(body.checkOutDate).toISOString().slice(0, 10)})`,
    });

    // Materialize the allocation attachment set (rate plan + meal plan links, plus any
    // manually-picked add-ons) — the rows Night Audit will post from.
    const allocationResult = await materializeReservationAllocations({
      reservationId: newReservation.id,
      propertyId: body.propertyId,
      ratePlanId: assignmentsInput[0]?.ratePlanId ?? null,
      mealPlanCode: body.mealPlan || "NONE",
      manualAllocationIds: Array.isArray(body.manualAllocationIds) ? body.manualAllocationIds : [],
    });
    if (allocationResult.error) {
      // The reservation itself is valid — surface the add-on problem without losing it.
      return NextResponse.json({ ...newReservation, allocationWarning: allocationResult.error }, { status: 201 });
    }

    const capacityWarning = overCapacityRoomTypes.size > 0
      ? `${totalOccupants} guests exceeds max occupancy for: ${Array.from(overCapacityRoomTypes).join(", ")}`
      : undefined;

    return NextResponse.json({ ...newReservation, capacityWarning }, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
