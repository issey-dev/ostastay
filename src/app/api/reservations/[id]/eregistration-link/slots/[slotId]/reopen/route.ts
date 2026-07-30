import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Unlocks a SUBMITTED slot back to PENDING so the guest can correct/resubmit — the only
// way past the 409 that PATCH/finalize otherwise return on an already-finalized slot.
// Deliberately does NOT clear the previously submitted fields (they're overwritten on
// the next finalize) — an operator can still see what was there before if they navigate
// away without the guest resubmitting.
export async function POST(request: Request, { params }: { params: Promise<{ id: string; slotId: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id, slotId } = await params;

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true, confirmationNo: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: id } });
    if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });
    if (slot.status === "PENDING") {
      return NextResponse.json({ error: "This slot hasn't been submitted yet." }, { status: 400 });
    }

    const updated = await prisma.eRegistrationGuestSlot.update({
      where: { id: slotId },
      data: { status: "PENDING", submittedAt: null, submittedIp: null, submittedUserAgent: null },
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_REOPEN",
      entityType: "Reservation",
      entityId: id,
      description: `Reopened eRegistration slot ${slot.slotIndex + 1} for correction on ${reservation.confirmationNo}`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
