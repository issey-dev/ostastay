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
    // Moving to a room of a DIFFERENT type changes what the guest should pay, so it needs an
    // explicit rate choice and a reason (same rules as the Front Desk room move): "new"
    // reprices at the new room type, "keep" bills as the current one.
    const rateMode: "keep" | "new" = body.rateMode === "keep" ? "keep" : "new";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

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

    // Only a booking that still holds a room can have it changed, and a guest in the house
    // is never left without one (an in-house change of room goes through the room move).
    if (!["RESERVED", "IN_HOUSE"].includes(assignment.reservation.status)) {
      return NextResponse.json({ error: "Only reserved or in-house bookings can change room." }, { status: 400 });
    }
    if (!roomId && assignment.reservation.status === "IN_HOUSE") {
      return NextResponse.json({ error: "An in-house guest can't be left without a room." }, { status: 400 });
    }
    if (roomId && roomId === assignment.roomId) {
      return NextResponse.json({ success: true, assignment, unchanged: true });
    }

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

      const typeChanged = newRoom.roomTypeId !== assignment.roomTypeId;
      if (typeChanged && !reason) {
        return NextResponse.json({ error: "A reason is required to move a booking to a different room type." }, { status: 400 });
      }

      // Pricing basis carried onto the new room type (mirrors POST .../room-move).
      let pricing: { chargeRoomTypeId: string | null; overrideRate: number | null } | null = null;
      if (typeChanged) {
        if (rateMode === "keep") {
          const billedAs = assignment.chargeRoomTypeId ?? assignment.roomTypeId;
          pricing = { chargeRoomTypeId: billedAs === newRoom.roomTypeId ? null : billedAs, overrideRate: assignment.overrideRate ?? null };
        } else {
          pricing = { chargeRoomTypeId: null, overrideRate: null };
        }
      }

      // Update the assignment
      const updated = await prisma.roomAssignment.update({
        where: { id },
        data: {
          roomId: roomId,
          roomTypeId: newRoom.roomTypeId,
          ...(pricing ?? {}),
        }
      });

      // Optional: If the reservation was RESERVED and we assign a room, or if it was IN_HOUSE, we keep it sync
      // Also write a trace log for auditing
      await prisma.reservationTrace.create({
        data: {
          reservationId: assignment.reservationId,
          traceType: "ROOM_REASSIGN",
          description: `Room assignment changed to Room ${newRoom.roomNumber} (${newRoom.roomType.code}).${typeChanged ? ` Room type changed — ${rateMode === "keep" ? "rate kept" : "rate recalculated"}. Reason: ${reason}` : ""}`,
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
        description: `Reassigned reservation to Room ${newRoom.roomNumber} (${newRoom.roomType.code})${typeChanged ? `, ${rateMode === "keep" ? "rate kept" : "rate recalculated"} — ${reason}` : ""}`,
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
