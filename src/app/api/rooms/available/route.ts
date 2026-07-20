import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValid, parseISO } from "date-fns";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { INVENTORY_HOLDING_STATUSES, UNSELLABLE_ROOM_STATUSES } from "@/lib/availability";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const roomTypeId = searchParams.get("roomTypeId");
    const checkInStr = searchParams.get("checkInDate");
    const checkOutStr = searchParams.get("checkOutDate");

    if (!propertyId || !roomTypeId || !checkInStr || !checkOutStr) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const checkInDate = parseISO(checkInStr);
    const checkOutDate = parseISO(checkOutStr);

    if (!isValid(checkInDate) || !isValid(checkOutDate)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    const excludeReservationId = searchParams.get("excludeReservationId");

    // Find all rooms for the given property and room type
    // that DO NOT have any overlapping active reservations
    const availableRooms = await prisma.room.findMany({
      where: {
        propertyId,
        roomTypeId,
        // OUT_OF_ORDER (maintenance) rooms are just as unsellable as OUT_OF_SERVICE —
        // previously only the latter was excluded and OOO rooms were offered for sale.
        status: { notIn: UNSELLABLE_ROOM_STATUSES },
        // Exclude rooms that have any room assignment overlapping the requested dates
        NOT: {
          RoomAssignment: {
            some: {
              ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
              reservation: {
                // Only RESERVED/IN_HOUSE hold inventory — a NO_SHOW or CHECKED_OUT
                // reservation's room goes back on sale for the remaining nights.
                status: { in: INVENTORY_HOLDING_STATUSES }
              },
              AND: [
                { startDate: { lt: checkOutDate } },
                { endDate: { gt: checkInDate } }
              ]
            }
          }
        }
      },
      orderBy: {
        roomNumber: 'asc'
      }
    });

    return NextResponse.json(availableRooms);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
