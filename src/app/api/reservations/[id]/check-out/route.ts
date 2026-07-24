import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { computeFolioBalance, checkCreditLimitWarning } from "@/lib/debtor-accounts";
import { calculateFolioCommission } from "@/lib/commission";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const early = body?.early === true;

    // 1. Fetch reservation and folios with their line items and payments
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: { select: { businessDate: true } },
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

    // Date gate against the property's business date: a normal checkout is only
    // available once the guest is due out (business date >= checkout date). Leaving
    // ahead of the checkout date is an "early check-out" and must be flagged
    // explicitly (the UI surfaces a separate Early check-out action).
    const businessDate = resolveBusinessDate(reservation.property);
    const checkOutDay = toUtcMidnight(reservation.checkOutDate);
    if (businessDate < checkOutDay && !early) {
      return NextResponse.json(
        {
          error: "This reservation isn't due out until " + checkOutDay.toISOString().slice(0, 10) + ". Use Early check-out to depart ahead of the checkout date.",
          earlyCheckoutRequired: true,
        },
        { status: 400 }
      );
    }

    // 2. A City Ledger folio transfers to a debtor account at checkout — the moment (not
    // Night Audit, not folio creation) the invoice is actually born. That transfer is only
    // possible if the settling travel agent/company is an activated AR (credit) account.
    let creditAccount: { upid: string; firstName: string; lastName: string | null; companyName: string | null; creditLimit: number | null } | null = null;
    if (reservation.travelAgentId) {
      const travelAgent = await prisma.profile.findUnique({ where: { upid: reservation.travelAgentId } });
      if (travelAgent?.isCreditAccount) {
        creditAccount = travelAgent;
      }
    }

    const qualifiesForAccount = (folio: (typeof reservation.folios)[number]) =>
      folio.settlementMethod === "CITY_LEDGER" && creditAccount !== null;

    // City Ledger with no AR account behind it has nowhere for the invoice to go —
    // checkout is BLOCKED (owner rule), rather than silently falling back to guest-payable
    // and hiding the misconfiguration. Create the AR account, or change the settlement
    // method, before checking out.
    const cityLedgerFolios = reservation.folios.filter((f) => f.settlementMethod === "CITY_LEDGER");
    if (cityLedgerFolios.length > 0 && !creditAccount) {
      return NextResponse.json(
        {
          error:
            "Cannot check out: this reservation settles by City Ledger, but its travel agent / company has no AR (credit) account. Create an AR account for that profile, or change the folio's settlement method, before checking out.",
          cityLedgerNoAccount: true,
        },
        { status: 400 }
      );
    }

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
        error: `Cannot check out with an outstanding balance of ${balance.toFixed(2)}. Settle it first — collect payment from the guest, or if they won't pay, post it to your Service Recovery account (a payment method you manage) — then check out.`,
        balance
      }, { status: 400 });
    }

    // 3b. Travel Agent commission prerequisites, read once outside the transaction —
    // eligible only when a folio is actually finalizing to this account
    // (qualifiesForAccount), the account has a commission % linked to whichever rate
    // plan(s) earned the room revenue, and the enterprise has a Commission charge code
    // configured (EnterpriseSettings.commissionChargeCodeId). See src/lib/commission.ts.
    let commissionChargeCode: { id: string } | null = null;
    let rateLinks: { ratePlanId: string; commissionRate: number | null }[] = [];
    if (creditAccount && reservation.folios.some(qualifiesForAccount)) {
      const [settings, links] = await Promise.all([
        prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } }),
        prisma.ratePlanAgentAccess.findMany({ where: { upid: creditAccount.upid }, select: { ratePlanId: true, commissionRate: true } }),
      ]);
      rateLinks = links;
      if (settings?.commissionChargeCodeId) {
        commissionChargeCode = await prisma.chargeCode.findFirst({
          where: { id: settings.commissionChargeCodeId, enterpriseId: ctx.enterpriseId },
          select: { id: true },
        });
      }
    }

    // 4. Perform check-out in transaction
    const commissionsPosted: { folioId: string; amount: number; agentName: string }[] = [];
    await prisma.$transaction(async (tx) => {
      // Update Reservation Status. checkedOutAt records the actual departure time — its
      // calendar date is the checkout's business day, which reverse-check-out uses to
      // gate same-day-only reversal of a finalized City-Ledger (debtor) invoice.
      // On an EARLY departure the checkout date auto-moves to today (the real departure
      // date), so the stay length reflects reality and no future night is left billable.
      await tx.reservation.update({
        where: { id },
        data: {
          status: "CHECKED_OUT",
          checkedOutAt: new Date(),
          ...(early && businessDate < checkOutDay && { checkOutDate: businessDate }),
        }
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

          // Commission credit — posted the moment this folio actually becomes the
          // account's debtor invoice, on the room revenue it just settled, not before
          // (see src/lib/commission.ts for the per-rate-plan attribution math).
          if (qualifiesForAccount(folio) && commissionChargeCode) {
            const { amount: commissionAmount } = calculateFolioCommission(
              folio.lineItems, reservation.assignments, rateLinks
            );
            if (commissionAmount > 0.01) {
              const agentName = creditAccount!.companyName || `${creditAccount!.firstName} ${creditAccount!.lastName ?? ""}`.trim();
              await tx.folioLineItem.create({
                data: {
                  folioId: folio.id,
                  chargeCodeId: commissionChargeCode.id,
                  amount: -commissionAmount,
                  description: `Travel Agent Commission — ${agentName}`,
                  date: new Date(),
                },
              });
              commissionsPosted.push({ folioId: folio.id, amount: commissionAmount, agentName });
            }
          }
        }
      }
    });

    const finalizedInvoices = reservation.folios.filter((f) => qualifiesForAccount(f)).length;
    const totalCommission = commissionsPosted.reduce((sum, c) => sum + c.amount, 0);
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "CHECK_OUT",
      entityType: "Reservation",
      entityId: id,
      description: `Checked out ${reservation.confirmationNo}` +
        (finalizedInvoices > 0 ? ` — ${finalizedInvoices} folio${finalizedInvoices > 1 ? "s" : ""} finalized to City Ledger` : "") +
        (totalCommission > 0.01 ? ` — $${totalCommission.toFixed(2)} commission credited to ${commissionsPosted[0].agentName}` : ""),
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

    return NextResponse.json({ success: true, creditLimitWarning, commissionsPosted });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
