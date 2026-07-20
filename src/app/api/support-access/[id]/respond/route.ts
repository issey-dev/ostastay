import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const GRANT_DEFAULT_DURATION_HOURS = 24;

// Only the target enterprise's own user (never Osta itself) can approve/deny a request
// for their enterprise — this is the "must be explicitly granted by the enterprise" rule.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (ctx.isInternal) {
      throw new ForbiddenError("Osta staff cannot approve their own access requests");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const grant = await prisma.supportAccessGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (grant.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this request");
    }
    if (grant.status !== "PENDING") {
      return NextResponse.json({ error: "This request has already been responded to" }, { status: 400 });
    }

    const body = await request.json();
    if (body.action !== "approve" && body.action !== "deny") {
      return NextResponse.json({ error: "action must be 'approve' or 'deny'" }, { status: 400 });
    }

    const durationHours = typeof body.durationHours === "number" && body.durationHours > 0
      ? body.durationHours
      : GRANT_DEFAULT_DURATION_HOURS;

    const updated = await prisma.supportAccessGrant.update({
      where: { id },
      data: {
        status: body.action === "approve" ? "APPROVED" : "DENIED",
        approvedByUserId: ctx.userId,
        respondedAt: new Date(),
        expiresAt: body.action === "approve" ? new Date(Date.now() + durationHours * 60 * 60 * 1000) : null,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: body.action === "approve" ? "SUPPORT_APPROVE" : "SUPPORT_DENY",
      entityType: "SupportAccessGrant",
      entityId: id,
      description: `${body.action === "approve" ? `Approved support access for ${durationHours}h` : "Denied support access request"}`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
