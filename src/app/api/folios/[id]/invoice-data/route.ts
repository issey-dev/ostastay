import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    // 2. Fetch Tenant settings for invoice branding
    let settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: DEMO_TENANT_ID }
    });

    // Default settings fallback
    if (!settings) {
      settings = {
        id: "default",
        tenantId: DEMO_TENANT_ID,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        systemDate: new Date(),
        invoiceBrandName: "Cozy Guest House",
        invoiceLogoUrl: "",
        invoiceBrandColor: "#4f46e5",
        invoiceFontFamily: "Geist",
        invoiceTaxId: "",
        invoicePhone: "",
        invoiceEmail: "",
        invoiceAddress: "",
        invoiceHeaderText: "",
        invoiceFooterText: "Thank you for staying with us!",
        invoicePaymentTerms: "Payment is due immediately upon check-out.",
        greenTaxEnabled: true,
        greenTaxAmount: 6.00,
        greenTaxExemptAge: 2,
        tgstEnabled: true,
        tgstRate: 16.00,
        serviceChargeEnabled: true,
        serviceChargeRate: 10.00,
        pricesIncludeTaxes: true,
        updatedAt: new Date()
      };
    }

    return NextResponse.json({
      folio,
      settings
    });

  } catch (error) {
    console.error("Failed to fetch invoice data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
