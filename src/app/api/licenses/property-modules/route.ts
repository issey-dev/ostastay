import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, MODULES } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Per-property add-on gate — the property-scoped sibling of
// src/app/api/licenses/enterprise-modules/route.ts. Unlike that route (an override on
// top of an otherwise-enabled-by-default module), a missing PropertyModuleAccess row
// here means "not purchased" — there is no tier-default fallback to report, so this
// always returns a plain boolean per module rather than enterprise-modules' tri-state
// (override / null-falls-back-to-tier).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view property add-on access");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const rows = await prisma.propertyModuleAccess.findMany({ where: { propertyId } });
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
      throw new ForbiddenError("Only Osta staff can edit property add-on access");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.propertyId || !body.module || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "propertyId, module, and enabled (boolean) are required" }, { status: 400 });
    }

    const target = await prisma.property.findUnique({ where: { id: body.propertyId }, select: { name: true, enterpriseId: true } });
    if (!target) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const row = await prisma.propertyModuleAccess.upsert({
      where: { propertyId_module: { propertyId: body.propertyId, module: body.module } },
      update: { enabled: body.enabled },
      create: { propertyId: body.propertyId, module: body.module, enabled: body.enabled },
    });

    const description = `${body.enabled ? "Enabled" : "Disabled"} the ${body.module} add-on for "${target.name}"`;
    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "PropertyModuleAccess", entityId: row.id,
      description, targetEnterpriseId: target.enterpriseId,
    });

    return NextResponse.json({ module: row.module, enabled: row.enabled });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
