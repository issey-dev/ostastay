import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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

    const newRoomType = await prisma.roomType.findUnique({ where: { id: newRoomTypeId } });
    if (!newRoomType || newRoomType.propertyId !== currentRes.propertyId) {
      return NextResponse.json({ error: "New room type not found" }, { status: 404 });
    }

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
          ratePlanId: activeAssignment.ratePlanId,
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
      await tx.reservationTrace.create({
        data: {
          reservationId: id,
          traceType: "ROOM_MOVE",
          description: `Moved from Room ${oldRoomNumber} to Room ${newRoom.roomNumber}. Reason: ${reason}`,
          actionDate: new Date(),
          isResolved: true // A room move trace is inherently resolved upon creation, just serving as an audit log
        }
      });

      return res;
    });

    return NextResponse.json(updatedReservation);

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
