import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Scaffold only — see src/lib/scope.ts's requireModuleLicensed(). This just lets the
// Licensing tab display/edit the (currently mostly-empty) TierModuleAccess table; it is
// not itself an enforcement point.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view the tier/module scaffold");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const tier = searchParams.get("tier") ?? "STANDARD";

    const rows = await prisma.tierModuleAccess.findMany({ where: { tier } });
    const byModule = new Map(rows.map((r) => [r.module, r.enabled]));

    return NextResponse.json(
      MODULES.map((module) => ({ tier, module, enabled: byModule.get(module) ?? true }))
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
      throw new ForbiddenError("Only Osta staff can edit the tier/module scaffold");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.tier || !body.module || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "tier, module, and enabled are required" }, { status: 400 });
    }

    const row = await prisma.tierModuleAccess.upsert({
      where: { tier_module: { tier: body.tier, module: body.module } },
      update: { enabled: body.enabled },
      create: { tier: body.tier, module: body.module, enabled: body.enabled },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "TierModuleAccess",
      entityId: row.id,
      description: `${body.enabled ? "Enabled" : "Disabled"} module ${body.module} for tier ${body.tier}`,
    });

    return NextResponse.json(row);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
