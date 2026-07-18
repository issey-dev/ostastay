import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    // Find all reservations that have at least one room assignment still missing a physical room
    const unassignedReservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: {
          notIn: ["CANCELLED"]
        },
        assignments: {
          some: { roomId: null }
        }
      },
      include: {
        assignments: { where: { roomId: null } }
      },
      orderBy: {
        checkInDate: 'asc'
      }
    });

    if (unassignedReservations.length === 0) {
      return NextResponse.json({ success: true, message: "No unassigned reservations found.", assignedCount: 0 });
    }

    let assignedCount = 0;

    for (const res of unassignedReservations) {
      for (const assignment of res.assignments) {
        // Find an available room of the right type with no overlapping assignment
        const availableRoom = await prisma.room.findFirst({
          where: {
            propertyId,
            roomTypeId: assignment.roomTypeId,
            NOT: {
              RoomAssignment: {
                some: {
                  id: { not: assignment.id },
                  reservation: {
                    status: { notIn: ["CANCELLED"] }
                  },
                  AND: [
                    { startDate: { lt: assignment.endDate } },
                    { endDate: { gt: assignment.startDate } }
                  ]
                }
              }
            }
          },
          orderBy: {
            roomNumber: 'asc'
          }
        });

        if (availableRoom) {
          await prisma.roomAssignment.update({
            where: { id: assignment.id },
            data: { roomId: availableRoom.id }
          });
          assignedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      assignedCount,
      totalUnassigned: unassignedReservations.length
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
