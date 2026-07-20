import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

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

    if (body.rates !== undefined) {
      if (!Array.isArray(body.rates) || body.rates.length === 0) {
        return NextResponse.json({ error: "At least one tax line is required" }, { status: 400 });
      }
      if (body.rates.some((r: any) => !r.name || r.ratePercent === undefined || r.ratePercent === null)) {
        return NextResponse.json({ error: "Every tax line needs a name and a rate" }, { status: 400 });
      }
    }

    // Prepare update data
    const updateData: any = {
      name: body.name,
      description: body.description,
    };

    // A profile's lines are edited as a whole set — simpler than reconciling
    // per-line history, and matches how the UI presents them (the full current list,
    // not one rate plus a change log). Replaces every line with the submitted set.
    if (body.rates !== undefined) {
      const now = new Date();
      updateData.rates = {
        deleteMany: {},
        create: body.rates.map((r: any, index: number) => ({
          name: r.name,
          ratePercent: parseFloat(r.ratePercent),
          calculateOn: r.calculateOn === "COMPOUND" ? "COMPOUND" : "BASE",
          order: index,
          effectiveFrom: now,
        })),
      };
    }

    const updatedTaxProfile = await prisma.taxProfile.update({
      where: { id },
      data: updateData,
      include: {
        rates: {
          orderBy: { order: "asc" },
        },
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "TaxProfile",
      entityId: updatedTaxProfile.id,
      description: `Updated tax profile "${updatedTaxProfile.name}"`,
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

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "TaxProfile",
      entityId: id,
      description: `Deleted tax profile "${existing.name}"`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
