import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

// Which negotiated Rate Plans (RatePlan.isNegotiated) this Company/Travel Agent
// profile has access to, and the optional per-plan commission % owed to them — see
// RatePlanAgentAccess. Whole-set replace on PUT, same convention as preferences (no
// per-row ordering/primary concept to lose). GET also returns every negotiated plan
// across the enterprise's properties so the picker UI doesn't need a second round-trip.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const [available, linked] = await Promise.all([
      prisma.ratePlan.findMany({
        where: { isNegotiated: true, property: { enterpriseId: ctx.enterpriseId } },
        select: { id: true, name: true, code: true, propertyId: true, property: { select: { name: true } } },
        orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
      }),
      prisma.ratePlanAgentAccess.findMany({ where: { upid }, select: { ratePlanId: true, commissionRate: true } }),
    ]);

    return NextResponse.json({
      available: available.map((rp) => ({
        id: rp.id,
        name: rp.name,
        code: rp.code,
        propertyId: rp.propertyId,
        propertyName: rp.property.name,
      })),
      links: linked.map((l) => ({ ratePlanId: l.ratePlanId, commissionRate: l.commissionRate })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const body = await request.json();
    if (!Array.isArray(body.links)) {
      return NextResponse.json({ error: "links[] is required" }, { status: 400 });
    }
    const links = body.links as { ratePlanId: string; commissionRate?: number | null }[];
    const ratePlanIds = [...new Set(links.map((l) => l.ratePlanId))];

    if (ratePlanIds.length > 0) {
      const validCount = await prisma.ratePlan.count({
        where: { id: { in: ratePlanIds }, isNegotiated: true, property: { enterpriseId: ctx.enterpriseId } },
      });
      if (validCount !== ratePlanIds.length) {
        return NextResponse.json({ error: "One or more rate plans are not negotiated plans in this enterprise" }, { status: 400 });
      }
    }
    for (const link of links) {
      if (link.commissionRate != null && (typeof link.commissionRate !== "number" || link.commissionRate < 0 || link.commissionRate > 100)) {
        return NextResponse.json({ error: "commissionRate must be a number between 0 and 100" }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.ratePlanAgentAccess.deleteMany({ where: { upid } }),
      ...(ratePlanIds.length > 0
        ? [prisma.ratePlanAgentAccess.createMany({
            data: links.map((l) => ({ upid, ratePlanId: l.ratePlanId, commissionRate: l.commissionRate ?? null })),
          })]
        : []),
    ]);

    return NextResponse.json({ links });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
