import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { clearResolvedPending } from "@/lib/channels/inbound/reconcile";

// A channel cancellation or change waiting for the desk on THIS reservation (DECISIONS.md
// "Channel bookings changed or cancelled after they became a reservation", 2026-11-23).
//
// GET  what is waiting, with the channel's new values beside the reservation's current ones.
//      A flag the desk has already dealt with (reservation cancelled, or edited to match) is
//      cleared first, so it disappears as soon as the desk has acted.
// POST { action: "dismiss" } — the desk handled it another way (e.g. agreed with the channel to
//      keep the booking). Recorded in the activity log. Applying a CANCEL uses the normal
//      cancel action and applying a CHANGE uses the normal edit form; both clear the flag.

async function loadReservation(id: string) {
  return prisma.reservation.findUnique({
    where: { id },
    select: { id: true, propertyId: true, confirmationNo: true },
  });
}

async function findPending(reservationId: string) {
  return prisma.channelInboundBooking.findFirst({
    where: { reservationId, status: "CONVERTED", pendingAction: { not: null } },
    select: { id: true },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");
    const { id } = await params;
    const reservation = await loadReservation(id);
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const pending = await findPending(id);
    if (pending) await clearResolvedPending(pending.id);

    const row = await prisma.channelInboundBooking.findFirst({
      where: { reservationId: id, status: "CONVERTED", pendingAction: { not: null } },
      select: {
        pendingAction: true,
        pendingReason: true,
        pendingSince: true,
        channelName: true,
        externalBookingId: true,
        arrival: true,
        departure: true,
        adults: true,
        children: true,
        roomTypeId: true,
        roomType: { select: { name: true } },
      },
    });
    if (!row) return NextResponse.json({ pending: null });

    return NextResponse.json({
      pending: {
        action: row.pendingAction,
        reason: row.pendingReason,
        since: row.pendingSince,
        channelName: row.channelName,
        externalBookingId: row.externalBookingId,
        // The channel's version of the booking — what a CHANGE would apply.
        channel: {
          arrival: row.arrival,
          departure: row.departure,
          adults: row.adults,
          children: row.children,
          roomTypeId: row.roomTypeId,
          roomTypeName: row.roomType?.name ?? null,
        },
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const reservation = await loadReservation(id);
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const body = await request.json().catch(() => ({}));
    if (body?.action !== "dismiss") {
      return NextResponse.json({ error: 'Unknown action. Use { "action": "dismiss" }.' }, { status: 400 });
    }

    const pending = await prisma.channelInboundBooking.findFirst({
      where: { reservationId: id, status: "CONVERTED", pendingAction: { not: null } },
      select: { id: true, pendingAction: true, pendingReason: true },
    });
    if (!pending) return NextResponse.json({ pending: null });

    await prisma.channelInboundBooking.update({
      where: { id: pending.id },
      data: { pendingAction: null, pendingReason: null, pendingSince: null },
    });
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: id,
      description: `Reservation ${reservation.confirmationNo}: channel ${pending.pendingAction === "CANCEL" ? "cancellation" : "change"} dismissed (${pending.pendingReason ?? ""})`,
    });
    return NextResponse.json({ pending: null });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
