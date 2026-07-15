import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: folioId } = await params;
    const body = await request.json();

    if (!body.paymentMethodId || !body.shiftId || !body.amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({ where: { id: folioId } });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post payments to a closed folio" }, { status: 400 });
    }

    // Temporary: Handle mock shift for demo purposes
    let actualShiftId = body.shiftId;
    if (actualShiftId === "mock-shift-id") {
      let shift = await prisma.cashierShift.findFirst({
        where: { tenantId: "00000000-0000-0000-0000-000000000000" }
      });
      if (!shift) {
        shift = await prisma.cashierShift.create({
          data: {
            tenantId: "00000000-0000-0000-0000-000000000000",
            userId: "mock-user-id",
            openingFloat: 0
          }
        });
      }
      actualShiftId = shift.id;
    }

    const payment = await prisma.payment.create({
      data: {
        folioId,
        paymentMethodId: body.paymentMethodId,
        shiftId: actualShiftId,
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
    console.error("Failed to post payment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
