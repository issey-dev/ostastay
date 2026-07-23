import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { DAYS_OF_WEEK } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

function validateDaysOfWeek(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "daysOfWeek is required (e.g. \"MON,WED,FRI\")";
  const codes = value.split(",").map((d) => d.trim().toUpperCase());
  const invalid = codes.filter((c) => !(DAYS_OF_WEEK as readonly string[]).includes(c));
  if (invalid.length > 0) return `Invalid day code(s): ${invalid.join(", ")} — must be one of ${DAYS_OF_WEEK.join(", ")}`;
  return null;
}

// Creates a recurring template only — it does NOT itself create any ExcursionDeparture
// rows. Departures are generated explicitly via POST /api/excursions/schedules/generate
// so staff controls how far ahead the schedule actually gets expanded.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    if (!body.excursionTypeId || !body.departureTime || body.capacity == null) {
      return NextResponse.json({ error: "excursionTypeId, departureTime, and capacity are required" }, { status: 400 });
    }

    const daysError = validateDaysOfWeek(body.daysOfWeek);
    if (daysError) return NextResponse.json({ error: daysError }, { status: 400 });

    const excursionType = await prisma.excursionType.findUnique({ where: { id: body.excursionTypeId } });
    if (!excursionType) {
      return NextResponse.json({ error: "Excursion type not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, excursionType.propertyId, "EXCURSIONS");

    const capacity = parseInt(body.capacity);
    if (isNaN(capacity) || capacity < 1) {
      return NextResponse.json({ error: "capacity must be a positive integer" }, { status: 400 });
    }
    const minCapacity = body.minCapacity != null && body.minCapacity !== "" ? parseInt(body.minCapacity) : null;
    if (minCapacity != null && (isNaN(minCapacity) || minCapacity < 0)) {
      return NextResponse.json({ error: "minCapacity must be a non-negative integer" }, { status: 400 });
    }

    const schedule = await prisma.excursionSchedule.create({
      data: {
        excursionTypeId: body.excursionTypeId,
        daysOfWeek: String(body.daysOfWeek).toUpperCase(),
        departureTime: body.departureTime,
        meetingTime: body.meetingTime || null,
        meetingPoint: body.meetingPoint || null,
        capacity,
        minCapacity,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "ExcursionSchedule", entityId: schedule.id,
      description: `Added a ${schedule.departureTime} ${schedule.daysOfWeek} schedule to "${excursionType.name}"`,
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
