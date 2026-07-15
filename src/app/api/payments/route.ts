import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const shiftId = searchParams.get("shiftId");
  const folioId = searchParams.get("folioId");

  try {
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
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.folioId || !body.paymentMethodId || !body.shiftId || !body.amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
    return NextResponse.json({ error: "Failed to post payment" }, { status: 500 });
  }
}
