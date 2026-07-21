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

    // Determine the start and end of "Today" in the server timezone
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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

    // 5. Vacant Rooms (Clean and not occupied)
    // To do this simply: get all rooms, then filter out any room that is currently IN_HOUSE.
    const allRooms = await prisma.room.findMany({
      where: { propertyId, status: "CLEAN" },
      include: { roomType: true }
    });
    const occupiedRoomIds = inHouse.flatMap(r => r.assignments.map(a => a.roomId)).filter(Boolean);
    const vacantRooms = allRooms.filter(r => !occupiedRoomIds.includes(r.id));

    return NextResponse.json({
      arrivals,
      departures,
      inHouse,
      roomMovesToday,
      vacantRoomsCount: vacantRooms.length
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
