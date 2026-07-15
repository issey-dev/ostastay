import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  try {
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

    // 4. Vacant Rooms (Clean and not occupied)
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
      vacantRoomsCount: vacantRooms.length
    });

  } catch (error) {
    console.error("Failed to fetch front office summary:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
