import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { hasRoomConflict } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const body = await request.json();
    const { newRoomId, newRoomTypeId, reason } = body;
    // Rate handling on a move to a DIFFERENT room type: "keep" bills the guest at their
    // current (old) room type's rate; "new" reprices to the new room type. Ignored when
    // the room type is unchanged (rate always carries over untouched). Default: "new".
    const rateMode: "keep" | "new" = body.rateMode === "keep" ? "keep" : "new";

    if (!newRoomId || !newRoomTypeId || !reason) {
      return NextResponse.json({ error: "Missing required fields (newRoomId, newRoomTypeId, reason)" }, { status: 400 });
    }

    // 1. Get current reservation
    const currentRes = await prisma.reservation.findUnique({
      where: { id },
      include: { assignments: { include: { room: true }, orderBy: { startDate: 'desc' } } }
    });

    if (!currentRes) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, currentRes.propertyId);

    if (currentRes.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Only IN_HOUSE guests can be moved." }, { status: 400 });
    }

    const activeAssignment = currentRes.assignments[0];
    if (!activeAssignment) {
      return NextResponse.json({ error: "No active room assignment found" }, { status: 400 });
    }

    const oldRoomId = activeAssignment.roomId;
    const oldRoomNumber = activeAssignment.room?.roomNumber || "Unassigned";

    // 2. Fetch new room info for trace logging
    const newRoom = await prisma.room.findUnique({
      where: { id: newRoomId }
    });

    if (!newRoom || newRoom.propertyId !== currentRes.propertyId) {
      return NextResponse.json({ error: "New room not found" }, { status: 404 });
    }
    if (newRoom.status === "OUT_OF_SERVICE" || newRoom.status === "OUT_OF_ORDER") {
      return NextResponse.json({ error: "That room is out of order or out of service" }, { status: 400 });
    }

    // The target room must be free for the remainder of the stay — previously a move
    // could land a guest in a room already assigned to someone else.
    const now = new Date();
    const moveStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const roomTaken = await hasRoomConflict({
      roomId: newRoomId,
      startDate: moveStart,
      endDate: currentRes.checkOutDate,
      excludeReservationId: id,
    });
    if (roomTaken) {
      return NextResponse.json({ error: "That room is already booked during the remainder of this stay" }, { status: 409 });
    }

    const newRoomType = await prisma.roomType.findUnique({ where: { id: newRoomTypeId } });
    if (!newRoomType || newRoomType.propertyId !== currentRes.propertyId) {
      return NextResponse.json({ error: "New room type not found" }, { status: 404 });
    }
    if (!newRoomType.isActive) {
      return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 });
    }

    // Decide the pricing basis carried onto the new segment.
    //  • Same room type → nothing about pricing changes; carry the existing basis
    //    (any manual override AND any prior "charge as" type) untouched.
    //  • Different type + keep → bill as the guest's current (effective) type: pin
    //    chargeRoomTypeId to it and carry any manual override.
    //  • Different type + new → price off the new physical type: no charge-as type,
    //    and drop any manual override so it reprices to the new type's calendar.
    const sameType = newRoomTypeId === activeAssignment.roomTypeId;
    const oldEffectiveChargeTypeId = activeAssignment.chargeRoomTypeId ?? activeAssignment.roomTypeId;
    let newChargeRoomTypeId: string | null;
    let newOverrideRate: number | null;
    if (sameType) {
      newChargeRoomTypeId = activeAssignment.chargeRoomTypeId ?? null;
      newOverrideRate = activeAssignment.overrideRate ?? null;
    } else if (rateMode === "keep") {
      // Redundant if the old billed type equals the new physical type — store null then.
      newChargeRoomTypeId = oldEffectiveChargeTypeId === newRoomTypeId ? null : oldEffectiveChargeTypeId;
      newOverrideRate = activeAssignment.overrideRate ?? null;
    } else {
      newChargeRoomTypeId = null;
      newOverrideRate = null;
    }
    const keptRate = !sameType && rateMode === "keep";

    // 3. Perform the room move transaction
    const updatedReservation = await prisma.$transaction(async (tx) => {
      // a. Mark old room as DIRTY (if they were assigned one)
      if (oldRoomId) {
        await tx.room.update({
          where: { id: oldRoomId },
          data: { status: "DIRTY" }
        });
      }

      // b. Terminate old assignment and create new assignment
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      await tx.roomAssignment.update({
        where: { id: activeAssignment.id },
        data: { endDate: today }
      });

      await tx.roomAssignment.create({
        data: {
          reservationId: id,
          roomId: newRoomId,
          roomTypeId: newRoomTypeId,
          chargeRoomTypeId: newChargeRoomTypeId,
          ratePlanId: activeAssignment.ratePlanId,
          overrideRate: newOverrideRate,
          startDate: today,
          endDate: currentRes.checkOutDate
        }
      });

      const res = await tx.reservation.findUnique({
        where: { id },
        include: {
          primaryGuest: true,
          assignments: { include: { roomType: true, room: true, ratePlan: true } }
        }
      });

      // c. Create Trace/Audit Log
      const rateNote = sameType
        ? ""
        : keptRate
          ? " Rate kept — billed as the previous room type."
          : " Charged the new room-type rate.";
      await tx.reservationTrace.create({
        data: {
          reservationId: id,
          traceType: "ROOM_MOVE",
          description: `Moved from Room ${oldRoomNumber} to Room ${newRoom.roomNumber}. Reason: ${reason}.${rateNote}`,
          actionDate: new Date(),
          isResolved: true // A room move trace is inherently resolved upon creation, just serving as an audit log
        }
      });

      return res;
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "ROOM_MOVE",
      entityType: "Reservation",
      entityId: id,
      description: `Moved ${currentRes.confirmationNo} from Room ${oldRoomNumber} to Room ${newRoom.roomNumber} — ${reason}${!sameType ? (keptRate ? " (rate kept)" : " (new rate)") : ""}`,
    });

    return NextResponse.json(updatedReservation);

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
