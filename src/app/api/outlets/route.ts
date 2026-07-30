import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { normalizeOutletCode, validateOutletCode } from "@/lib/outlet-code";
import { provisionOutletSubgroup } from "@/lib/posting/outlet-subgroup";

export const OUTLET_TYPES = ["SPA", "RESTAURANT", "BAR", "RETAIL", "TRANSPORT", "RECREATION", "OTHER"];
export const TAX_OVERRIDE_MODES = ["NONE", "DEFAULT_ENGINE", "CUSTOM"];

const OUTLET_INCLUDE = {
  taxProfile: { include: { rates: true } },
  chargeCodes: { include: { chargeCode: true } },
};

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    // Without a propertyId: every outlet across the enterprise, with its home property —
    // for hub-wide pickers (the Spa/Excursion module outlet links are deliberately
    // cross-property). Scoped to the session's own enterprise, never a client param.
    if (!propertyId) {
      const outlets = await prisma.outlet.findMany({
        where: { property: { enterpriseId: ctx.enterpriseId } },
        include: { ...OUTLET_INCLUDE, property: { select: { id: true, name: true } } },
        orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
      });
      return NextResponse.json(outlets);
    }

    await assertPropertyAccess(ctx, propertyId);

    const outlets = await prisma.outlet.findMany({
      where: { propertyId },
      include: OUTLET_INCLUDE,
      orderBy: { name: "asc" },
    });
    return NextResponse.json(outlets);
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

    if (!body.name || !body.propertyId) {
      return NextResponse.json({ error: "Name and Property ID are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const code = normalizeOutletCode(body.code);
    const codeError = validateOutletCode(code);
    if (codeError) {
      return NextResponse.json({ error: codeError }, { status: 400 });
    }
    const codeClash = await prisma.outlet.findFirst({ where: { propertyId: body.propertyId, code } });
    if (codeClash) {
      return NextResponse.json({ error: `Another outlet at this property already uses the code "${code}"` }, { status: 409 });
    }

    const outletType = OUTLET_TYPES.includes(body.outletType) ? body.outletType : "OTHER";
    const taxOverrideMode = TAX_OVERRIDE_MODES.includes(body.taxOverrideMode) ? body.taxOverrideMode : "NONE";

    let taxProfileId: string | null = null;
    if (taxOverrideMode === "CUSTOM") {
      if (!body.taxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when the tax override mode is Custom" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = body.taxProfileId;
    }

    const chargeCodeIds: string[] = Array.isArray(body.chargeCodeIds) ? body.chargeCodeIds : [];
    if (chargeCodeIds.length > 0) {
      const chargeCodes = await prisma.chargeCode.findMany({ where: { id: { in: chargeCodeIds } } });
      if (chargeCodes.length !== chargeCodeIds.length || chargeCodes.some((cc) => cc.enterpriseId !== ctx.enterpriseId)) {
        return NextResponse.json({ error: "One or more charge codes were not found" }, { status: 404 });
      }
    }

    const { newOutlet, provisioned } = await prisma.$transaction(async (tx) => {
      const created = await tx.outlet.create({
        data: {
          propertyId: body.propertyId,
          name: body.name,
          code,
          address: body.address?.trim() || null,
          email: body.email?.trim() || null,
          phone: body.phone?.trim() || null,
          taxNo: body.taxNo?.trim() || null,
          description: body.description || null,
          outletType,
          taxOverrideMode,
          taxProfileId,
          chargeCodes: chargeCodeIds.length > 0 ? { create: chargeCodeIds.map((id) => ({ chargeCodeId: id })) } : undefined,
        },
      });

      // Outlet-wise subgroups: the outlet gets its own nnRV charge subgroup + template
      // posting codes from its group's numeric band (owner ruling 2026-07-30).
      const provisioned = await provisionOutletSubgroup(tx, {
        enterpriseId: ctx.enterpriseId,
        outletId: created.id,
        outletName: created.name,
        outletType,
      });

      const newOutlet = await tx.outlet.findUniqueOrThrow({ where: { id: created.id }, include: OUTLET_INCLUDE });
      return { newOutlet, provisioned };
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Outlet",
      entityId: newOutlet.id,
      description: `Created outlet "${newOutlet.name}" (${outletType})` +
        (provisioned ? ` — charge subgroup ${provisioned.subgroupCode}` : ""),
    });

    return NextResponse.json({ ...newOutlet, provisionedSubgroup: provisioned?.subgroupCode ?? null }, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
