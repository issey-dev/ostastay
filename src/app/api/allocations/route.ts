import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { ALLOCATION_TYPES, POSTING_RHYTHMS, ALLOCATION_MODES, parseRatesInput } from "@/lib/allocations";
import { logActivity } from "@/lib/activity-log";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const allocations = await prisma.allocation.findMany({
      where: { propertyId },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
      },
      orderBy: [{ type: "asc" }, { code: "asc" }],
    });
    return NextResponse.json(allocations);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "create");

    const body = await request.json();
    if (!body.propertyId || !body.code || !body.name || !body.chargeCodeId) {
      return NextResponse.json({ error: "Missing required fields (propertyId, code, name, chargeCodeId)" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    if (body.type && !ALLOCATION_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${ALLOCATION_TYPES.join(", ")}` }, { status: 400 });
    }
    if (body.postingRhythm && !POSTING_RHYTHMS.includes(body.postingRhythm)) {
      return NextResponse.json({ error: `postingRhythm must be one of ${POSTING_RHYTHMS.join(", ")}` }, { status: 400 });
    }
    if (body.mode && !ALLOCATION_MODES.includes(body.mode)) {
      return NextResponse.json({ error: `mode must be one of ${ALLOCATION_MODES.join(", ")}` }, { status: 400 });
    }

    // The charge code is enterprise-wide; it must belong to the same enterprise as
    // the property this allocation is scoped to.
    const property = await prisma.property.findUnique({ where: { id: body.propertyId } });
    const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
    if (!property || !chargeCode || chargeCode.enterpriseId !== property.enterpriseId) {
      return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
    }

    const parsed = parseRatesInput(body.rates);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const allocation = await prisma.allocation.create({
      data: {
        propertyId: body.propertyId,
        code: String(body.code).toUpperCase(),
        name: body.name,
        type: body.type || "OTHER",
        chargeCodeId: body.chargeCodeId,
        postingRhythm: body.postingRhythm || "EVERY_NIGHT",
        mode: body.mode || "ADD_TO_RATE",
        sellSeparate: body.sellSeparate !== undefined ? !!body.sellSeparate : false,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        rates: { create: parsed.rates },
      },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
      },
    });

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "CREATE",
      entityType: "Allocation",
      entityId: allocation.id,
      description: `Created allocation "${allocation.name}" (${allocation.code})`,
    });

    return NextResponse.json(allocation, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An allocation with this code already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
