import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { materializeReservationAllocations } from "@/lib/allocations-server";

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
        folios: true,
        allocations: {
          include: {
            allocation: {
              include: { rates: true, chargeCode: { select: { code: true } } },
            },
          },
        },
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
    }

    // Fetch EnterpriseSettings to determine confirmation number format.
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } });

    const prefix = settings?.resConfirmPrefix || "";
    const length = settings?.resConfirmLength || 6;
    const randomPart = Math.random().toString(36).substring(2, 2 + length).toUpperCase();
    const confirmationNo = `${prefix}${randomPart}`;

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
        assignments: {
          create: assignmentsInput
        },
        accompanyingGuests: Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0 ? {
          create: body.accompanyingGuestIds.map((id: string) => ({ profileId: id }))
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
      }
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
