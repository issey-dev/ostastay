import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const { id: folioId } = await params;
    const body = await request.json();

    if (!body.paymentMethodId || !body.amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { reservation: true }
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.reservation.propertyId);
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post payments to a closed folio" }, { status: 400 });
    }

    const paymentMethod = await prisma.paymentMethod.findUnique({ where: { id: body.paymentMethodId } });
    if (!paymentMethod || paymentMethod.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    // The client no longer picks a shift explicitly — payments always post against the
    // caller's own currently-open cashier shift, auto-opening one (0 float) if they
    // don't have one yet, rather than trusting a client-supplied shiftId.
    let shift = await prisma.cashierShift.findFirst({
      where: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, closedAt: null }
    });
    if (!shift) {
      shift = await prisma.cashierShift.create({
        data: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, openingFloat: 0 }
      });
    }

    const payment = await prisma.payment.create({
      data: {
        folioId,
        paymentMethodId: body.paymentMethodId,
        shiftId: shift.id,
        amount: parseFloat(body.amount),
        referenceNumber: body.referenceNumber || null,
        isRefund: body.isRefund || false,
      },
      include: {
        paymentMethod: true,
        shift: true
      }
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
