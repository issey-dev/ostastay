import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true, confirmationNo: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const result = await prisma.eRegistrationLink.updateMany({
      where: { reservationId: id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "There is no active eRegistration link to revoke." }, { status: 400 });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_LINK_REVOKE",
      entityType: "Reservation",
      entityId: id,
      description: `Revoked the eRegistration link for ${reservation.confirmationNo}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
