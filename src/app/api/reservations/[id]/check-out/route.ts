import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { computeFolioBalance, checkCreditLimitWarning } from "@/lib/debtor-accounts";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;

    // 1. Fetch reservation and folios with their line items and payments
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        assignments: { orderBy: { startDate: 'desc' } },
        folios: {
          include: {
            lineItems: true,
            payments: true
          }
        }
      }
    });

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Only in-house guests can be checked out" }, { status: 400 });
    }

    // 2. A City Ledger folio only transfers to a debtor account if the reservation's
    // travel agent is still a valid, activated credit account at checkout time — this
    // is the moment (not Night Audit, not folio creation) an invoice is actually born.
    // Falls back to treating the folio as guest-payable if the TA isn't valid, so a
    // misconfigured folio can't silently write off real revenue nobody will collect.
    let creditAccount: { upid: string; firstName: string; lastName: string | null; companyName: string | null; creditLimit: number | null } | null = null;
    if (reservation.travelAgentId) {
      const travelAgent = await prisma.profile.findUnique({ where: { upid: reservation.travelAgentId } });
      if (travelAgent?.isCreditAccount) {
        creditAccount = travelAgent;
      }
    }

    const qualifiesForAccount = (folio: (typeof reservation.folios)[number]) =>
      folio.settlementMethod === "CITY_LEDGER" && creditAccount !== null;

    // 3. Guest-payable balance excludes folios transferring to a debtor account —
    // those are the account's responsibility now, not the guest's, regardless of
    // their balance. Every other folio must still net to ~0, same rule as before.
    let totalCharges = 0;
    let totalPayments = 0;
    for (const folio of reservation.folios) {
      if (qualifiesForAccount(folio)) continue;
      for (const item of folio.lineItems) {
        if (!item.isVoid) {
          totalCharges += (item.amount + item.taxAmount + (item.serviceChargeAmount || 0));
        }
      }
      for (const payment of folio.payments) {
        totalPayments += payment.isRefund ? -payment.amount : payment.amount;
      }
    }

    const balance = totalCharges - totalPayments;
    if (Math.abs(balance) > 0.01) {
      return NextResponse.json({
        error: "Cannot check out with an outstanding balance",
        balance
      }, { status: 400 });
    }

    // 4. Perform check-out in transaction
    await prisma.$transaction(async (tx) => {
      // Update Reservation Status
      await tx.reservation.update({
        where: { id },
        data: { status: "CHECKED_OUT" }
      });

      // Update Room Status to DIRTY and queue the checkout clean so the room shows up
      // on the housekeeping board as actionable work, not just a status color.
      const activeRoomId = reservation.assignments[0]?.roomId;
      if (activeRoomId) {
        const room = await tx.room.update({
          where: { id: activeRoomId },
          data: { status: "DIRTY" },
          include: { roomType: { select: { housekeepingEnabled: true } } }
        });
        if (room.roomType.housekeepingEnabled) {
          await tx.housekeepingTask.create({
            data: {
              roomId: activeRoomId,
              taskType: "CHECKOUT",
              status: "PENDING",
              priority: "NORMAL",
              notes: "Departure clean (auto-created at check-out)",
              scheduledDate: new Date(),
            }
          });
        }
      }

      // Close all folios, finalizing any City-Ledger folio into a debtor invoice —
      // this is the one place isDebtorAccount ever flips true. payeeProfileId is set
      // defensively here too, in case settlement was toggled mid-stay without it.
      for (const folio of reservation.folios) {
        if (!folio.isClosed || qualifiesForAccount(folio)) {
          await tx.folio.update({
            where: { id: folio.id },
            data: {
              isClosed: true,
              ...(qualifiesForAccount(folio) && {
                isDebtorAccount: true,
                payeeProfileId: creditAccount!.upid,
              }),
            }
          });
        }
      }
    });

    const finalizedInvoices = reservation.folios.filter((f) => qualifiesForAccount(f)).length;
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "CHECK_OUT",
      entityType: "Reservation",
      entityId: id,
      description: `Checked out ${reservation.confirmationNo}` +
        (finalizedInvoices > 0 ? ` — ${finalizedInvoices} folio${finalizedInvoices > 1 ? "s" : ""} finalized to City Ledger` : ""),
    });

    // 5. Non-blocking credit-limit check against the account's full open balance at
    // this property (not just this one stay) — mirrors the Outlet capWarning pattern.
    let creditLimitWarning: { balance: number; creditLimit: number } | undefined;
    if (creditAccount) {
      const openInvoices = await prisma.folio.findMany({
        where: { propertyId: reservation.propertyId, payeeProfileId: creditAccount.upid, isDebtorAccount: true },
        include: { lineItems: true, payments: true },
      });
      const accountBalance = openInvoices.reduce((sum, f) => sum + computeFolioBalance(f.lineItems, f.payments), 0);
      creditLimitWarning = checkCreditLimitWarning(accountBalance, creditAccount.creditLimit);
    }

    return NextResponse.json({ success: true, creditLimitWarning });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
