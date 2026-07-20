import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// The target enterprise can revoke an APPROVED grant early at any time — this takes
// effect immediately because requireSession() re-verifies the grant's status live on
// every request the acting support user makes (see src/lib/scope.ts).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (ctx.isInternal) {
      throw new ForbiddenError("Osta staff cannot revoke their own access grant");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const grant = await prisma.supportAccessGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    if (grant.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Not authorized for this grant");
    }
    if (grant.status !== "APPROVED") {
      return NextResponse.json({ error: "Only an approved grant can be revoked" }, { status: 400 });
    }

    const updated = await prisma.supportAccessGrant.update({
      where: { id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "SUPPORT_REVOKE",
      entityType: "SupportAccessGrant",
      entityId: id,
      description: "Revoked an active support access grant",
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
