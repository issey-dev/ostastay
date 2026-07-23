import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { PRICING_MODES, parseRatesInput, type SpaRateInput } from "@/lib/spa";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  category: { select: { id: true, name: true } },
  chargeCode: { select: { id: true, code: true, description: true } },
  rates: { orderBy: { effectiveFrom: "asc" as const } },
  therapistSkills: { select: { therapistId: true } },
  compatibleRooms: { select: { roomId: true, preferred: true } },
};

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.spaTreatment.findUnique({
      where: { id },
      include: { property: { select: { enterpriseId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Treatment not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    if (body.pricingMode && !PRICING_MODES.includes(body.pricingMode)) {
      return NextResponse.json({ error: `pricingMode must be one of ${PRICING_MODES.join(", ")}` }, { status: 400 });
    }

    if (body.categoryId && body.categoryId !== existing.categoryId) {
      const category = await prisma.spaTreatmentCategory.findUnique({ where: { id: body.categoryId } });
      if (!category || category.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Category does not belong to this property" }, { status: 400 });
      }
    }

    if (body.chargeCodeId && body.chargeCodeId !== existing.chargeCodeId) {
      const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
      if (!chargeCode || chargeCode.enterpriseId !== existing.property.enterpriseId) {
        return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
      }
    }

    let maxParticipants: number | undefined;
    if (body.maxParticipants !== undefined) {
      maxParticipants = parseInt(body.maxParticipants);
      if (isNaN(maxParticipants) || maxParticipants < 1) {
        return NextResponse.json({ error: "maxParticipants must be at least 1" }, { status: 400 });
      }
    }

    // `rates` (when provided) is a full replacement of the dated price rows — same
    // whole-set-overlap-validation convention as Excursions/Allocations.
    let ratesUpdate: { deleteMany: object; create: SpaRateInput[] } | undefined;
    if (body.rates !== undefined) {
      const parsed = parseRatesInput(body.rates);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      ratesUpdate = { deleteMany: {}, create: parsed.rates };
    }

    const treatment = await prisma.spaTreatment.update({
      where: { id },
      data: {
        categoryId: body.categoryId ?? undefined,
        name: body.name ?? undefined,
        shortName: body.shortName !== undefined ? body.shortName || null : undefined,
        description: body.description !== undefined ? body.description || null : undefined,
        defaultDurationMinutes: body.defaultDurationMinutes !== undefined ? parseInt(body.defaultDurationMinutes) : undefined,
        preparationBufferMinutes: body.preparationBufferMinutes !== undefined ? parseInt(body.preparationBufferMinutes) : undefined,
        cleanupBufferMinutes: body.cleanupBufferMinutes !== undefined ? parseInt(body.cleanupBufferMinutes) : undefined,
        chargeCodeId: body.chargeCodeId ?? undefined,
        maxParticipants,
        pricingMode: body.pricingMode ?? undefined,
        allowWalkIn: body.allowWalkIn !== undefined ? !!body.allowWalkIn : undefined,
        allowInHouseGuest: body.allowInHouseGuest !== undefined ? !!body.allowInHouseGuest : undefined,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        rates: ratesUpdate,
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTreatment", entityId: treatment.id,
      description: `Updated spa treatment "${treatment.name}"`,
    });

    return NextResponse.json(treatment);
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
    const existing = await prisma.spaTreatment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Treatment not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const appointmentCount = await prisma.spaAppointment.count({ where: { treatmentId: id } });
    if (appointmentCount > 0) {
      return NextResponse.json(
        { error: "This treatment has appointments booked and cannot be deleted — deactivate it instead" },
        { status: 400 }
      );
    }

    await prisma.spaTreatment.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "SpaTreatment", entityId: id,
      description: `Deleted spa treatment "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
