import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { REPORT_BUCKETS } from "@/lib/posting/charge-tree";
import { ensureChargeTree } from "@/lib/posting/ensure-charge-tree";

// Level 1 of the charge hierarchy (Hub › property › Charge Codes). Per property since
// 2026-09-23: GET takes ?propertyId=, POST a body propertyId. A group owns
// the reporting bucket every revenue report sums into, so the canonical seven are
// system-managed: their bucket and code can't be edited away and they can't be deleted.
// A property may still add its own group on top when it needs a bucket-level split the
// canonical tree doesn't give it.

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "view");

    // Lazy seed: a property with no chart at all would leave every picker on the Charge
    // Codes page empty. Idempotent and property-scoped — the same call onboarding makes.
    const count = await prisma.chargeGroup.count({ where: { propertyId } });
    if (count === 0) {
      await prisma.$transaction((tx) => ensureChargeTree(tx, { propertyId }), { timeout: 30_000 });
    }

    const groups = await prisma.chargeGroup.findMany({
      where: { propertyId },
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
    const body = await request.json();
    const propertyId: string | undefined = body.propertyId;
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "create");

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
      where: { propertyId_code: { propertyId, code } },
    });
    if (clash) {
      return NextResponse.json({ error: `A charge group with the code ${code} already exists` }, { status: 400 });
    }

    const group = await prisma.chargeGroup.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        propertyId,
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
