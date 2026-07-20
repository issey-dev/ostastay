import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const INCLUDE = {
  enterprise: { select: { id: true, name: true, slug: true } },
  requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

// Osta users see their own outgoing requests; ordinary enterprise users see requests
// targeting their own enterprise. Neither can see the other's.
export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    const grants = ctx.isInternal
      ? await prisma.supportAccessGrant.findMany({
          where: { requestedByUserId: ctx.userId },
          include: INCLUDE,
          orderBy: { requestedAt: "desc" },
        })
      : await prisma.supportAccessGrant.findMany({
          where: { enterpriseId: ctx.homeEnterpriseId },
          include: INCLUDE,
          orderBy: { requestedAt: "desc" },
        });

    return NextResponse.json(grants);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Only an Osta user requests access — the target enterprise's own admin must approve it.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can request support access");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const body = await request.json();
    if (!body.enterpriseId) {
      return NextResponse.json({ error: "enterpriseId is required" }, { status: 400 });
    }

    const target = await prisma.enterprise.findUnique({ where: { id: body.enterpriseId } });
    if (!target || target.type !== "STANDARD") {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    const grant = await prisma.supportAccessGrant.create({
      data: {
        enterpriseId: body.enterpriseId,
        requestedByUserId: ctx.userId,
        reason: body.reason ?? null,
        status: "PENDING",
      },
      include: INCLUDE,
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "SUPPORT_REQUEST",
      entityType: "SupportAccessGrant",
      entityId: grant.id,
      description: `Requested support access to ${target.name}${body.reason ? ` — ${body.reason}` : ""}`,
    });

    return NextResponse.json(grant, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
