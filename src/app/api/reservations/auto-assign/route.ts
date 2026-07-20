import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { INVENTORY_HOLDING_STATUSES, UNSELLABLE_ROOM_STATUSES } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";

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
        // Only reservations that still hold inventory need a room — assigning one to
        // a CHECKED_OUT/NO_SHOW stay would just re-block the room for nothing.
        status: { in: INVENTORY_HOLDING_STATUSES },
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
            // Never auto-assign an out-of-order/out-of-service room.
            status: { notIn: UNSELLABLE_ROOM_STATUSES },
            NOT: {
              RoomAssignment: {
                some: {
                  id: { not: assignment.id },
                  reservation: {
                    status: { in: INVENTORY_HOLDING_STATUSES }
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

    if (assignedCount > 0) {
      await logActivity({
        ctx,
        module: "RESERVATIONS",
        action: "UPDATE",
        description: `Auto-assigned rooms to ${assignedCount} reservation${assignedCount > 1 ? "s" : ""}`,
      });
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
