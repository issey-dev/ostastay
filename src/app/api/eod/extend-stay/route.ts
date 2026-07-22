import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { hasRoomConflict } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";

// Extend a due-out guest's stay from the EOD departures step — pushes the checkout
// date (and the last room segment's end) out so they're no longer due out today.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const body = await request.json();
    const { reservationId, checkOutDate } = body;
    if (!reservationId || !checkOutDate) {
      return NextResponse.json({ error: "reservationId and checkOutDate are required" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { property: { select: { businessDate: true } }, assignments: { orderBy: { startDate: "desc" } } },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);
    if (reservation.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Only an in-house stay can be extended" }, { status: 400 });
    }

    const newCheckOut = toUtcMidnight(new Date(checkOutDate));
    const businessDate = resolveBusinessDate(reservation.property);
    // The new checkout must be after the current business date, else the guest is
    // still due out and nothing was resolved.
    if (newCheckOut <= businessDate) {
      return NextResponse.json({ error: "The new check-out date must be after today's business date." }, { status: 400 });
    }

    const lastAssignment = reservation.assignments[0];
    if (lastAssignment?.roomId) {
      // The room must be free for the extended nights.
      const taken = await hasRoomConflict({
        roomId: lastAssignment.roomId,
        startDate: lastAssignment.endDate,
        endDate: newCheckOut,
        excludeReservationId: reservationId,
      });
      if (taken) {
        return NextResponse.json({ error: "That room is already booked for the extended dates — move the guest or pick a shorter extension." }, { status: 409 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.reservation.update({ where: { id: reservationId }, data: { checkOutDate: newCheckOut } });
      if (lastAssignment) {
        await tx.roomAssignment.update({ where: { id: lastAssignment.id }, data: { endDate: newCheckOut } });
      }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: reservationId,
      description: `Extended ${reservation.confirmationNo} to ${newCheckOut.toISOString().slice(0, 10)} at End-of-Day`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
