import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { therapistExceptionSchema } from "@/lib/spa-exception";

// Same permission gate as schedule/skills (CONTROLS) for v1 — see SPA_PLAN.md §3's
// nuance note on this being a genuine, not-yet-settled judgment call (a same-day
// absence arguably belongs under the operational SPA module instead).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const { id } = await params;
    const parsed = therapistExceptionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid exception" }, { status: 400 });
    }
    const body = parsed.data;
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const therapist = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!therapist) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, therapist.propertyId, "SPA");

    const exception = await prisma.spaTherapistAvailabilityException.create({
      data: {
        therapistId: id,
        date,
        startTime: body.startTime,
        endTime: body.endTime,
        exceptionType: body.exceptionType,
        reason: body.reason,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaTherapistAvailabilityException", entityId: exception.id,
      description: `Added ${body.exceptionType} exception for spa therapist "${therapist.displayName}" on ${date.toDateString()}${body.startTime ? ` ${body.startTime}–${body.endTime}` : ""}`,
    });

    return NextResponse.json(exception, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
