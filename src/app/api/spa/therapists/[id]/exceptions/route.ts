import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const EXCEPTION_TYPES = ["DAY_OFF", "LEAVE", "TRAINING", "SICK", "EXTENDED_HOURS", "UNAVAILABLE"] as const;

// Same permission gate as schedule/skills (CONTROLS) for v1 — see SPA_PLAN.md §3's
// nuance note on this being a genuine, not-yet-settled judgment call (a same-day
// absence arguably belongs under the operational SPA module instead).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const { id } = await params;
    const body = await request.json();
    if (!body.date || !body.exceptionType) {
      return NextResponse.json({ error: "Missing required fields (date, exceptionType)" }, { status: 400 });
    }
    if (!EXCEPTION_TYPES.includes(body.exceptionType)) {
      return NextResponse.json({ error: `exceptionType must be one of ${EXCEPTION_TYPES.join(", ")}` }, { status: 400 });
    }

    const therapist = await prisma.spaTherapist.findUnique({ where: { id } });
    if (!therapist) {
      return NextResponse.json({ error: "Therapist not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, therapist.propertyId, "SPA");

    const exception = await prisma.spaTherapistAvailabilityException.create({
      data: {
        therapistId: id,
        date: new Date(body.date),
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        exceptionType: body.exceptionType,
        reason: body.reason || null,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaTherapistAvailabilityException", entityId: exception.id,
      description: `Added ${body.exceptionType} exception for spa therapist "${therapist.displayName}" on ${new Date(body.date).toDateString()}`,
    });

    return NextResponse.json(exception, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
