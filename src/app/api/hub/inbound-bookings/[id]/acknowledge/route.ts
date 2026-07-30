import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Acknowledge a flagged inbound booking — "the desk has seen this and is dealing with it".
//
// Deliberately an acknowledgement rather than a dismissal: the flag and its note stay on the
// record permanently, because an overbooking that was resolved is still something that
// happened and is worth being able to look back at. This only clears it from the list of
// things needing attention today.
//
// Note that ingest.ts RE-CLEARS the acknowledgement if the booking is later modified while
// still overbooking — acknowledging a specific state of a booking must not silence a
// different problem that arrives afterwards.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const booking = await prisma.channelInboundBooking.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true, externalBookingId: true, isOverbooking: true },
    });
    if (!booking || booking.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    await prisma.channelInboundBooking.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedById: ctx.userId },
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Acknowledged channel booking ${booking.externalBookingId}${
        booking.isOverbooking ? " (overbooking)" : ""
      }`,
      entityType: "ChannelInboundBooking",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
