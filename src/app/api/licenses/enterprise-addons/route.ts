import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Enterprise-level SELLABLE ADD-ON gate (Spa, Excursions) — enterprise-scoped since
// 2026-08-02 (owner decision): an add-on is sold to the enterprise and, once enabled,
// applies to every property in it. Distinct from the removed enterprise-level module
// gating (TierModuleAccess/EnterpriseModuleAccess, dropped 2026-07-31): a missing
// EnterpriseAddonAccess row means "not purchased", so this returns a plain boolean per
// module with no fallback chain.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view enterprise add-on access");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const enterpriseId = searchParams.get("enterpriseId");
    if (!enterpriseId) {
      return NextResponse.json({ error: "enterpriseId is required" }, { status: 400 });
    }

    const rows = await prisma.enterpriseAddonAccess.findMany({ where: { enterpriseId } });
    const byModule = new Map(rows.map((r) => [r.module, r.enabled]));

    return NextResponse.json(
      MODULES.map((module) => ({ module, enabled: byModule.get(module) ?? false }))
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can edit enterprise add-on access");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.enterpriseId || !body.module || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enterpriseId, module, and enabled (boolean) are required" }, { status: 400 });
    }
    // `module` is written straight into EnterpriseAddonAccess's compound key, so an
    // unrecognised value would silently create a permanent row for a module that does
    // not exist — invisible to the GET above (it projects over MODULES) and therefore
    // un-removable through the UI. Reject rather than persist.
    if (!(MODULES as readonly string[]).includes(body.module)) {
      return NextResponse.json({ error: "Unknown module" }, { status: 400 });
    }

    const target = await prisma.enterprise.findUnique({ where: { id: body.enterpriseId }, select: { name: true } });
    if (!target) {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    const row = await prisma.enterpriseAddonAccess.upsert({
      where: { enterpriseId_module: { enterpriseId: body.enterpriseId, module: body.module } },
      update: { enabled: body.enabled },
      create: { enterpriseId: body.enterpriseId, module: body.module, enabled: body.enabled },
    });

    const description = `${body.enabled ? "Enabled" : "Disabled"} the ${body.module} add-on for "${target.name}" (all properties)`;
    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "EnterpriseAddonAccess", entityId: row.id,
      description, targetEnterpriseId: body.enterpriseId,
    });

    return NextResponse.json({ module: row.module, enabled: row.enabled });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
