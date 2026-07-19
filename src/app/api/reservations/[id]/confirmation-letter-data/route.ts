import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const CONFIRMATION_LETTER_INCLUDE = {
  primaryGuest: { include: { contacts: true } },
  accompanyingGuests: { include: { profile: { include: { contacts: true } } } },
  assignments: { include: { roomType: true }, orderBy: { startDate: "asc" as const } },
  property: true,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: CONFIRMATION_LETTER_INCLUDE,
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: reservation.property.enterpriseId },
    });
    if (!settings) {
      settings = {
        id: "default",
        enterpriseId: reservation.property.enterpriseId,
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
        invoiceFooterText: "",
        invoicePaymentTerms: "",
        invoicePaymentAccountName: null,
        invoicePaymentAccountNumber: null,
        invoicePaymentIban: null,
        invoicePaymentBankInfo: null,
        confirmationLetterMessage: null,
        greenTaxEnabled: true,
        greenTaxAdultAmount: 12.0,
        greenTaxChildAmount: 6.0,
        greenTaxExemptAge: 2,
        tgstEnabled: true,
        tgstRate: 17.0,
        serviceChargeEnabled: true,
        serviceChargeRate: 10.0,
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
        updatedAt: new Date(),
      };
    }

    return NextResponse.json({ reservation, settings });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
