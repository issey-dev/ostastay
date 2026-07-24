import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { isFeeRuleType, isFeeBasis } from "@/lib/fee-rules";
import { logActivity } from "@/lib/activity-log";

// Per-property Deposit / Cancellation / No-Show fee rules (Controls > Fee Rules).
// Many named rules are allowed per type; a reservation picks one of each to apply.
// GET (list) / POST (create) / PUT (update by id) / DELETE (by id).

// Shared validation for create/update payloads.
async function validateRulePayload(
  body: { name?: unknown; ruleType?: unknown; basis?: unknown; value?: unknown; chargeCodeId?: unknown; isActive?: unknown },
  enterpriseId: string
): Promise<{ error: string; status: number } | { ok: true; name: string; value: number; chargeCodeId: string | null }> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "A rule name is required", status: 400 };
  if (!isFeeRuleType(body.ruleType)) return { error: "Invalid rule type", status: 400 };
  if (!isFeeBasis(body.basis)) return { error: "Invalid amount basis", status: 400 };
  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return { error: "Value must be a non-negative number", status: 400 };
  const chargeCodeId = body.chargeCodeId ? String(body.chargeCodeId) : null;

  // A cancellation / no-show fee posts against a charge code, so an active rule of those
  // types needs one. (A deposit is a payment and needs no charge code.)
  if (body.isActive && body.ruleType !== "DEPOSIT" && !chargeCodeId) {
    return { error: "Select a charge code for an active cancellation / no-show fee.", status: 400 };
  }
  if (chargeCodeId) {
    const code = await prisma.chargeCode.findUnique({ where: { id: chargeCodeId } });
    if (!code || code.enterpriseId !== enterpriseId) return { error: "Charge code not found", status: 404 };
  }
  return { ok: true, name, value, chargeCodeId };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const rules = await prisma.propertyFeeRule.findMany({
      where: { propertyId },
      orderBy: [{ ruleType: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(rules);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    const propertyId = body.propertyId;
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const v = await validateRulePayload(body, ctx.enterpriseId);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });

    const rule = await prisma.propertyFeeRule.create({
      data: {
        propertyId,
        name: v.name,
        ruleType: body.ruleType,
        basis: body.basis,
        value: v.value,
        chargeCodeId: v.chargeCodeId,
        isActive: !!body.isActive,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "PropertyFeeRule", entityId: rule.id,
      description: `Created ${body.ruleType} fee rule "${v.name}" (${body.basis} ${v.value})`,
    });
    return NextResponse.json(rule);
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
    const id = body.id;
    if (!id) return NextResponse.json({ error: "Rule id is required" }, { status: 400 });

    const existing = await prisma.propertyFeeRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    await assertPropertyAccess(ctx, existing.propertyId);

    const v = await validateRulePayload({ ...body, ruleType: existing.ruleType }, ctx.enterpriseId);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });

    const rule = await prisma.propertyFeeRule.update({
      where: { id },
      data: { name: v.name, basis: body.basis, value: v.value, chargeCodeId: v.chargeCodeId, isActive: !!body.isActive },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "PropertyFeeRule", entityId: rule.id,
      description: `Updated ${existing.ruleType} fee rule "${v.name}" (${body.basis} ${v.value}${body.isActive ? ", active" : ", inactive"})`,
    });
    return NextResponse.json(rule);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Rule id is required" }, { status: 400 });

    const existing = await prisma.propertyFeeRule.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    await assertPropertyAccess(ctx, existing.propertyId);

    // Detach any reservations still pointing at this rule so they fall back to "no fee"
    // rather than holding a dangling id.
    await prisma.$transaction([
      prisma.reservation.updateMany({ where: { depositFeeRuleId: id }, data: { depositFeeRuleId: null } }),
      prisma.reservation.updateMany({ where: { cancellationFeeRuleId: id }, data: { cancellationFeeRuleId: null } }),
      prisma.reservation.updateMany({ where: { noShowFeeRuleId: id }, data: { noShowFeeRuleId: null } }),
      prisma.propertyFeeRule.delete({ where: { id } }),
    ]);

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "PropertyFeeRule", entityId: id,
      description: `Deleted ${existing.ruleType} fee rule "${existing.name}"`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
