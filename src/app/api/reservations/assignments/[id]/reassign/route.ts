import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { hasRoomConflict } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

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
    await assertPropertyAccess(ctx, assignment.reservation.propertyId);

    if (roomId) {
      // Find the new room
      const newRoom = await prisma.room.findUnique({
        where: { id: roomId },
        include: { roomType: true }
      });

      if (!newRoom || newRoom.propertyId !== assignment.reservation.propertyId) {
        return NextResponse.json({ error: "New room not found" }, { status: 404 });
      }
      if (newRoom.status === "OUT_OF_SERVICE" || newRoom.status === "OUT_OF_ORDER") {
        return NextResponse.json({ error: "That room is out of order or out of service" }, { status: 400 });
      }
      if (!newRoom.roomType.isActive) {
        return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 });
      }

      // Check if new room is available for these dates (only RESERVED/IN_HOUSE hold
      // inventory — see src/lib/availability.ts).
      const conflictingAssignment = await hasRoomConflict({
        roomId,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        excludeAssignmentId: id,
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

      await logActivity({
        ctx,
        module: "RESERVATIONS",
        action: "UPDATE",
        entityType: "RoomAssignment",
        entityId: id,
        description: `Reassigned reservation to Room ${newRoom.roomNumber} (${newRoom.roomType.code})`,
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
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
