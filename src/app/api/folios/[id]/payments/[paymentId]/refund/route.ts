import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";
import { resolvePaymentChargeCodeId } from "@/lib/posting/post-payment";
import { CITY_LEDGER_METHOD_TYPE, activeCityLedgerPayments } from "@/lib/debtor-accounts";

// Reverses one posted payment. Nothing is edited or deleted: the original stays on the
// folio and a second row (isRefund, same method and amount, refundOfPaymentId → the
// original) takes it back out, carrying the reason. A payment can be reversed once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const { id: folioId, paymentId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to refund a payment" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { folio: true, paymentMethod: true, reversals: { select: { id: true } } },
    });
    if (!payment || payment.folioId !== folioId) {
      return NextResponse.json({ error: "Payment not found on this folio" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, payment.folio.propertyId);

    if (payment.isRefund) {
      return NextResponse.json({ error: "A refund can't be refunded again" }, { status: 400 });
    }
    if (payment.reversals.length > 0) {
      return NextResponse.json({ error: "This payment has already been refunded" }, { status: 400 });
    }
    if (payment.folio.isClosed && !payment.folio.isDebtorAccount) {
      return NextResponse.json({ error: "Cannot refund a payment on a closed folio" }, { status: 400 });
    }
    // On a finalized debtor invoice the City-Ledger payment IS the transfer that created
    // the receivable; taking it back is a debtor adjustment, not a desk refund.
    if (payment.folio.isDebtorAccount && payment.paymentMethod.type === CITY_LEDGER_METHOD_TYPE) {
      return NextResponse.json(
        { error: "This City Ledger payment transferred the bill to an account and can't be refunded from the folio." },
        { status: 400 }
      );
    }

    const shift = await ensureOpenShift(ctx, payment.folio.propertyId);
    const chargeCodeId = await resolvePaymentChargeCodeId(prisma, payment.paymentMethodId);

    const refund = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          folioId,
          paymentMethodId: payment.paymentMethodId,
          shiftId: shift.id,
          chargeCodeId,
          amount: payment.amount,
          isRefund: true,
          refundOfPaymentId: payment.id,
          refundReason: reason,
          referenceNumber: payment.referenceNumber,
        },
        include: { paymentMethod: true, shift: true },
      });

      // Taking back the City-Ledger payment un-stamps the folio, so check-out stops
      // asking for an AR account. Group masters and folios whose payee is an AR account
      // set CITY_LEDGER deliberately and keep it.
      if (payment.paymentMethod.type === CITY_LEDGER_METHOD_TYPE && payment.folio.settlementMethod === CITY_LEDGER_METHOD_TYPE && !payment.folio.groupBlockId) {
        const all = await tx.payment.findMany({ where: { folioId }, include: { paymentMethod: { select: { type: true } } } });
        const payee = payment.folio.payeeProfileId
          ? await tx.profile.findUnique({ where: { upid: payment.folio.payeeProfileId }, select: { isCreditAccount: true } })
          : null;
        if (activeCityLedgerPayments(all).length === 0 && !payee?.isCreditAccount) {
          await tx.folio.update({ where: { id: folioId }, data: { settlementMethod: "DIRECT" } });
        }
      }
      return created;
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "REFUND",
      entityType: "Payment",
      entityId: refund.id,
      description: `Refunded payment of $${payment.amount.toFixed(2)} (${payment.paymentMethod.name}) on folio #${payment.folio.folioNumber} — ${reason}`,
    });

    return NextResponse.json(refund, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
