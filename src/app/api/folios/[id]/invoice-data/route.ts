import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";

const INVOICE_INCLUDE = {
  lineItems: {
    include: {
      chargeCode: true
    }
  },
  payments: {
    include: {
      paymentMethod: true
    }
  },
  payeeProfile: {
    include: {
      communications: true
    }
  },
  property: true,
  reservation: {
    include: {
      primaryGuest: {
        include: {
          communications: true
        }
      },
      assignments: {
        include: {
          room: true,
          roomType: true
        },
        orderBy: {
          startDate: 'asc' as const
        }
      }
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

    const url = new URL(request.url);
    const documentType: "tax" | "proforma" = url.searchParams.get("type") === "proforma" ? "proforma" : "tax";

    // 1. Fetch Folio details with relations
    let folio = await prisma.folio.findUnique({
      where: { id },
      include: INVOICE_INCLUDE
    });

    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    // Assign a document number the first time this document type is generated for this
    // folio, via the property's Sequence Manager counter — reprints reuse the stored
    // number instead of allocating a new one.
    const existingNumber = documentType === "tax" ? folio.taxInvoiceNumber : folio.proformaInvoiceNumber;
    if (!existingNumber) {
      const sequenceType = documentType === "tax" ? "TAX_INVOICE" : "PROFORMA_FOLIO";
      const nextValue = await allocateSequenceNumber(folio.propertyId, sequenceType);
      const prefix = documentType === "tax" ? "INV" : "PRO";
      const documentNumber = `${prefix}-${String(nextValue).padStart(5, "0")}`;
      folio = await prisma.folio.update({
        where: { id: folio.id },
        data: documentType === "tax" ? { taxInvoiceNumber: documentNumber } : { proformaInvoiceNumber: documentNumber },
        include: INVOICE_INCLUDE
      });
    }

    // 2. Fetch Enterprise settings for invoice branding, derived from the folio's own
    // property → enterprise (not a hardcoded constant) — works the same for a
    // reservation-backed folio or a walk-in one, since propertyId is always present.
    const enterpriseId = folio.property.enterpriseId;
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    // Default settings fallback
    if (!settings) {
      settings = {
        id: "default",
        enterpriseId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
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
      folio,
      settings,
      documentType
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
