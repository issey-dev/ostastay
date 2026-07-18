import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const shiftId = searchParams.get("shiftId");
    const folioId = searchParams.get("folioId");

    if (!shiftId && !folioId) {
      return NextResponse.json({ error: "shiftId or folioId is required" }, { status: 400 });
    }

    if (shiftId) {
      const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Shift not found" }, { status: 404 });
      }
    }
    if (folioId) {
      const folio = await prisma.folio.findUnique({ where: { id: folioId }, include: { reservation: true } });
      if (!folio) {
        return NextResponse.json({ error: "Folio not found" }, { status: 404 });
      }
      await assertPropertyAccess(ctx, folio.reservation.propertyId);
    }

    const payments = await prisma.payment.findMany({
      where: {
        shiftId: shiftId ? shiftId : undefined,
        folioId: folioId ? folioId : undefined,
      },
      include: {
        paymentMethod: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(payments);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const body = await request.json();

    if (!body.folioId || !body.paymentMethodId || !body.shiftId || !body.amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const folio = await prisma.folio.findUnique({ where: { id: body.folioId }, include: { reservation: true } });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.reservation.propertyId);
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post payments to a closed folio" }, { status: 400 });
    }

    const [paymentMethod, shift] = await Promise.all([
      prisma.paymentMethod.findUnique({ where: { id: body.paymentMethodId } }),
      prisma.cashierShift.findUnique({ where: { id: body.shiftId } }),
    ]);
    if (!paymentMethod || paymentMethod.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    if (!shift || shift.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    const newPayment = await prisma.payment.create({
      data: {
        folioId: body.folioId,
        paymentMethodId: body.paymentMethodId,
        shiftId: body.shiftId,
        amount: parseFloat(body.amount),
        referenceNumber: body.referenceNumber,
        isRefund: !!body.isRefund,
      },
      include: {
        paymentMethod: true,
      }
    });

    return NextResponse.json(newPayment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
