import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";
import { reservationSimpleTransport, saveReservationSimpleTransport } from "@/lib/transport/simple";

// The reservation's simple Transport section: flight no., transport no. and flight time for
// the pickup and the drop-off (src/lib/transport/simple.ts). Read-only — and PUT refused with
// 409 MANAGED_BY_TRANSPORTATION — where the Transportation module is active at the property.

async function loadScoped(id: string) {
  const ctx = await requireSession();
  const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true, confirmationNo: true } });
  if (!reservation) return { ctx, reservation: null };
  await assertPropertyAccess(ctx, reservation.propertyId);
  return { ctx, reservation };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, reservation } = await loadScoped(id);
    requirePermission(ctx, "RESERVATIONS", "view");
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    return NextResponse.json(await reservationSimpleTransport(id));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, reservation } = await loadScoped(id);
    requirePermission(ctx, "RESERVATIONS", "update");
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });

    const body = await request.json().catch(() => null);
    const result = await saveReservationSimpleTransport(id, body);

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: id,
      description: `Updated transport for reservation ${reservation.confirmationNo}`,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
