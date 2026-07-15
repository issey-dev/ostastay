import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { roomId } = body; // Could be null/string

    // Find the assignment
    const assignment = await prisma.roomAssignment.findUnique({
      where: { id },
      include: {
        reservation: true
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: "Room assignment not found" }, { status: 404 });
    }

    if (roomId) {
      // Find the new room
      const newRoom = await prisma.room.findUnique({
        where: { id: roomId },
        include: { roomType: true }
      });

      if (!newRoom) {
        return NextResponse.json({ error: "New room not found" }, { status: 404 });
      }

      // Check if new room is available for these dates
      // Overlap condition: existing.startDate < assignment.endDate AND existing.endDate > assignment.startDate
      const conflictingAssignment = await prisma.roomAssignment.findFirst({
        where: {
          id: { not: id },
          roomId: roomId,
          startDate: { lt: assignment.endDate },
          endDate: { gt: assignment.startDate },
          reservation: {
            status: { not: "CANCELLED" }
          }
        }
      });

      if (conflictingAssignment) {
        return NextResponse.json({ error: "The selected room is already occupied during this period." }, { status: 400 });
      }

      // Update the assignment
      const updated = await prisma.roomAssignment.update({
        where: { id },
        data: {
          roomId: roomId,
          roomTypeId: newRoom.roomTypeId
        }
      });

      // Optional: If the reservation was RESERVED and we assign a room, or if it was IN_HOUSE, we keep it sync
      // Also write a trace log for auditing
      await prisma.reservationTrace.create({
        data: {
          reservationId: assignment.reservationId,
          traceType: "ROOM_REASSIGN",
          description: `Room assignment changed to Room ${newRoom.roomNumber} (${newRoom.roomType.code}).`,
          actionDate: new Date(),
          isResolved: true
        }
      });

      return NextResponse.json({ success: true, assignment: updated });
    } else {
      // Unassign the room
      const updated = await prisma.roomAssignment.update({
        where: { id },
        data: {
          roomId: null
        }
      });

      await prisma.reservationTrace.create({
        data: {
          reservationId: assignment.reservationId,
          traceType: "ROOM_REASSIGN",
          description: `Room assignment set to Unassigned.`,
          actionDate: new Date(),
          isResolved: true
        }
      });

      return NextResponse.json({ success: true, assignment: updated });
    }

  } catch (error) {
    console.error("Failed to reassign room assignment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
