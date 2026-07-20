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
    requirePermission(ctx, "MAINTENANCE", "update");

    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: "Missing status field" }, { status: 400 });
    }

    const existing = await prisma.roomMaintenance.findUnique({
      where: { id },
      include: { room: true }
    });
    if (!existing) {
      return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.room.propertyId);

    const order = await prisma.roomMaintenance.update({
      where: { id },
      data: {
        status: body.status
      }
    });

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "UPDATE",
      entityType: "RoomMaintenance",
      entityId: order.id,
      description: `Set maintenance ticket for room ${existing.room.roomNumber} to ${body.status}`,
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
