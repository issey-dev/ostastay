import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { ensureChargeTree, ensureFeeRules } from "@/lib/posting/ensure-charge-tree";

// Osta-side property onboarding — the platform admin creates a property FOR a customer
// enterprise (app-owner requirement, 2026-08-03: enterprise, properties, and the initial
// user should all be creatable from the Osta console).
//
// Created ACTIVE with the reviewer stamped, not PENDING: the approval queue exists so
// Osta can vet what TENANTS submit, and Osta approving its own submission would be a
// ceremony with no reviewer. The tenant-side route (/api/properties) keeps its PENDING
// flow unchanged.
//
// Deliberately a sibling of /api/osta/properties (the cross-tenant list) rather than a
// POST on it — the list route's GET semantics (status filtering for the approval queue)
// and this creation flow share nothing but a noun.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can create properties for enterprises");
    }
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json().catch(() => null);
    const enterpriseId = typeof body?.enterpriseId === "string" ? body.enterpriseId : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const legalName = typeof body?.legalName === "string" ? body.legalName.trim() : "";
    const defaultCurrency = typeof body?.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : "";
    const timeZone = typeof body?.timeZone === "string" ? body.timeZone.trim() : "";
    const checkInTime = typeof body?.checkInTime === "string" && body.checkInTime.trim() ? body.checkInTime.trim() : "14:00";
    const checkOutTime = typeof body?.checkOutTime === "string" && body.checkOutTime.trim() ? body.checkOutTime.trim() : "11:00";

    if (!enterpriseId) return NextResponse.json({ error: "An enterprise is required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "A property name is required" }, { status: 400 });
    if (!code) return NextResponse.json({ error: "A property code is required" }, { status: 400 });
    if (!legalName) return NextResponse.json({ error: "A legal name is required" }, { status: 400 });
    if (!/^[A-Z]{3}$/.test(defaultCurrency)) {
      return NextResponse.json({ error: "Currency must be a 3-letter code (e.g. USD, MVR)" }, { status: 400 });
    }
    if (!timeZone) return NextResponse.json({ error: "A time zone is required (e.g. Indian/Maldives)" }, { status: 400 });

    const enterprise = await prisma.enterprise.findUnique({ where: { id: enterpriseId } });
    if (!enterprise || enterprise.type !== "STANDARD") {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    // The same license gate the tenant-side route enforces — being the platform does not
    // bypass the plan; raise maxProperties in Licensing first if the plan is full.
    const license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId } });
    const maxProperties = license?.maxProperties ?? 1;
    const existingCount = await prisma.property.count({ where: { enterpriseId } });
    if (existingCount >= maxProperties) {
      return NextResponse.json(
        { error: `This enterprise's plan allows up to ${maxProperties} propert${maxProperties === 1 ? "y" : "ies"} — raise the limit in Licensing first.` },
        { status: 403 }
      );
    }

    // Property codes are globally unique (they prefix document sequences); a friendly
    // 409 beats a raw P2002.
    if (await prisma.property.findUnique({ where: { code } })) {
      return NextResponse.json({ error: `Property code "${code}" is already in use` }, { status: 409 });
    }

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name,
        code,
        legalName,
        defaultCurrency,
        timeZone,
        checkInTime,
        checkOutTime,
        status: "ACTIVE",
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
      },
    });

    // Identical provisioning to the tenant-side route — a property onboarded from the
    // Osta console must not be missing the furniture Night Audit depends on.
    await prisma.ratePlan.create({
      data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });
    await ensureChargeTree(prisma, enterpriseId);
    await ensureFeeRules(prisma, enterpriseId);

    const description = `Created property "${property.name}" (${property.code}) — onboarded by Osta platform admin`;
    await logActivity({ ctx, module: "CONTROLS", action: "CREATE", entityType: "Property", entityId: property.id, description });
    await logActivity({ ctx, module: "CONTROLS", action: "CREATE", entityType: "Property", entityId: property.id, description, targetEnterpriseId: enterpriseId });

    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
