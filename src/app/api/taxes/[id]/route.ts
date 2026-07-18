import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const existing = await prisma.taxProfile.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
    }

    // Prepare update data
    const updateData: any = {
      name: body.name,
      description: body.description,
    };

    // If ratePercent and effectiveFrom are provided, we should add a new rate
    // assuming it represents a new effective rate entry
    if (body.ratePercent !== undefined && body.effectiveFrom) {
      updateData.rates = {
        create: {
          ratePercent: parseFloat(body.ratePercent),
          effectiveFrom: new Date(body.effectiveFrom),
        },
      };
    }

    const updatedTaxProfile = await prisma.taxProfile.update({
      where: { id },
      data: updateData,
      include: {
        rates: {
          orderBy: { effectiveFrom: "desc" },
        },
      },
    });

    return NextResponse.json(updatedTaxProfile);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.taxProfile.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
    }

    await prisma.taxProfile.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
