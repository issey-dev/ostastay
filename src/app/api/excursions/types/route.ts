import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { PRICING_MODES, parseRatesInput } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

// Catalog management (ExcursionType/Rate/Schedule) is gated by CONTROLS, the same
// permission every other catalog (RatePlan, Allocation, Outlet) is edited under — the
// EXCURSIONS module is reserved for day-to-day bookings only. See
// .agents/docs/EXCURSIONS_PLAN.md "Two permission gates, not one".
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    // assertPropertyModuleAccess (not just assertPropertyAccess) — catalog setup
    // requires the add-on to actually be purchased too, same as booking routes will,
    // so an enterprise can't configure/see excursion content for a property that
    // hasn't bought it.
    await assertPropertyModuleAccess(ctx, propertyId, "EXCURSIONS");

    const types = await prisma.excursionType.findMany({
      where: { propertyId },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
        schedules: { orderBy: { departureTime: "asc" } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json(types);
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
    if (!body.propertyId || !body.code || !body.name || !body.chargeCodeId) {
      return NextResponse.json({ error: "Missing required fields (propertyId, code, name, chargeCodeId)" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "EXCURSIONS");

    const pricingMode = body.pricingMode || "PER_PERSON";
    if (!PRICING_MODES.includes(pricingMode)) {
      return NextResponse.json({ error: `pricingMode must be one of ${PRICING_MODES.join(", ")}` }, { status: 400 });
    }

    // The charge code is enterprise-wide; it must belong to the same enterprise as
    // the property this excursion type is scoped to — same rule as Allocations.
    const property = await prisma.property.findUnique({ where: { id: body.propertyId } });
    const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
    if (!property || !chargeCode || chargeCode.enterpriseId !== property.enterpriseId) {
      return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
    }

    const parsed = parseRatesInput(body.rates, pricingMode);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const excursionType = await prisma.excursionType.create({
      data: {
        propertyId: body.propertyId,
        code: String(body.code).toUpperCase(),
        name: body.name,
        description: body.description || null,
        chargeCodeId: body.chargeCodeId,
        pricingMode,
        cutoffHours: body.cutoffHours !== undefined ? parseInt(body.cutoffHours) : 24,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        rates: { create: parsed.rates },
      },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
        schedules: true,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ExcursionType",
      entityId: excursionType.id,
      description: `Created excursion type "${excursionType.name}" (${excursionType.code})`,
    });

    return NextResponse.json(excursionType, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An excursion type with this code already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
