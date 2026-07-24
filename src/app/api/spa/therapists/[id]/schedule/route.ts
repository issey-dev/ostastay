import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Full replacement of a therapist's weekly working-hours template — same "whole set"
// convention as skills/rates. Day-off/leave/sick-day EXCEPTIONS to this template are a
// separate sub-resource (see ../exceptions/route.ts), not edited here.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.schedules)) {
      return NextResponse.json({ error: "schedules must be an array" }, { status: 400 });
    }

    const therapist = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!therapist) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, therapist.propertyId, "SPA");

    for (const s of body.schedules) {
      if (typeof s.dayOfWeek !== "number" || s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        return NextResponse.json({ error: "Each schedule row needs a dayOfWeek between 0 and 6" }, { status: 400 });
      }
      if (!s.startTime || !s.endTime || s.startTime >= s.endTime) {
        return NextResponse.json({ error: "Each schedule row needs startTime before endTime" }, { status: 400 });
      }
      if (!s.effectiveFrom) {
        return NextResponse.json({ error: "Each schedule row needs an effectiveFrom date" }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.spaTherapistSchedule.deleteMany({ where: { therapistId: id } }),
      prisma.spaTherapistSchedule.createMany({
        data: body.schedules.map((s: { dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string; effectiveTo?: string; isActive?: boolean }) => ({
          therapistId: id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          effectiveFrom: new Date(s.effectiveFrom),
          effectiveTo: s.effectiveTo ? new Date(s.effectiveTo) : null,
          isActive: s.isActive !== undefined ? !!s.isActive : true,
        })),
      }),
    ]);

    const updated = await prisma.spaTherapist.findUnique({
      where: { id },
      include: { schedules: { orderBy: { dayOfWeek: "asc" } } },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTherapist", entityId: id,
      description: `Updated working-hours schedule for spa therapist "${therapist.displayName}"`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
