import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { isValidMaintenanceStatus, isValidMaintenancePriority } from "@/lib/maintenance";

// The one maintenance update endpoint (the old body-based PATCH on the
// collection route is gone) — accepts any subset of status / priority /
// assignedToId / issueType / description.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "MAINTENANCE", "update");

    const { id } = await params;
    const body = await request.json();
    const { status, priority, assignedToId, issueType, description } = body;

    if (status !== undefined && !isValidMaintenanceStatus(status)) {
      return NextResponse.json({ error: "Invalid status — expected OPEN, IN_PROGRESS, or RESOLVED" }, { status: 400 });
    }
    if (priority !== undefined && !isValidMaintenancePriority(priority)) {
      return NextResponse.json({ error: "Invalid priority — expected LOW, MEDIUM, or HIGH" }, { status: 400 });
    }

    const existing = await prisma.roomMaintenance.findUnique({
      where: { id },
      include: { room: true }
    });
    if (!existing) {
      return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.room.propertyId);

    const dataToUpdate: Record<string, unknown> = {};
    if (status !== undefined) dataToUpdate.status = status;
    if (priority !== undefined) dataToUpdate.priority = priority;
    if (issueType) dataToUpdate.issueType = issueType;
    if (description) dataToUpdate.description = description;
    if (assignedToId !== undefined) {
      if (assignedToId !== null) {
        const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
        if (!assignee || assignee.enterpriseId !== ctx.enterpriseId) {
          return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
        }
      }
      dataToUpdate.assignedToId = assignedToId;
    }
    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const order = await prisma.roomMaintenance.update({
      where: { id },
      data: dataToUpdate,
      include: { room: true, assignedTo: true }
    });

    // Resolving a ticket brings an out-of-order room back to service as DIRTY
    // (post-repair rooms need a housekeeping pass before sale).
    if (status === "RESOLVED" && existing.room.status === "OUT_OF_ORDER") {
      await prisma.room.update({
        where: { id: existing.roomId },
        data: { status: "DIRTY", oooReason: null, oooExpectedReturn: null },
      });
    }

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "UPDATE",
      entityType: "RoomMaintenance",
      entityId: order.id,
      description: `Updated maintenance ticket for room ${existing.room.roomNumber}${status ? ` — status ${status}` : ""}`,
    });

    return NextResponse.json(order);
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
    requirePermission(ctx, "MAINTENANCE", "delete");

    const { id } = await params;

    const existing = await prisma.roomMaintenance.findUnique({
      where: { id },
      include: { room: true }
    });
    if (!existing) {
      return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.room.propertyId);

    await prisma.roomMaintenance.delete({
      where: { id }
    });

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "DELETE",
      entityType: "RoomMaintenance",
      entityId: id,
      description: `Deleted maintenance ticket for room ${existing.room.roomNumber} (${existing.issueType})`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
