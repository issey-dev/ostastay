import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.chargeSubgroup.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge subgroup not found" }, { status: 404 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : existing.name;
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const wantsCode = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, "_") : existing.code;
    let chargeGroupId = existing.chargeGroupId;
    if (body.chargeGroupId && body.chargeGroupId !== existing.chargeGroupId) {
      const group = await prisma.chargeGroup.findUnique({ where: { id: body.chargeGroupId } });
      if (!group || group.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Charge group not found" }, { status: 404 });
      }
      chargeGroupId = group.id;
    }

    // A system subgroup's code is what the seeder and the legacy-category mapping key
    // off; moving it to a different group would silently re-bucket every code under it.
    if (existing.isSystem && (wantsCode !== existing.code || chargeGroupId !== existing.chargeGroupId)) {
      return NextResponse.json(
        { error: "This is a system subgroup — its code and parent group can't be changed. Rename it, or add your own subgroup instead." },
        { status: 400 }
      );
    }
    if (wantsCode !== existing.code) {
      const clash = await prisma.chargeSubgroup.findUnique({
        where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code: wantsCode } },
      });
      if (clash) return NextResponse.json({ error: `A subgroup with the code ${wantsCode} already exists` }, { status: 400 });
    }

    const subgroup = await prisma.$transaction(async (tx) => {
      const updated = await tx.chargeSubgroup.update({
        where: { id },
        data: {
          code: wantsCode,
          name,
          chargeGroupId,
          sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : existing.sortOrder,
        },
      });
      // Moving a subgroup between groups re-buckets everything under it, which now
      // needs no second write: the bucket is read through the group, and the deprecated
      // `category` mirror that used to shadow it is gone.
      return updated;
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "ChargeSubgroup",
      entityId: subgroup.id,
      description: `Updated charge subgroup ${subgroup.code} — ${subgroup.name}`,
    });

    return NextResponse.json(subgroup);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.chargeSubgroup.findUnique({
      where: { id },
      include: { _count: { select: { chargeCodes: true } } },
    });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge subgroup not found" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json({ error: "System subgroups can't be deleted." }, { status: 400 });
    }
    if (existing._count.chargeCodes > 0) {
      return NextResponse.json(
        { error: `This subgroup still holds ${existing._count.chargeCodes} charge code${existing._count.chargeCodes === 1 ? "" : "s"}. Move them first.` },
        { status: 400 }
      );
    }

    await prisma.chargeSubgroup.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "ChargeSubgroup",
      entityId: id,
      description: `Deleted charge subgroup ${existing.code} — ${existing.name}`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
