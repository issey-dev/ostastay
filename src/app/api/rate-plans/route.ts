import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const ratePlans = await prisma.ratePlan.findMany({
      where: { propertyId },
      include: {
        parentRatePlan: { select: { id: true, name: true, code: true } },
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
      },
      orderBy: { priority: 'asc' }, // Higher priority (lower number) first
    });
    return NextResponse.json(ratePlans);
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

    if (!body.code || !body.name || !body.propertyId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    // Derived Rate Plans: a plan can inherit its per-night price from another plan at
    // this property plus a percent/flat adjustment, resolved live at every lookup
    // (never materialized). Chaining is disallowed — a derived plan's own parent must
    // not itself be derived, keeping resolution a single hop everywhere it's read.
    let parentRatePlanId: string | null = null;
    let derivedAdjustmentType: string | null = null;
    let derivedAdjustmentValue: number | null = null;
    if (body.parentRatePlanId) {
      const parent = await prisma.ratePlan.findUnique({ where: { id: body.parentRatePlanId } });
      if (!parent || parent.propertyId !== body.propertyId) {
        return NextResponse.json({ error: "Parent rate plan not found" }, { status: 404 });
      }
      if (parent.parentRatePlanId) {
        return NextResponse.json({ error: "Cannot derive from a rate plan that is itself derived" }, { status: 400 });
      }
      if (!["PERCENT", "FLAT"].includes(body.derivedAdjustmentType)) {
        return NextResponse.json({ error: "derivedAdjustmentType must be PERCENT or FLAT" }, { status: 400 });
      }
      const adjustmentValue = parseFloat(body.derivedAdjustmentValue);
      if (isNaN(adjustmentValue)) {
        return NextResponse.json({ error: "derivedAdjustmentValue is required when deriving from another rate plan" }, { status: 400 });
      }
      parentRatePlanId = parent.id;
      derivedAdjustmentType = body.derivedAdjustmentType;
      derivedAdjustmentValue = adjustmentValue;
    }

    // Package contents: which Allocations this plan carries. Any allocation belonging
    // to this property is linkable — the allocation's own `mode` (include/add) decides
    // how it posts; `sellSeparate` is independent and doesn't affect linkability.
    let allocationIds: string[] = [];
    if (Array.isArray(body.allocationIds) && body.allocationIds.length > 0) {
      allocationIds = [...new Set(body.allocationIds as string[])];
      const linkable = await prisma.allocation.findMany({
        where: { id: { in: allocationIds }, propertyId: body.propertyId },
      });
      if (linkable.length !== allocationIds.length) {
        return NextResponse.json(
          { error: "Allocations must belong to this property" },
          { status: 400 }
        );
      }
    }

    const newRatePlan = await prisma.ratePlan.create({
      data: {
        propertyId: body.propertyId,
        code: body.code.toUpperCase(),
        name: body.name,
        description: body.description,
        priority: parseInt(body.priority) || 10,
        isNegotiated: !!body.isNegotiated,
        parentRatePlanId,
        derivedAdjustmentType,
        derivedAdjustmentValue,
        allocationLinks: allocationIds.length > 0
          ? { create: allocationIds.map((allocationId) => ({ allocationId })) }
          : undefined,
      },
      include: {
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
      },
    });

    return NextResponse.json(newRatePlan, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
