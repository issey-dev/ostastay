import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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

    // "Today" uses UTC day boundaries: reservation dates are stored as UTC midnights
    // (forms submit plain YYYY-MM-DD), and the arrival/departure PDFs already use the
    // same convention — server-local boundaries here made the two disagree near midnight.
    const isoDate = new Date().toISOString().split("T")[0];
    const startOfToday = new Date(isoDate + "T00:00:00.000Z");
    const endOfToday = new Date(isoDate + "T23:59:59.999Z");

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
      include: { primaryGuest: true, assignments: { include: { room: true, roomType: true } }, traces: { where: { isResolved: false } } }
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
      include: { primaryGuest: true, assignments: { include: { room: true, roomType: true } }, folios: true, traces: { where: { isResolved: false } } }
    });

    // 3. In-House
    const inHouse = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: ReservationStatus.IN_HOUSE,
      },
      include: { primaryGuest: true, assignments: { include: { room: true, roomType: true } }, folios: true, traces: { where: { isResolved: false } } }
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

    return NextResponse.json({
      arrivals,
      departures,
      inHouse,
      roomMovesToday,
      vacantRoomsCount: vacantRooms.length,
      vacantReadyCount
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
