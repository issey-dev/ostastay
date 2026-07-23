import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { DAYS_OF_WEEK } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

async function loadScheduleWithAccess(ctx: Awaited<ReturnType<typeof requireSession>>, id: string) {
  const schedule = await prisma.excursionSchedule.findUnique({
    where: { id },
    include: { excursionType: { select: { propertyId: true, name: true } } },
  });
  if (!schedule) return null;
  await assertPropertyModuleAccess(ctx, schedule.excursionType.propertyId, "EXCURSIONS");
  return schedule;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();
    const existing = await loadScheduleWithAccess(ctx, id);
    if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    if (body.daysOfWeek !== undefined) {
      const codes = String(body.daysOfWeek).split(",").map((d: string) => d.trim().toUpperCase());
      const invalid = codes.filter((c: string) => !(DAYS_OF_WEEK as readonly string[]).includes(c));
      if (invalid.length > 0) {
        return NextResponse.json({ error: `Invalid day code(s): ${invalid.join(", ")}` }, { status: 400 });
      }
    }

    const schedule = await prisma.excursionSchedule.update({
      where: { id },
      data: {
        daysOfWeek: body.daysOfWeek !== undefined ? String(body.daysOfWeek).toUpperCase() : undefined,
        departureTime: body.departureTime ?? undefined,
        meetingTime: body.meetingTime !== undefined ? body.meetingTime || null : undefined,
        meetingPoint: body.meetingPoint !== undefined ? body.meetingPoint || null : undefined,
        capacity: body.capacity !== undefined ? parseInt(body.capacity) : undefined,
        minCapacity: body.minCapacity !== undefined ? (body.minCapacity === "" || body.minCapacity === null ? null : parseInt(body.minCapacity)) : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "ExcursionSchedule", entityId: schedule.id,
      description: `Updated the ${schedule.departureTime} schedule on "${existing.excursionType.name}"`,
    });

    return NextResponse.json(schedule);
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
    const existing = await loadScheduleWithAccess(ctx, id);
    if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    // Deleting a template never touches already-generated ExcursionDeparture rows
    // (scheduleId SET NULL) — cancelled trips must be cancelled explicitly, not
    // silently orphaned by deleting the template that spawned them.
    await prisma.excursionSchedule.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "ExcursionSchedule", entityId: id,
      description: `Deleted a schedule from "${existing.excursionType.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
