import { NextResponse } from "next/server";
import { resolvePaymentChargeCodeId } from "@/lib/posting/post-payment";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";
import { CITY_LEDGER_METHOD_TYPE } from "@/lib/debtor-accounts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const { id: folioId } = await params;
    const body = await request.json();

    if (!body.paymentMethodId || body.amount === undefined || body.amount === null || body.amount === "") {
      return NextResponse.json({ error: "Payment method and amount are required" }, { status: 400 });
    }
    // Negative amounts are allowed — a refund can be recorded either as a positive
    // amount with isRefund:true or as a negative amount. Reject only zero/non-numeric.
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId }
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);
    // Debtor invoice folios are always closed (checkout closes every folio) but must
    // still accept payments after the fact — that's the whole point of an account
    // paying off an invoice later. Only block posting to an ordinary closed guest folio.
    if (folio.isClosed && !folio.isDebtorAccount) {
      return NextResponse.json({ error: "Cannot post payments to a closed folio" }, { status: 400 });
    }

    const paymentMethod = await prisma.paymentMethod.findUnique({ where: { id: body.paymentMethodId } });
    if (!paymentMethod || paymentMethod.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    // The client no longer picks a shift explicitly — payments always post against the
    // caller's own currently-open cashier shift for the folio's property, auto-opening
    // one (0 float) if they don't have one yet, rather than trusting a client shiftId.
    const shift = await ensureOpenShift(ctx, folio.propertyId);

    const payment = await prisma.payment.create({
      data: {
        folioId,
        paymentMethodId: body.paymentMethodId,
        shiftId: shift.id,
        // Every financial posting carries a charge code — a payment as much as a charge.
        chargeCodeId: await resolvePaymentChargeCodeId(prisma, body.paymentMethodId),
        amount,
        referenceNumber: body.referenceNumber || null,
        isRefund: body.isRefund || false,
      },
      include: {
        paymentMethod: true,
        shift: true
      }
    });

    // Settling with a City-Ledger method IS the act of transferring the bill to an
    // account — it replaces the old "Settlement: Direct / City Ledger" toggle, which
    // asked the desk to declare an intention up front and then diverge from what was
    // actually collected (owner rule, 2026-08-03). The folio is marked here so
    // check-out finalizes it into a debtor invoice; the payee defaults to the
    // reservation's travel agent / company when one isn't already set.
    if (!body.isRefund && paymentMethod.type === CITY_LEDGER_METHOD_TYPE && !folio.isDebtorAccount) {
      const reservation = folio.reservationId
        ? await prisma.reservation.findUnique({
            where: { id: folio.reservationId },
            select: { travelAgentId: true },
          })
        : null;
      await prisma.folio.update({
        where: { id: folioId },
        data: {
          settlementMethod: CITY_LEDGER_METHOD_TYPE,
          ...(folio.payeeProfileId || !reservation?.travelAgentId
            ? {}
            : { payeeProfileId: reservation.travelAgentId }),
        },
      });
    }

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: body.isRefund ? "REFUND" : "PAYMENT",
      entityType: "Payment",
      entityId: payment.id,
      description: `${body.isRefund ? "Refunded" : "Received"} $${amount.toFixed(2)} (${paymentMethod.name}) on folio #${folio.folioNumber}${body.referenceNumber ? ` ref ${body.referenceNumber}` : ""}`,
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
