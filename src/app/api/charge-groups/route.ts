import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { REPORT_BUCKETS } from "@/lib/posting/charge-tree";
import { ensureChargeTree } from "@/lib/posting/ensure-charge-tree";

// Level 1 of the charge hierarchy (Controls > Cashiering > Charge Groups). A group owns
// the reporting bucket every revenue report sums into, so the canonical seven are
// system-managed: their bucket and code can't be edited away and they can't be deleted.
// A property may still add its own group on top when it needs a bucket-level split the
// canonical tree doesn't give it.

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    // Lazy seed: an enterprise onboarded before the hierarchy existed has no groups at
    // all, and every picker in the Cashiering panel would be empty. Idempotent and
    // enterprise-scoped — the same call property onboarding makes. (Mirrors the
    // auto-create in api/tenant-settings' GET.)
    const count = await prisma.chargeGroup.count({ where: { enterpriseId: ctx.enterpriseId } });
    if (count === 0) {
      await prisma.$transaction((tx) => ensureChargeTree(tx, ctx.enterpriseId), { timeout: 30_000 });
    }

    const groups = await prisma.chargeGroup.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        subgroups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { _count: { select: { chargeCodes: true } } },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(groups);
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
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase().replace(/\s+/g, "_") : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const reportBucket = typeof body.reportBucket === "string" ? body.reportBucket : "";

    if (!code || !name || !reportBucket) {
      return NextResponse.json({ error: "Code, name and reporting bucket are required" }, { status: 400 });
    }
    if (!REPORT_BUCKETS.includes(reportBucket as (typeof REPORT_BUCKETS)[number])) {
      return NextResponse.json({ error: "Invalid reporting bucket" }, { status: 400 });
    }

    const clash = await prisma.chargeGroup.findUnique({
      where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code } },
    });
    if (clash) {
      return NextResponse.json({ error: `A charge group with the code ${code} already exists` }, { status: 400 });
    }

    const group = await prisma.chargeGroup.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        code,
        name,
        reportBucket,
        isRevenue: body.isRevenue !== undefined ? !!body.isRevenue : true,
        isSystem: false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      },
      include: { subgroups: true },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ChargeGroup",
      entityId: group.id,
      description: `Created charge group ${group.code} — ${group.name} (reports as ${group.reportBucket})`,
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
