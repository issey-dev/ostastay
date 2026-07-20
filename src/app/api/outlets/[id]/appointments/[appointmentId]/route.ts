import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"];

// Cancellation is a status change (matches this app's existing soft-status convention
// for RoomMaintenance/HousekeepingTask) rather than a hard delete — no DELETE handler.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; appointmentId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "update");

    const { id: outletId, appointmentId } = await params;
    const body = await request.json();

    const existing = await prisma.outletAppointment.findUnique({ where: { id: appointmentId } });
    if (!existing || existing.outletId !== outletId) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
    await assertPropertyAccess(ctx, outlet.propertyId);

    if (body.status !== undefined && !STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updated = await prisma.outletAppointment.update({
      where: { id: appointmentId },
      data: {
        ...(body.status !== undefined && { status: body.status }),
        ...(body.startTime !== undefined && { startTime: new Date(body.startTime) }),
        ...(body.endTime !== undefined && { endTime: body.endTime ? new Date(body.endTime) : null }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: {
        chargeCode: true,
        reservation: { include: { primaryGuest: true } },
      },
    });

    await logActivity({
      ctx,
      module: "POS",
      action: body.status !== undefined && body.status !== existing.status ? body.status : "UPDATE",
      entityType: "OutletAppointment",
      entityId: updated.id,
      description:
        body.status !== undefined && body.status !== existing.status
          ? `Marked appointment at "${outlet.name}" as ${body.status}`
          : `Updated appointment at "${outlet.name}"`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
