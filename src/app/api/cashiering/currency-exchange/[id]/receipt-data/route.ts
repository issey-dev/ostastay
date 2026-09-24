import { NextResponse } from "next/server";
import { loadDocumentSettings } from "@/lib/document-settings";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";

const EXCHANGE_INCLUDE = {
  property: true,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    let exchange = await prisma.currencyExchange.findUnique({
      where: { id },
      include: EXCHANGE_INCLUDE
    });

    if (!exchange) {
      return NextResponse.json({ error: "Currency exchange not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, exchange.propertyId);

    // Assign a receipt number the first time this exchange's receipt is printed, via the
    // property's Sequence Manager counter (shared RECEIPT_NO series with Payment
    // receipts) — reprints reuse the stored number.
    if (!exchange.receiptNumber) {
      const nextValue = await allocateSequenceNumber(exchange.propertyId, "RECEIPT_NO");
      const receiptNumber = `RCT-${String(nextValue).padStart(5, "0")}`;
      exchange = await prisma.currencyExchange.update({
        where: { id: exchange.id },
        data: { receiptNumber },
        include: EXCHANGE_INCLUDE
      });
    }

    const enterpriseId = exchange.property.enterpriseId;
    const settings = await loadDocumentSettings(exchange.propertyId);

    return NextResponse.json({
      exchange,
      settings
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
