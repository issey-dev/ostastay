import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { REPORT_BUCKETS } from "@/lib/posting/charge-tree";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.chargeGroup.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge group not found" }, { status: 404 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : existing.name;
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    // A system group's code and reporting bucket are load-bearing: reports, the seeder
    // and the resolver all key off them. Its display name and sort order stay editable.
    const wantsCode = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, "_") : existing.code;
    const wantsBucket = typeof body.reportBucket === "string" ? body.reportBucket : existing.reportBucket;
    const wantsRevenue = body.isRevenue !== undefined ? !!body.isRevenue : existing.isRevenue;

    if (existing.isSystem && (wantsCode !== existing.code || wantsBucket !== existing.reportBucket || wantsRevenue !== existing.isRevenue)) {
      return NextResponse.json(
        { error: "This is a system charge group — its code and reporting bucket can't be changed. Rename it or add your own group instead." },
        { status: 400 }
      );
    }
    if (!REPORT_BUCKETS.includes(wantsBucket as (typeof REPORT_BUCKETS)[number])) {
      return NextResponse.json({ error: "Invalid reporting bucket" }, { status: 400 });
    }
    if (wantsCode !== existing.code) {
      const clash = await prisma.chargeGroup.findUnique({
        where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code: wantsCode } },
      });
      if (clash) return NextResponse.json({ error: `A charge group with the code ${wantsCode} already exists` }, { status: 400 });
    }

    const group = await prisma.chargeGroup.update({
      where: { id },
      data: {
        code: wantsCode,
        name,
        reportBucket: wantsBucket,
        isRevenue: wantsRevenue,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : existing.sortOrder,
      },
      include: { subgroups: true },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "ChargeGroup",
      entityId: group.id,
      description: `Updated charge group ${group.code} — ${group.name}`,
    });

    return NextResponse.json(group);
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
    const existing = await prisma.chargeGroup.findUnique({
      where: { id },
      include: { subgroups: { include: { _count: { select: { chargeCodes: true } } } } },
    });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge group not found" }, { status: 404 });
    }
    if (existing.isSystem) {
      return NextResponse.json({ error: "System charge groups can't be deleted." }, { status: 400 });
    }
    const codeCount = existing.subgroups.reduce((n, s) => n + s._count.chargeCodes, 0);
    if (codeCount > 0) {
      return NextResponse.json(
        { error: `This group still holds ${codeCount} charge code${codeCount === 1 ? "" : "s"}. Move them to another subgroup first.` },
        { status: 400 }
      );
    }

    await prisma.chargeGroup.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "ChargeGroup",
      entityId: id,
      description: `Deleted charge group ${existing.code} — ${existing.name}`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
