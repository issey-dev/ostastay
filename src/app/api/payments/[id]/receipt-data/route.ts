import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";

const PAYMENT_INCLUDE = {
  paymentMethod: true,
  folio: {
    include: {
      property: true,
      payeeProfile: {
        include: {
          contacts: true
        }
      },
      reservation: {
        include: {
          primaryGuest: {
            include: {
              contacts: true
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
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    if (!settings) {
      settings = {
        id: "default",
        enterpriseId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        systemDate: new Date(),
        defaultAccommodationChargeCodeId: null,
        cityLedgerPaymentMethodId: null,
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
        confirmationLetterMessage: null,
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
      payment,
      settings
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
