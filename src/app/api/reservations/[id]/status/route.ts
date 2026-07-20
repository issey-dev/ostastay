import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { findTypeAvailabilityConflicts } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";

// The reservation lifecycle is a guarded state machine, not a free-text field.
// Check-in and check-out have their own dedicated routes (which validate room
// assignment, settle balances, and finalize debtor invoices) — this route only
// handles the transitions that don't move money on their own. Jumping straight to
// CHECKED_OUT here would bypass the entire settlement flow, so it's never allowed.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  RESERVED: ["CANCELLED", "NO_SHOW"],
  IN_HOUSE: [], // must go through /check-out
  NO_SHOW: ["RESERVED", "CANCELLED"], // late arrival / cleanup
  CANCELLED: ["RESERVED"], // reinstate
  CHECKED_OUT: [], // terminal
};

const TRANSITION_HINTS: Record<string, string> = {
  IN_HOUSE: "Use the Check-In action instead of setting the status directly.",
  CHECKED_OUT: "Use the Check-Out action instead of setting the status directly — it settles the folio balance.",
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: "Missing status field" }, { status: 400 });
    }

    const validStatuses = Object.values(ReservationStatus);
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: {
        assignments: true,
        folios: { include: { lineItems: true, payments: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    if (body.status === existing.status) {
      return NextResponse.json(existing); // no-op
    }

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.status)) {
      const hint = TRANSITION_HINTS[body.status];
      return NextResponse.json(
        {
          error: `Cannot change a ${existing.status} reservation to ${body.status}.${hint ? ` ${hint}` : ""}`,
        },
        { status: 400 }
      );
    }

    // Cancelling is only allowed once the folios net to ~zero, so cancellation can
    // never silently orphan real money in either direction. This deliberately
    // supports the cancellation-fee workflow with existing primitives: post a fee
    // (e.g. a CXL charge code) via the Folio Panel, take payment for it, then cancel.
    // An unrefunded deposit (negative balance) equally blocks until refunded.
    // (NO_SHOW is deliberately not blocked the same way: a no-show with an unsettled
    // folio is a real situation front office resolves afterwards, and its folio
    // stays open and visible.)
    if (body.status === "CANCELLED") {
      let charges = 0;
      let payments = 0;
      for (const f of existing.folios) {
        for (const li of f.lineItems) {
          if (!li.isVoid) charges += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
        }
        for (const p of f.payments) {
          payments += p.isRefund ? -p.amount : p.amount;
        }
      }
      const balance = charges - payments;
      if (Math.abs(balance) > 0.01) {
        return NextResponse.json(
          {
            error:
              "Cannot cancel: this reservation's folio has an unsettled balance. Settle or void the charges (and refund any deposit) first.",
            balance,
          },
          { status: 400 }
        );
      }
    }

    // Reinstating (CANCELLED/NO_SHOW → RESERVED) puts the reservation back into
    // sellable inventory — the rooms may have been resold in the meantime, so it must
    // pass the same availability guard as a fresh booking.
    if (body.status === "RESERVED") {
      const conflicts = await findTypeAvailabilityConflicts({
        propertyId: existing.propertyId,
        segments: existing.assignments.map((a) => ({
          roomTypeId: a.roomTypeId,
          startDate: a.startDate,
          endDate: a.endDate,
        })),
        excludeReservationId: id,
      });
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: `Cannot reinstate — ${conflicts.join("; ")}` },
          { status: 409 }
        );
      }
    }

    const updatedReservation = await prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id },
        data: { status: body.status },
      });

      // A cancelled reservation's (clean, checked above) folios are closed so they
      // can't accumulate charges; reinstating reopens them.
      if (body.status === "CANCELLED") {
        await tx.folio.updateMany({
          where: { reservationId: id, isClosed: false },
          data: { isClosed: true },
        });
      } else if (body.status === "RESERVED") {
        await tx.folio.updateMany({
          where: { reservationId: id, isDebtorAccount: false },
          data: { isClosed: false },
        });
      }

      return updated;
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: body.status,
      entityType: "Reservation",
      entityId: id,
      description: `Reservation ${existing.confirmationNo}: ${existing.status} → ${body.status}`,
    });

    return NextResponse.json(updatedReservation);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
