import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { goLiveDate } from "@/lib/business-date";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { ensureChargeTree, ensureFeeRules } from "@/lib/posting/ensure-charge-tree";

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    const properties = await prisma.property.findMany({
      where: { enterpriseId: ctx.enterpriseId },
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

    const body = await request.json();
    const enterpriseId = ctx.enterpriseId;

    const license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId } });
    const maxProperties = license?.maxProperties ?? 1;
    const existingCount = await prisma.property.count({ where: { enterpriseId } });
    if (existingCount >= maxProperties) {
      return NextResponse.json(
        { error: `This enterprise's plan allows up to ${maxProperties} propert${maxProperties === 1 ? "y" : "ies"}. Contact Osta to increase this limit.` },
        { status: 403 }
      );
    }

    const newProperty = await prisma.property.create({
      data: {
        enterpriseId,
        name: body.name,
        code: body.code,
        legalName: body.legalName,
        defaultCurrency: body.defaultCurrency,
        timeZone: body.timeZone,
        checkInTime: body.checkInTime,
        checkOutTime: body.checkOutTime,
        logoUrl: body.logoUrl,
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

    // ...and the enterprise gets the canonical Charge Group/Subgroup/Code tree, incl.
    // the system ROOM/GTX/COMM codes and the ROOM -> Green Tax generate. Charge codes
    // are enterprise-scoped, so this is idempotent and a no-op for the second property
    // onboarded — but without it a freshly onboarded enterprise couldn't run Night
    // Audit at all (CHARGE_CODE_PLAN.md §1.3).
    await ensureChargeTree(prisma, enterpriseId);
    // ...and this property's Deposit / Cancellation / No-Show rules, each already linked
    // to its own charge code. Seeded inactive at zero — the wiring is provisioned, the
    // policy stays the owner's (Controls > Finance > Deposit & Fee Rules).
    await ensureFeeRules(prisma, enterpriseId);

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
