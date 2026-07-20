import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const traces = await prisma.reservationTrace.findMany({
      where: { reservationId: id },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(traces);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({ where: { id } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const body = await request.json();

    if (!body.traceType || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const trace = await prisma.reservationTrace.create({
      data: {
        reservationId: id,
        traceType: body.traceType,
        description: body.description,
        actionDate: body.actionDate ? new Date(body.actionDate) : null,
      }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "CREATE",
      entityType: "ReservationTrace",
      entityId: trace.id,
      description: `Added ${body.traceType} trace to reservation ${reservation.confirmationNo}: ${body.description}`,
    });

    return NextResponse.json(trace, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
