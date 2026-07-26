import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Reverse a check-in — put an in-house guest back to RESERVED (a front-desk correction
// for someone checked in by mistake). Blocked once billing has begun: any posted (non-
// void) charge means money is on the folio and must be dealt with first (void it, or use
// reverse check-out after check-out). Pre-arrival deposits/payments don't block — they
// existed before arrival. Nothing is deleted; the folio (and any deposit on it) is left
// intact for the re-check-in.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { folios: { include: { lineItems: true } } },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Only an in-house reservation can have its check-in reversed." }, { status: 400 });
    }

    const hasPostedCharges = reservation.folios.some((f) => f.lineItems.some((li) => !li.isVoid));
    if (hasPostedCharges) {
      return NextResponse.json(
        { error: "Charges have already been posted to this stay — void them before reversing the check-in." },
        { status: 400 }
      );
    }

    // Conditional on the reservation still being IN_HOUSE, so two concurrent reversals
    // (or a reversal racing a re-check-in) can't both run — the loser matches 0 rows.
    const claimed = await prisma.reservation.updateMany({
      where: { id, status: "IN_HOUSE" },
      data: { status: "RESERVED", checkedInAt: null },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "This reservation is no longer in-house." }, { status: 409 });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "REVERSE_CHECK_IN",
      entityType: "Reservation",
      entityId: id,
      description: `Reversed check-in for ${reservation.confirmationNo} — returned to Reserved`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
