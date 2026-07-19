import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

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
      },
    });

    // Every property gets a locked "Base Rate" plan at onboarding (see RatePlan.isLocked)
    // — the default rate for any room type/date when nothing custom is specified.
    // priority 999 keeps it sorted last in the Rate Plan Hierarchy table.
    await prisma.ratePlan.create({
      data: { propertyId: newProperty.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });

    return NextResponse.json(newProperty, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
