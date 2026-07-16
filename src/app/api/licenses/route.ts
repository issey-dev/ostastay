import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";

// Non-Osta enterprises can view their own license (read-only, so an admin understands
// why e.g. property creation was rejected) but only Osta staff can change it — see the
// approved plan's Licensing section.
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

    return NextResponse.json({ ...license, propertyCount });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
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

    const license = await prisma.enterpriseLicense.upsert({
      where: { enterpriseId: body.enterpriseId },
      update: {
        tier: body.tier,
        maxProperties: body.maxProperties !== undefined ? parseInt(body.maxProperties) : undefined,
        notes: body.notes,
      },
      create: {
        enterpriseId: body.enterpriseId,
        tier: body.tier ?? "STANDARD",
        maxProperties: body.maxProperties !== undefined ? parseInt(body.maxProperties) : 1,
        notes: body.notes,
      },
    });

    return NextResponse.json(license);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
