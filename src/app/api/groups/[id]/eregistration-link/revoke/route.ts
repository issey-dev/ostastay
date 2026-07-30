import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;

    const group = await prisma.groupBlock.findUnique({ where: { id }, select: { propertyId: true, code: true } });
    if (!group) return NextResponse.json({ error: "Group block not found" }, { status: 404 });
    await assertPropertyAccess(ctx, group.propertyId);

    const result = await prisma.eRegistrationLink.updateMany({
      where: { groupBlockId: id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "There is no active eRegistration link to revoke." }, { status: 400 });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_GROUP_LINK_REVOKE",
      entityType: "GroupBlock",
      entityId: id,
      description: `Revoked the group eRegistration link for ${group.code}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
