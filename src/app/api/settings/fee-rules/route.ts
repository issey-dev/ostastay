import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { FEE_RULE_TYPES, isFeeRuleType, isFeeBasis } from "@/lib/fee-rules";
import { logActivity } from "@/lib/activity-log";

// Per-property Deposit / Cancellation / No-Show fee rules (Controls > Fee Rules).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const existing = await prisma.propertyFeeRule.findMany({ where: { propertyId } });
    // Always return one entry per rule type, filling in inactive defaults.
    const rules = FEE_RULE_TYPES.map((ruleType) => {
      const row = existing.find((r) => r.ruleType === ruleType);
      return row ?? { id: null, propertyId, ruleType, basis: "FLAT", value: 0, chargeCodeId: null, isActive: false };
    });
    return NextResponse.json(rules);
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
    const { propertyId, ruleType, basis, isActive } = body;
    const value = Number(body.value);
    const chargeCodeId = body.chargeCodeId || null;

    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);
    if (!isFeeRuleType(ruleType)) return NextResponse.json({ error: "Invalid rule type" }, { status: 400 });
    if (!isFeeBasis(basis)) return NextResponse.json({ error: "Invalid amount basis" }, { status: 400 });
    if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Value must be a non-negative number" }, { status: 400 });

    // A cancellation / no-show fee posts against a charge code, so an active rule of
    // those types needs one. (A deposit is a payment and needs no charge code.)
    if (isActive && ruleType !== "DEPOSIT" && !chargeCodeId) {
      return NextResponse.json({ error: "Select a charge code for an active cancellation / no-show fee." }, { status: 400 });
    }
    if (chargeCodeId) {
      const code = await prisma.chargeCode.findUnique({ where: { id: chargeCodeId } });
      if (!code || code.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
      }
    }

    const rule = await prisma.propertyFeeRule.upsert({
      where: { propertyId_ruleType: { propertyId, ruleType } },
      update: { basis, value, chargeCodeId, isActive: !!isActive },
      create: { propertyId, ruleType, basis, value, chargeCodeId, isActive: !!isActive },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "PropertyFeeRule",
      entityId: rule.id,
      description: `Updated ${ruleType} fee rule (${basis} ${value}${isActive ? ", active" : ", inactive"})`,
    });

    return NextResponse.json(rule);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
