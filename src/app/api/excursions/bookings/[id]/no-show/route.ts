import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

// Marks a CONFIRMED booking as NO_SHOW — only meaningful after the departure has
// actually left (can't know someone's a no-show before then). Deliberately leaves the
// charge in place with no auto-void/refund, matching typical no-show policy (the
// booking is forfeit) without hard-coding that as the only option — a manager can
// still cancel-and-void by hand afterward if a property's policy differs.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "update");

    const { id } = await params;
    const booking = await prisma.excursionBooking.findUnique({
      where: { id },
      include: { departure: true },
    });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, booking.propertyId, "EXCURSIONS");

    if (booking.status !== "CONFIRMED") {
      return NextResponse.json({ error: `Cannot mark a booking with status ${booking.status} as no-show` }, { status: 400 });
    }

    const departureAt = combineDepartureDateTime(booking.departure.departureDate, booking.departure.departureTime);
    if (new Date() < departureAt) {
      return NextResponse.json({ error: "Cannot mark a no-show before the departure has left" }, { status: 400 });
    }

    await prisma.excursionBooking.update({ where: { id }, data: { status: "NO_SHOW" } });

    await logActivity({
      ctx,
      module: "EXCURSIONS",
      action: "UPDATE",
      entityType: "ExcursionBooking",
      entityId: id,
      description: "Marked excursion booking as no-show",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
