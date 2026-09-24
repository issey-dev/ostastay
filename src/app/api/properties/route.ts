import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { goLiveDate } from "@/lib/business-date";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { chartModulesFor, ensureChargeTree, ensureFeeRules } from "@/lib/posting/ensure-charge-tree";
import { isValidCurrency, isValidTimeZone, normalizeCurrency } from "@/lib/properties/property-input";
import { PROFILE_MESSAGES } from "@/lib/properties/profile-schema";

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    // A single-property user sees their own property only — never another property's
    // details (HUB_SETUP_PLAN.md: other properties are not visible from a property's setup).
    const properties = await prisma.property.findMany({
      where: { enterpriseId: ctx.enterpriseId, ...(ctx.scope === "PROPERTY" && ctx.propertyId ? { id: ctx.propertyId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(properties);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = (await request.json().catch(() => null)) ?? {};
    const enterpriseId = ctx.enterpriseId;

    // Validated here, not just in the form — the fields used to fall straight through,
    // and a property created without currency / time zone silently became USD/UTC (every
    // business date then computed in the wrong zone). Name / legal name follow the
    // Property Information rules (profile-schema.ts); currency and zone the Osta console's
    // create route. A 400 carries fieldErrors so the form can put the message on the input.
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
    const defaultCurrency = normalizeCurrency(body.defaultCurrency);
    const timeZone = typeof body.timeZone === "string" ? body.timeZone.trim() : "";
    const fieldErrors: Record<string, string> = {};
    if (name.length < 2) fieldErrors.name = PROFILE_MESSAGES.name;
    // The form holds the code to PROPERTY_CODE (2–5 letters/digits); the API only insists
    // on one being there, as the Osta console route does (its codes run to 12 with dashes).
    if (code.length < 2) fieldErrors.code = "A short code of at least 2 characters is required.";
    if (legalName.length < 2) fieldErrors.legalName = PROFILE_MESSAGES.legalName;
    if (!isValidCurrency(defaultCurrency)) fieldErrors.defaultCurrency = "Currency must be a 3-letter code (e.g. USD, MVR).";
    if (!isValidTimeZone(timeZone)) fieldErrors.timeZone = "Pick a valid time zone (e.g. Indian/Maldives).";
    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json({ error: Object.values(fieldErrors)[0], fieldErrors }, { status: 400 });
    }

    const license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId } });
    const maxProperties = license?.maxProperties ?? 1;
    const existingCount = await prisma.property.count({ where: { enterpriseId } });
    if (existingCount >= maxProperties) {
      return NextResponse.json(
        { error: `This enterprise's plan allows up to ${maxProperties} propert${maxProperties === 1 ? "y" : "ies"}. Contact Osta to increase this limit.` },
        { status: 403 }
      );
    }

    // Property codes are globally unique (they prefix document sequences); a friendly
    // 409 the form can show beats a raw P2002 surfacing as a 500.
    if (await prisma.property.findUnique({ where: { code } })) {
      const message = `Short code "${code}" is already in use by another property. Choose a different code.`;
      return NextResponse.json({ error: message, fieldErrors: { code: message } }, { status: 409 });
    }

    const newProperty = await prisma.property.create({
      data: {
        enterpriseId,
        name,
        code,
        legalName,
        defaultCurrency,
        timeZone,
        checkInTime: body.checkInTime,
        checkOutTime: body.checkOutTime,
        // logoUrl is set only by uploading (POST /api/properties/[id]/logo).
        taxId: body.taxId,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
        // Hard gate: locked out of real use (see assertPropertyAccess in
        // src/lib/scope.ts) until an Osta admin approves it from /osta/properties.
        status: "PENDING",
        // The operator's chosen GO-LIVE DATE becomes the initial business date; today
        // if they didn't pick one. Leaving it null (the old behaviour) meant the booking
        // form had nothing to default Arrival to — and a walk-in, whose Arrival is
        // locked to the business date, could not be booked at all. Night Audit rolls it
        // forward from here.
        businessDate: goLiveDate(body.goLiveDate),
      },
    });

    // Every property gets a locked "Base Rate" plan at onboarding (see RatePlan.isLocked)
    // — the default rate for any room type/date when nothing custom is specified.
    // priority 999 keeps it sorted last in the Rate Plan Hierarchy table.
    await prisma.ratePlan.create({
      data: { propertyId: newProperty.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });

    // ...and the property gets its OWN chart of accounts (per property since 2026-09-23):
    // the canonical groups and ONLY the system codes (accommodation, fees, tax, payments,
    // commission, system — owner, 2026-09-24) with the ROOM -> Green Tax generate. Its
    // revenue codes and their numbering are the owner's to create. Without the system
    // codes it couldn't run Night Audit at all.
    await ensureChargeTree(prisma, { propertyId: newProperty.id }, await chartModulesFor(prisma, enterpriseId, body));
    // ...and its Deposit / Cancellation / No-Show rules, each already linked to its own
    // charge code. Seeded inactive at zero — the wiring is provisioned, the policy stays
    // the owner's (Hub › the property › Finance).
    await ensureFeeRules(prisma, { propertyId: newProperty.id });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Property",
      entityId: newProperty.id,
      description: `Created property "${newProperty.name}" (${newProperty.code})`,
    });

    return NextResponse.json(newProperty, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
