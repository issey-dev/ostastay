import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  skills: { include: { treatment: { select: { id: true, name: true } } } },
  schedules: { orderBy: { dayOfWeek: "asc" as const } },
  exceptions: { orderBy: { date: "asc" as const } },
};

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const therapist = await prisma.spaTherapist.update({
      where: { id },
      data: {
        employeeId: body.employeeId !== undefined ? body.employeeId || null : undefined,
        displayName: body.displayName ?? undefined,
        gender: body.gender !== undefined ? body.gender || null : undefined,
        phone: body.phone !== undefined ? body.phone || null : undefined,
        email: body.email !== undefined ? body.email || null : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        bookable: body.bookable !== undefined ? !!body.bookable : undefined,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : undefined,
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTherapist", entityId: therapist.id,
      description: `Updated spa therapist "${therapist.displayName}"`,
    });

    return NextResponse.json(therapist);
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
    const existing = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const assignmentCount = await prisma.spaAppointmentParticipant.count({ where: { therapistId: id } });
    if (assignmentCount > 0) {
      return NextResponse.json(
        { error: "This therapist has appointments assigned and cannot be deleted — mark them inactive instead" },
        { status: 400 }
      );
    }

    await prisma.spaTherapist.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "SpaTherapist", entityId: id,
      description: `Deleted spa therapist "${existing.displayName}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
