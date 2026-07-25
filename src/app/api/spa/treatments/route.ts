import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, hasPermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { PRICING_MODES, parseRatesInput } from "@/lib/spa";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  category: { select: { id: true, name: true } },
  chargeCode: { select: { id: true, code: true, description: true } },
  rates: { orderBy: { effectiveFrom: "asc" as const } },
  therapistSkills: { select: { therapistId: true } },
  compatibleRooms: { select: { roomId: true, preferred: true } },
};

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

    const treatments = await prisma.spaTreatment.findMany({
      where: { propertyId },
      include: includeShape,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(treatments);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    if (!body.propertyId || !body.categoryId || !body.name || !body.chargeCodeId || !body.defaultDurationMinutes) {
      return NextResponse.json(
        { error: "Missing required fields (propertyId, categoryId, name, chargeCodeId, defaultDurationMinutes)" },
        { status: 400 }
      );
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "SPA");

    const pricingMode = body.pricingMode || "PER_PERSON";
    if (!PRICING_MODES.includes(pricingMode)) {
      return NextResponse.json({ error: `pricingMode must be one of ${PRICING_MODES.join(", ")}` }, { status: 400 });
    }

    const category = await prisma.spaTreatmentCategory.findUnique({ where: { id: body.categoryId } });
    if (!category || category.propertyId !== body.propertyId) {
      return NextResponse.json({ error: "Category does not belong to this property" }, { status: 400 });
    }

    // The charge code is enterprise-wide; it must belong to the same enterprise as
    // the property this treatment is scoped to — same rule as Excursions/Allocations.
    const property = await prisma.property.findUnique({ where: { id: body.propertyId } });
    const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
    if (!property || !chargeCode || chargeCode.enterpriseId !== property.enterpriseId) {
      return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
    }

    const maxParticipants = body.maxParticipants !== undefined ? parseInt(body.maxParticipants) : 1;
    if (isNaN(maxParticipants) || maxParticipants < 1) {
      return NextResponse.json({ error: "maxParticipants must be at least 1" }, { status: 400 });
    }

    const parsed = parseRatesInput(body.rates);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const treatment = await prisma.spaTreatment.create({
      data: {
        propertyId: body.propertyId,
        categoryId: body.categoryId,
        name: body.name,
        shortName: body.shortName || null,
        description: body.description || null,
        defaultDurationMinutes: parseInt(body.defaultDurationMinutes),
        preparationBufferMinutes: body.preparationBufferMinutes !== undefined ? parseInt(body.preparationBufferMinutes) : 0,
        cleanupBufferMinutes: body.cleanupBufferMinutes !== undefined ? parseInt(body.cleanupBufferMinutes) : 0,
        chargeCodeId: body.chargeCodeId,
        maxParticipants,
        pricingMode,
        allowWalkIn: body.allowWalkIn !== undefined ? !!body.allowWalkIn : true,
        allowInHouseGuest: body.allowInHouseGuest !== undefined ? !!body.allowInHouseGuest : true,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : 0,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        rates: { create: parsed.rates },
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaTreatment", entityId: treatment.id,
      description: `Created spa treatment "${treatment.name}"`,
    });

    return NextResponse.json(treatment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
