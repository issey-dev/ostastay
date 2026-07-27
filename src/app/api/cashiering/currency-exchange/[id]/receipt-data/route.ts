import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
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
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    if (!settings) {
      settings = {
        id: "default",
        enterpriseId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        cashierDefaultFloat: 300,
        exchangeFromCurrency: "USD",
        exchangeToCurrency: "MVR",
        systemDate: new Date(),
        defaultAccommodationChargeCodeId: null,
        cityLedgerPaymentMethodId: null,
        commissionChargeCodeId: null,
        invoiceBrandName: "Cozy Guest House",
        invoiceLogoUrl: "",
        invoiceBrandColor: DEFAULT_INVOICE_BRAND_COLOR,
        invoiceFontFamily: "Geist",
        invoiceTaxId: "",
        invoicePhone: "",
        invoiceEmail: "",
        invoiceAddress: "",
        invoiceHeaderText: "",
        invoiceFooterText: "Thank you for staying with us!",
        invoicePaymentTerms: "Payment is due immediately upon check-out.",
        invoicePaymentAccountName: null,
        invoicePaymentAccountNumber: null,
        invoicePaymentIban: null,
        invoicePaymentBankInfo: null,
        receiptFooterText: null,
        receiptTerms: null,
        statementFooterText: null,
        statementTerms: null,
        confirmationLetterMessage: null,
        registrationCardEnabled: true,
        registrationCardMessage: null,
        registrationCardTerms: null,
        greenTaxEnabled: true,
        greenTaxAdultAmount: 12.00,
        greenTaxChildAmount: 6.00,
        greenTaxExemptAge: 2,
        tgstEnabled: true,
        tgstRate: 17.00,
        serviceChargeEnabled: true,
        serviceChargeRate: 10.00,
        smtpHost: null,
        smtpPort: null,
        smtpUsername: null,
        smtpPassword: null,
        smtpFromAddress: null,
        smtpUseTls: true,
        sftpHost: null,
        sftpPort: null,
        sftpUsername: null,
        sftpPassword: null,
        sftpRemotePath: null,
        updatedAt: new Date()
      };
    }

    return NextResponse.json({
      exchange,
      settings
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
