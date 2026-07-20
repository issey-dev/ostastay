import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
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

    const ratePlans = await prisma.ratePlan.findMany({
      where: { propertyId },
      include: {
        parentRatePlan: { select: { id: true, name: true, code: true } },
        chargeCode: { select: { id: true, code: true, description: true } },
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
        agentAccess: { select: { upid: true } },
      },
      orderBy: { priority: 'asc' }, // Higher priority (lower number) first
    });
    // Flatten agentAccess into a plain id list — only meaningful when isNegotiated is
    // true, see RatePlanAgentAccess. The reservation form's rate-plan selector uses
    // this to restrict a negotiated plan to bookings through one of these profiles.
    const withAgentIds = ratePlans.map((rp) => ({
      ...rp,
      negotiatedForProfileIds: rp.agentAccess.map((a) => a.upid),
    }));
    return NextResponse.json(withAgentIds);
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
    if (body.code.toUpperCase() === "BASE") {
      return NextResponse.json(
        { error: '"BASE" is reserved for the property\'s own Base Rate plan, created automatically at onboarding' },
        { status: 400 }
      );
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

    // Optional accommodation charge code this plan's room charge posts against at Night
    // Audit (null = use the enterprise default). Must belong to the same enterprise.
    let chargeCodeId: string | null = null;
    if (body.chargeCodeId) {
      const property = await prisma.property.findUnique({ where: { id: body.propertyId } });
      const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
      if (!property || !chargeCode || chargeCode.enterpriseId !== property.enterpriseId) {
        return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
      }
      chargeCodeId = chargeCode.id;
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
        isComplimentary: !!body.isComplimentary,
        isHouseUse: !!body.isHouseUse,
        chargeCodeId,
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

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "CREATE",
      entityType: "RatePlan",
      entityId: newRatePlan.id,
      description: `Created rate plan "${newRatePlan.name}" (${newRatePlan.code})`,
    });

    return NextResponse.json(newRatePlan, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
