import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { PRICING_MODES, parseRatesInput, type ExcursionRateInput } from "@/lib/excursions";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.excursionType.findUnique({
      where: { id },
      include: { property: { select: { enterpriseId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Excursion type not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "EXCURSIONS");

    const pricingMode = body.pricingMode ?? existing.pricingMode;
    if (body.pricingMode && !PRICING_MODES.includes(body.pricingMode)) {
      return NextResponse.json({ error: `pricingMode must be one of ${PRICING_MODES.join(", ")}` }, { status: 400 });
    }

    if (body.chargeCodeId && body.chargeCodeId !== existing.chargeCodeId) {
      const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
      if (!chargeCode || chargeCode.enterpriseId !== existing.property.enterpriseId) {
        return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
      }
    }

    // `rates` (when provided) is a full replacement of the dated price rows — same
    // whole-set-overlap-validation convention as Allocations.
    let ratesUpdate: { deleteMany: object; create: ExcursionRateInput[] } | undefined;
    if (body.rates !== undefined) {
      const parsed = parseRatesInput(body.rates, pricingMode);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      ratesUpdate = { deleteMany: {}, create: parsed.rates };
    }

    const excursionType = await prisma.excursionType.update({
      where: { id },
      data: {
        code: body.code ? String(body.code).toUpperCase() : undefined,
        name: body.name ?? undefined,
        description: body.description !== undefined ? body.description || null : undefined,
        chargeCodeId: body.chargeCodeId ?? undefined,
        pricingMode: body.pricingMode ?? undefined,
        cutoffHours: body.cutoffHours !== undefined ? parseInt(body.cutoffHours) : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        rates: ratesUpdate,
      },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
        schedules: { orderBy: { departureTime: "asc" } },
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "ExcursionType", entityId: excursionType.id,
      description: `Updated excursion type "${excursionType.name}" (${excursionType.code})`,
    });

    return NextResponse.json(excursionType);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An excursion type with this code already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.excursionType.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Excursion type not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "EXCURSIONS");

    // Bookings reference this type via departure -> excursionType (RESTRICT FK on
    // ExcursionDeparture), so any departure with bookings blocks deletion — same
    // "deactivate instead" guidance as Allocations.
    const departureCount = await prisma.excursionDeparture.count({ where: { excursionTypeId: id } });
    if (departureCount > 0) {
      return NextResponse.json(
        { error: "This excursion type has departures scheduled and cannot be deleted — deactivate it instead" },
        { status: 400 }
      );
    }

    await prisma.excursionType.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "ExcursionType", entityId: id,
      description: `Deleted excursion type "${existing.name}" (${existing.code})`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
