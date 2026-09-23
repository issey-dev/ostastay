import { NextResponse } from "next/server";
import { loadDocumentSettings } from "@/lib/document-settings";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";

const PAYMENT_INCLUDE = {
  paymentMethod: true,
  folio: {
    include: {
      property: true,
      payeeProfile: {
        include: {
          communications: true
        }
      },
      reservation: {
        include: {
          primaryGuest: {
            include: {
              communications: true
            }
          }
        }
      },
      lineItems: true,
      payments: true
    }
  }
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    let payment = await prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, payment.folio.propertyId);

    // Assign a receipt number the first time this payment's receipt is printed, via the
    // property's Sequence Manager counter — reprints reuse the stored number.
    if (!payment.receiptNumber) {
      const nextValue = await allocateSequenceNumber(payment.folio.propertyId, "RECEIPT_NO");
      const receiptNumber = `RCT-${String(nextValue).padStart(5, "0")}`;
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: { receiptNumber },
        include: PAYMENT_INCLUDE
      });
    }

    const enterpriseId = payment.folio.property.enterpriseId;
    const settings = await loadDocumentSettings(payment.folio.propertyId);

    return NextResponse.json({
      payment,
      settings
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
