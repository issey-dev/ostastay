import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    // 1. Fetch Folio details with relations
    const folio = await prisma.folio.findUnique({
      where: { id },
      include: {
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
            contacts: true
          }
        },
        reservation: {
          include: {
            property: true,
            primaryGuest: {
              include: {
                contacts: true
              }
            },
            assignments: {
              include: {
                room: true,
                roomType: true
              },
              orderBy: {
                startDate: 'asc'
              }
            }
          }
        }
      }
    });

    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.reservation.propertyId);

    // 2. Fetch Enterprise settings for invoice branding, derived from the folio's own
    // reservation → property → enterprise (not a hardcoded constant).
    const enterpriseId = folio.reservation.property.enterpriseId;
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
      settings
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
