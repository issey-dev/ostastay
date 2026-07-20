import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
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

    if (body.isResolved === undefined) {
      return NextResponse.json({ error: "Missing isResolved field" }, { status: 400 });
    }

    const existing = await prisma.reservationTrace.findUnique({
      where: { id },
      include: { reservation: { select: { propertyId: true, confirmationNo: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.reservation.propertyId);

    const trace = await prisma.reservationTrace.update({
      where: { id },
      data: {
        isResolved: body.isResolved
      }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "ReservationTrace",
      entityId: trace.id,
      description: `Marked trace on reservation ${existing.reservation.confirmationNo} as ${body.isResolved ? "resolved" : "unresolved"}`,
    });

    return NextResponse.json(trace);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "delete");

    const { id } = await params;
    const existing = await prisma.reservationTrace.findUnique({
      where: { id },
      include: { reservation: { select: { propertyId: true, confirmationNo: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.reservation.propertyId);

    await prisma.reservationTrace.delete({
      where: { id }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "DELETE",
      entityType: "ReservationTrace",
      entityId: id,
      description: `Deleted trace from reservation ${existing.reservation.confirmationNo}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
