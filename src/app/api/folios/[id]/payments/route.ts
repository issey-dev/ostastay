import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";

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
        amount,
        referenceNumber: body.referenceNumber || null,
        isRefund: body.isRefund || false,
      },
      include: {
        paymentMethod: true,
        shift: true
      }
    });

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
