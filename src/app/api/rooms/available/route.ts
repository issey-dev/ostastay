import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValid, parseISO } from "date-fns";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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
        // Exclude rooms that have any room assignment overlapping the requested dates
        NOT: {
          RoomAssignment: {
            some: {
              ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
              reservation: {
                status: {
                  notIn: ["CANCELLED"] // Cancelled reservations don't block availability
                }
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
