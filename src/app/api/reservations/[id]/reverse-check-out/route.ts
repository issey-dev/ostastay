import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";

// Reverse a check-out — put a departed guest back IN_HOUSE (a front-desk correction, or
// a guest who ends up staying after all). Undoes exactly what check-out did: reopens the
// folios, un-finalizes any City-Ledger invoice, reverses the Travel Agent commission,
// cancels the departure clean, and clears the departure timestamp.
//
// Nothing financial is ever deleted — the commission credit is VOIDed (flagged, not
// removed), payments and charges stay on the reopened folio intact. The only hard rule:
// a City-Ledger (debtor) invoice can only be reversed on the SAME business day it was
// finalized. Once Night Audit has closed that day the invoice belongs to a closed
// accounting period and must be handled as a debtor adjustment, not silently unwound.
// Guest-payable stays can be reversed on any later date (nothing is lost either way).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: { select: { businessDate: true, enterpriseId: true } },
        assignments: { orderBy: { startDate: "desc" } },
        folios: { include: { lineItems: true } },
      },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status !== "CHECKED_OUT") {
      return NextResponse.json({ error: "Only a checked-out reservation can have its check-out reversed." }, { status: 400 });
    }

    // Debtor (City Ledger) invoices are period-sensitive: reversible only on the same
    // business day they were finalized. checkedOutAt's calendar date is that day; if it's
    // missing (legacy checkout) we can't prove same-day and must block to be safe.
    const businessDate = resolveBusinessDate(reservation.property);
    const checkoutDay = reservation.checkedOutAt ? toUtcMidnight(reservation.checkedOutAt) : null;
    const isSameBusinessDay = checkoutDay !== null && checkoutDay.getTime() === businessDate.getTime();
    const debtorFolios = reservation.folios.filter((f) => f.isDebtorAccount);
    if (debtorFolios.length > 0 && !isSameBusinessDay) {
      return NextResponse.json(
        {
          error:
            "This stay was settled to a City Ledger (debtor) account. A debtor invoice can only be reversed on the same business day as checkout — that day has already closed. Handle it as a debtor adjustment instead.",
        },
        { status: 400 }
      );
    }

    // The Commission charge code identifies the credit line check-out posted to a debtor
    // folio (a negative amount). We VOID it on reversal rather than delete it.
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: reservation.property.enterpriseId },
      select: { commissionChargeCodeId: true },
    });
    const commissionChargeCodeId = settings?.commissionChargeCodeId ?? null;

    let voidedCommissions = 0;
    await prisma.$transaction(async (tx) => {
      // 1. Guest is back in-house; clear the departure timestamp.
      await tx.reservation.update({
        where: { id },
        data: { status: "IN_HOUSE", checkedOutAt: null },
      });

      // 2. Cancel the departure clean check-out queued: drop the still-pending CHECKOUT
      // task and undo the DIRTY flag it set (leave any non-DIRTY housekeeping state — an
      // OUT_OF_ORDER room, or one already re-cleaned — untouched).
      const activeRoomId = reservation.assignments[0]?.roomId;
      if (activeRoomId) {
        await tx.housekeepingTask.deleteMany({
          where: { roomId: activeRoomId, taskType: "CHECKOUT", status: "PENDING" },
        });
        await tx.room.updateMany({
          where: { id: activeRoomId, status: "DIRTY" },
          data: { status: "CLEAN" },
        });
      }

      // 3. Reopen every folio the check-out closed, and un-finalize any debtor invoice
      // back to guest-payable. Charges and payments stay put — only the closed/debtor
      // flags flip back.
      for (const folio of reservation.folios) {
        await tx.folio.update({
          where: { id: folio.id },
          data: {
            isClosed: false,
            ...(folio.isDebtorAccount && { isDebtorAccount: false, payeeProfileId: null }),
          },
        });

        // 4. Void the commission credit this folio earned at checkout (same business day,
        // guaranteed by the guard above for debtor folios).
        if (commissionChargeCodeId) {
          for (const li of folio.lineItems) {
            if (!li.isVoid && li.chargeCodeId === commissionChargeCodeId && li.amount < 0) {
              await tx.folioLineItem.update({ where: { id: li.id }, data: { isVoid: true } });
              voidedCommissions++;
            }
          }
        }
      }

      // 5. Audit trace on the reservation itself.
      const user = await tx.user.findUnique({ where: { id: ctx.userId } });
      await tx.reservationTrace.create({
        data: {
          reservationId: id,
          traceType: "FRONT_DESK",
          description:
            `Check-out reversed by ${user ? `${user.firstName} ${user.lastName}` : ctx.userId} — returned to In-House` +
            (debtorFolios.length > 0 ? `. ${debtorFolios.length} debtor invoice(s) un-finalized` : "") +
            (voidedCommissions > 0 ? `, ${voidedCommissions} commission credit(s) voided` : "") +
            (reason ? `. Reason: ${reason}` : ""),
          actionDate: new Date(),
          isResolved: true,
        },
      });
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "REVERSE_CHECK_OUT",
      entityType: "Reservation",
      entityId: id,
      description:
        `Reversed check-out for ${reservation.confirmationNo} — returned to In-House` +
        (debtorFolios.length > 0 ? ` (${debtorFolios.length} debtor invoice(s) un-finalized)` : "") +
        (reason ? ` — ${reason}` : ""),
    });

    return NextResponse.json({ success: true, debtorInvoicesReversed: debtorFolios.length, voidedCommissions });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
