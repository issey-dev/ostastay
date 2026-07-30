import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, hasPermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const CHARGE_TIMINGS = ["AT_BOOKING", "AT_COMPLETION"] as const;
const CHARGE_TYPES = ["NONE", "FULL", "PERCENTAGE", "FIXED"] as const;

// No SpaSettings row means every field reads through its own schema default — same
// "missing row = defaults" convention used everywhere else in this app (e.g.
// PropertyModuleAccess). GET never creates a row; PUT upserts one.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");
    // Readable by a SPA booking user OR a CONTROLS catalog manager, but not by a user with neither.
    if (!hasPermission(ctx, "SPA", "view") && !hasPermission(ctx, "CONTROLS", "view")) {
      throw new ForbiddenError("Missing view permission on Spa");
    }

    const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });
    return NextResponse.json(settings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "SPA");

    if (body.chargeTiming && !CHARGE_TIMINGS.includes(body.chargeTiming)) {
      return NextResponse.json({ error: `chargeTiming must be one of ${CHARGE_TIMINGS.join(", ")}` }, { status: 400 });
    }
    if (body.lateCancellationChargeType && !CHARGE_TYPES.includes(body.lateCancellationChargeType)) {
      return NextResponse.json({ error: `lateCancellationChargeType must be one of ${CHARGE_TYPES.join(", ")}` }, { status: 400 });
    }
    if (body.noShowChargeType && !CHARGE_TYPES.includes(body.noShowChargeType)) {
      return NextResponse.json({ error: `noShowChargeType must be one of ${CHARGE_TYPES.join(", ")}` }, { status: 400 });
    }

    // The Spa Outlet link is hub-wide (EnterpriseSettings.spaOutletId, managed via
    // /api/module-outlets) — this route now carries only per-property policy.
    const data = {
      defaultOpeningTime: body.defaultOpeningTime ?? undefined,
      defaultClosingTime: body.defaultClosingTime ?? undefined,
      slotIntervalMinutes: body.slotIntervalMinutes !== undefined ? parseInt(body.slotIntervalMinutes) : undefined,
      defaultPreparationBufferMinutes: body.defaultPreparationBufferMinutes !== undefined ? parseInt(body.defaultPreparationBufferMinutes) : undefined,
      defaultCleanupBufferMinutes: body.defaultCleanupBufferMinutes !== undefined ? parseInt(body.defaultCleanupBufferMinutes) : undefined,
      allowTentativeAppointments: body.allowTentativeAppointments !== undefined ? !!body.allowTentativeAppointments : undefined,
      tentativeHoldMinutes: body.tentativeHoldMinutes !== undefined ? parseInt(body.tentativeHoldMinutes) : undefined,
      requireTherapistAtBooking: body.requireTherapistAtBooking !== undefined ? !!body.requireTherapistAtBooking : undefined,
      requireRoomAtBooking: body.requireRoomAtBooking !== undefined ? !!body.requireRoomAtBooking : undefined,
      allowAutoAssignment: body.allowAutoAssignment !== undefined ? !!body.allowAutoAssignment : undefined,
      chargeTiming: body.chargeTiming ?? undefined,
      cancellationCutoffHours: body.cancellationCutoffHours !== undefined ? parseInt(body.cancellationCutoffHours) : undefined,
      lateCancellationChargeType: body.lateCancellationChargeType ?? undefined,
      lateCancellationChargeValue: body.lateCancellationChargeValue !== undefined ? (body.lateCancellationChargeValue === null ? null : parseFloat(body.lateCancellationChargeValue)) : undefined,
      noShowChargeType: body.noShowChargeType ?? undefined,
      noShowChargeValue: body.noShowChargeValue !== undefined ? (body.noShowChargeValue === null ? null : parseFloat(body.noShowChargeValue)) : undefined,
      noShowGraceMinutes: body.noShowGraceMinutes !== undefined ? parseInt(body.noShowGraceMinutes) : undefined,
      requireCancellationReason: body.requireCancellationReason !== undefined ? !!body.requireCancellationReason : undefined,
      requireRescheduleReason: body.requireRescheduleReason !== undefined ? !!body.requireRescheduleReason : undefined,
    };

    const settings = await prisma.spaSettings.upsert({
      where: { propertyId: body.propertyId },
      update: data,
      // Schema defaults cover every field create doesn't explicitly set (undefined
      // values are dropped by Prisma, falling through to the column default).
      create: { propertyId: body.propertyId, ...data },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaSettings", entityId: settings.propertyId,
      description: "Updated spa module settings",
    });

    return NextResponse.json(settings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
