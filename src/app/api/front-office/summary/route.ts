import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, nextBusinessDate } from "@/lib/business-date";
import { computeFolioBalance } from "@/lib/debtor-accounts";

type BalanceFolio = {
  lineItems: { amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean }[];
  payments: { amount: number; isRefund: boolean }[];
};
// Outstanding balance across a reservation's folios (charges − payments), cent-safe.
function reservationBalance(folios: BalanceFolio[]): number {
  return folios.reduce((sum, f) => sum + computeFolioBalance(f.lineItems, f.payments), 0);
}

// An arrival's guest profile is "incomplete" (front desk should complete it before
// check-in) when nationality, date of birth, OR any identification document is missing.
// Only meaningful for individual guests — company/agent primaries have no such fields.
function isProfileIncomplete(g: { profileType: string; nationality: string | null; dateOfBirth: Date | null; documents: { id: string }[] } | null): boolean {
  if (!g || g.profileType !== "GUEST") return false;
  return !g.nationality || !g.dateOfBirth || (g.documents?.length ?? 0) === 0;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "FRONT_DESK", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    // "Today" for the front desk is the property's BUSINESS DATE (UTC midnight), not
    // wall-clock — so arrivals/departures/room-moves match the operational day the
    // property is actually working, and only advance when Night Audit rolls it.
    const startOfToday = resolveBusinessDate(property);
    const endOfToday = new Date(nextBusinessDate(startOfToday).getTime() - 1);

    // 1. Arrivals Today
    const arrivals = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: ReservationStatus.RESERVED,
        checkInDate: {
          gte: startOfToday,
          lte: endOfToday,
        }
      },
      include: {
        primaryGuest: { include: { documents: { select: { id: true } } } },
        assignments: { include: { room: { include: { housekeepingTasks: { where: { taskType: "SPECIAL_REQUEST" }, orderBy: { createdAt: "desc" } } } }, roomType: true } },
        traces: { where: { isResolved: false } },
        // Deposits collected pre-arrival live as payments on the folio; line items let
        // us also surface the outstanding balance the check-in dialog will settle.
        folios: { include: { lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } }, payments: { select: { amount: true, isRefund: true } } } },
      }
    });

    // 2. Departures Today
    const departures = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: ReservationStatus.IN_HOUSE,
        checkOutDate: {
          gte: startOfToday,
          lte: endOfToday,
        }
      },
      include: {
        primaryGuest: { include: { documents: { select: { id: true } } } },
        assignments: { include: { room: { include: { housekeepingTasks: { where: { taskType: "SPECIAL_REQUEST" }, orderBy: { createdAt: "desc" } } } }, roomType: true } },
        folios: { include: { lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } }, payments: { select: { amount: true, isRefund: true } } } },
        traces: { where: { isResolved: false } },
      }
    });

    // 3. In-House
    const inHouse = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: ReservationStatus.IN_HOUSE,
      },
      include: {
        primaryGuest: { include: { documents: { select: { id: true } } } },
        assignments: { include: { room: { include: { housekeepingTasks: { where: { taskType: "SPECIAL_REQUEST" }, orderBy: { createdAt: "desc" } } } }, roomType: true } },
        folios: { include: { lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } }, payments: { select: { amount: true, isRefund: true } } } },
        traces: { where: { isResolved: false } },
      }
    });

    // 4. Room Moves Due Today — an in-house reservation whose split-stay segments
    // planned a different physical room starting today (booking-time scheduled move,
    // distinct from the ad-hoc Move Room action). Purely informational: the room
    // assignment already exists on the reservation, nothing needs to be "executed"
    // here — this is a heads-up for housekeeping/front desk to coordinate the change.
    const segmentsStartingToday = await prisma.roomAssignment.findMany({
      where: {
        reservationId: { in: inHouse.map((r) => r.id) },
        startDate: { gte: startOfToday, lte: endOfToday },
      },
      include: { room: true, roomType: true },
    });
    const roomMovesToday = [];
    for (const seg of segmentsStartingToday) {
      if (!seg.roomId) continue;
      const prevSeg = await prisma.roomAssignment.findFirst({
        where: { reservationId: seg.reservationId, endDate: seg.startDate },
        include: { room: true },
      });
      if (!prevSeg || !prevSeg.roomId || prevSeg.roomId === seg.roomId) continue;
      const res = inHouse.find((r) => r.id === seg.reservationId);
      if (!res) continue;
      roomMovesToday.push({
        reservationId: seg.reservationId,
        confirmationNo: res.confirmationNo,
        primaryGuest: res.primaryGuest,
        fromRoomNumber: prevSeg.room?.roomNumber ?? null,
        toRoomNumber: seg.room?.roomNumber ?? null,
        toRoomTypeName: seg.roomType.name,
      });
    }

    // 5. Vacant Rooms — every unoccupied room that isn't out of order/service.
    // "Ready" narrows that to rooms housekeeping has cleared (CLEAN/INSPECTED);
    // a DIRTY-but-unoccupied room is still vacant, just not sellable-right-now.
    const allRooms = await prisma.room.findMany({
      where: { propertyId, status: { notIn: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } },
      select: { id: true, status: true }
    });
    const occupiedRoomIds = new Set(inHouse.flatMap(r => r.assignments.map(a => a.roomId)).filter(Boolean));
    const vacantRooms = allRooms.filter(r => !occupiedRoomIds.has(r.id));
    const vacantReadyCount = vacantRooms.filter(r => r.status === "CLEAN" || r.status === "INSPECTED").length;

    // 6. Housekeeping breakdown over in-service rooms — how the vacant/occupied
    // split lands across CLEAN/INSPECTED/DIRTY (OOO/OOS are excluded upstream).
    const clean = allRooms.filter(r => r.status === "CLEAN").length;
    const inspected = allRooms.filter(r => r.status === "INSPECTED").length;
    const dirty = allRooms.filter(r => r.status === "DIRTY").length;

    // 7. Arrivals / Departures progress — expected vs. already actioned. Expected
    // arrivals = anyone due in today who wasn't cancelled/no-show (still RESERVED, or
    // already IN_HOUSE / CHECKED_OUT); checkedIn = those who have actually arrived.
    // Departures mirror this on checkOutDate.
    const arrivalDay = { checkInDate: { gte: startOfToday, lte: endOfToday } };
    const departureDay = { checkOutDate: { gte: startOfToday, lte: endOfToday } };
    const [arrivalsExpected, arrivalsCheckedIn, departuresExpected, departuresCheckedOut] = await Promise.all([
      prisma.reservation.count({ where: { propertyId, ...arrivalDay, status: { in: [ReservationStatus.RESERVED, ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } } }),
      prisma.reservation.count({ where: { propertyId, ...arrivalDay, status: { in: [ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } } }),
      prisma.reservation.count({ where: { propertyId, ...departureDay, status: { in: [ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } } }),
      prisma.reservation.count({ where: { propertyId, ...departureDay, status: ReservationStatus.CHECKED_OUT } }),
    ]);

    // In-house occupancy — rooms occupied plus the people in them.
    const occupancy = inHouse.reduce(
      (acc, r) => { acc.adults += r.adults; acc.children += r.children; acc.infants += r.infants; return acc; },
      { adults: 0, children: 0, infants: 0 }
    );

    return NextResponse.json({
      businessDate: startOfToday,
      // Each row carries its outstanding balance; arrivals also carry a profile-completeness flag.
      arrivals: arrivals.map(r => ({ ...r, balance: reservationBalance(r.folios), profileIncomplete: isProfileIncomplete(r.primaryGuest) })),
      departures: departures.map(r => ({ ...r, balance: reservationBalance(r.folios) })),
      inHouse: inHouse.map(r => ({ ...r, balance: reservationBalance(r.folios) })),
      roomMovesToday,
      vacantRoomsCount: vacantRooms.length,
      vacantReadyCount,
      arrivalsSummary: { expected: arrivalsExpected, checkedIn: arrivalsCheckedIn },
      departuresSummary: { expected: departuresExpected, checkedOut: departuresCheckedOut },
      inHouseSummary: { rooms: occupiedRoomIds.size, ...occupancy },
      roomStatusSummary: { occupied: occupiedRoomIds.size, vacant: vacantRooms.length, clean, inspected, dirty },
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
