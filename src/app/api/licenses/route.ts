import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { computeLicenseState } from "@/lib/license";
import { logActivity } from "@/lib/activity-log";

// Non-Osta enterprises can view their own license (read-only, so an admin understands
// why e.g. property creation was rejected) but only Osta staff can change it — see the
// approved plan's Licensing section.
//
// 2026-07-31 rework (owner decisions): tier no longer prices anything — the license
// carries a MANUAL monthly price plus a lifecycle (status/validFrom/expiresAt/grace),
// and the attribute caps live per property in PropertyLicenseAllowance (see
// /api/licenses/allowances). `tier` is retained solely for the module fallback chain.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const requestedEnterpriseId = searchParams.get("enterpriseId") ?? ctx.enterpriseId;

    if (!ctx.isInternal && requestedEnterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this enterprise's license");
    }
    requirePermission(ctx, "CONTROLS", "view");

    let license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId: requestedEnterpriseId } });
    if (!license) {
      license = await prisma.enterpriseLicense.create({
        data: { enterpriseId: requestedEnterpriseId, tier: "STANDARD", maxProperties: 1 },
      });
    }

    const propertyCount = await prisma.property.count({ where: { enterpriseId: requestedEnterpriseId } });
    const { state, graceEndsAt } = computeLicenseState(license);

    return NextResponse.json({ ...license, propertyCount, state, graceEndsAt });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

function parseDateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can change licensing");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.enterpriseId) {
      return NextResponse.json({ error: "enterpriseId is required" }, { status: 400 });
    }
    if (body.status !== undefined && !["ACTIVE", "REVOKED"].includes(body.status)) {
      return NextResponse.json({ error: "status must be ACTIVE or REVOKED" }, { status: 400 });
    }

    const shared = {
      tier: body.tier,
      maxProperties: body.maxProperties !== undefined ? parseInt(body.maxProperties) : undefined,
      notes: body.notes,
      status: body.status,
      validFrom: parseDateOrNull(body.validFrom),
      expiresAt: parseDateOrNull(body.expiresAt),
      graceDays: body.graceDays !== undefined ? Math.max(0, parseInt(body.graceDays) || 0) : undefined,
      monthlyPrice:
        body.monthlyPrice === null || body.monthlyPrice === ""
          ? null
          : body.monthlyPrice !== undefined
            ? parseFloat(body.monthlyPrice)
            : undefined,
      priceCurrency: body.priceCurrency !== undefined ? String(body.priceCurrency).toUpperCase().slice(0, 8) : undefined,
    };

    const license = await prisma.enterpriseLicense.upsert({
      where: { enterpriseId: body.enterpriseId },
      update: shared,
      create: {
        enterpriseId: body.enterpriseId,
        tier: body.tier ?? "STANDARD",
        maxProperties: shared.maxProperties ?? 1,
        notes: body.notes,
        status: body.status ?? "ACTIVE",
        validFrom: shared.validFrom ?? null,
        expiresAt: shared.expiresAt ?? null,
        graceDays: shared.graceDays ?? 7,
        monthlyPrice: typeof shared.monthlyPrice === "number" ? shared.monthlyPrice : null,
        priceCurrency: shared.priceCurrency ?? "USD",
      },
    });

    const target = await prisma.enterprise.findUnique({ where: { id: body.enterpriseId }, select: { name: true } });
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "EnterpriseLicense",
      entityId: license.id,
      description: `Updated license for enterprise "${target?.name ?? body.enterpriseId}" — status ${license.status}, ${license.expiresAt ? `expires ${license.expiresAt.toISOString().slice(0, 10)}` : "no expiry"}, ${license.monthlyPrice !== null ? `${license.priceCurrency} ${license.monthlyPrice}/mo` : "no price set"}, max ${license.maxProperties} propert${license.maxProperties === 1 ? "y" : "ies"}`,
    });

    const { state, graceEndsAt } = computeLicenseState(license);
    return NextResponse.json({ ...license, state, graceEndsAt });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
