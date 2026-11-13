import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

// The Slots section of a Source profile (Agent Portal plan A-25): its blocks with period,
// rooms held, booked (tentative / confirmed), status and cutoff.
export async function GET(_request: Request, { params }: { params: Promise<{ upid: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "view");
    requirePermission(ctx, "GROUP_BLOCKS", "view");
    const { upid } = await params;
    const p = await prisma.profile.findUnique({ where: { upid }, select: { enterpriseId: true } });
    if (!p || p.enterpriseId !== ctx.enterpriseId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    const blocks = await prisma.groupBlock.findMany({
      where: { sourceProfileId: upid, ...(ctx.scope === "PROPERTY" && ctx.propertyId ? { propertyId: ctx.propertyId } : {}) },
      include: {
        property: { select: { name: true, code: true } },
        reservations: { where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { status: true } },
      },
      orderBy: { startDate: "desc" },
      take: 200,
    });
    return NextResponse.json(
      blocks.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        property: b.property.name,
        status: b.status,
        startDate: b.startDate,
        endDate: b.endDate,
        cutoffDate: b.cutoffDate,
        held: b.totalRoomsHeld,
        tentative: b.reservations.filter((r) => r.status === "TENTATIVE").length,
        confirmed: b.reservations.filter((r) => r.status !== "TENTATIVE").length,
      }))
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
