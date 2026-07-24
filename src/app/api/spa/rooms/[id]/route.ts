import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  compatibleTreatments: { include: { treatment: { select: { id: true, name: true } } } },
  exceptions: { orderBy: { date: "asc" as const } },
};

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.spaRoom.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    let capacity: number | undefined;
    if (body.capacity !== undefined) {
      capacity = parseInt(body.capacity);
      if (isNaN(capacity) || capacity < 1) {
        return NextResponse.json({ error: "capacity must be at least 1" }, { status: 400 });
      }
    }

    const room = await prisma.spaRoom.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        code: body.code !== undefined ? body.code || null : undefined,
        description: body.description !== undefined ? body.description || null : undefined,
        capacity,
        roomType: body.roomType !== undefined ? body.roomType || null : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        bookable: body.bookable !== undefined ? !!body.bookable : undefined,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : undefined,
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaRoom", entityId: room.id,
      description: `Updated spa room "${room.name}"`,
    });

    return NextResponse.json(room);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.spaRoom.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const appointmentCount = await prisma.spaAppointment.count({ where: { roomId: id } });
    if (appointmentCount > 0) {
      return NextResponse.json(
        { error: "This room has appointments booked and cannot be deleted — mark it inactive instead" },
        { status: 400 }
      );
    }

    await prisma.spaRoom.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "SpaRoom", entityId: id,
      description: `Deleted spa room "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
