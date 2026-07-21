import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Per-enterprise override — takes precedence over TierModuleAccess (the tier-wide
// default every enterprise falls back to absent its own override). See
// computeLicensedModules() in src/lib/scope.ts for the real enforcement this feeds.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view enterprise module overrides");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const enterpriseId = searchParams.get("enterpriseId");
    if (!enterpriseId) {
      return NextResponse.json({ error: "enterpriseId is required" }, { status: 400 });
    }

    const rows = await prisma.enterpriseModuleAccess.findMany({ where: { enterpriseId } });
    const byModule = new Map(rows.map((r) => [r.module, r.enabled]));

    // null = no override (falls back to tier default) — distinct from an explicit false.
    return NextResponse.json(
      MODULES.map((module) => ({ module, override: byModule.has(module) ? byModule.get(module) : null }))
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
      throw new ForbiddenError("Only Osta staff can edit enterprise module overrides");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.enterpriseId || !body.module) {
      return NextResponse.json({ error: "enterpriseId and module are required" }, { status: 400 });
    }

    const target = await prisma.enterprise.findUnique({ where: { id: body.enterpriseId }, select: { name: true } });
    if (!target) {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    // enabled === null clears the override (reset to tier default) rather than storing one.
    if (body.enabled === null) {
      await prisma.enterpriseModuleAccess.deleteMany({ where: { enterpriseId: body.enterpriseId, module: body.module } });
      await logActivity({
        ctx, module: "CONTROLS", action: "UPDATE", entityType: "EnterpriseModuleAccess",
        description: `Reset ${body.module} to the tier default for "${target.name}"`,
        targetEnterpriseId: body.enterpriseId,
      });
      return NextResponse.json({ module: body.module, override: null });
    }

    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean or null" }, { status: 400 });
    }

    const row = await prisma.enterpriseModuleAccess.upsert({
      where: { enterpriseId_module: { enterpriseId: body.enterpriseId, module: body.module } },
      update: { enabled: body.enabled },
      create: { enterpriseId: body.enterpriseId, module: body.module, enabled: body.enabled },
    });

    const description = `${body.enabled ? "Force-enabled" : "Force-disabled"} ${body.module} for "${target.name}"`;
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "EnterpriseModuleAccess", entityId: row.id, description });
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "EnterpriseModuleAccess", entityId: row.id, description, targetEnterpriseId: body.enterpriseId });

    return NextResponse.json({ module: row.module, override: row.enabled });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
