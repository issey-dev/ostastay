import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

// Data for the printable Registration Card (one card per guest). A registration card needs
// far more guest identity than the confirmation letter — full profile, communications,
// address, and identification documents — plus the assigned room, rate, and travel agent.
const PROFILE_INCLUDE = {
  communications: true,
  addresses: true,
  documents: { orderBy: { isPrimary: "desc" as const } },
} as const;

const REGISTRATION_CARD_INCLUDE = {
  primaryGuest: { include: PROFILE_INCLUDE },
  accompanyingGuests: { include: { profile: { include: PROFILE_INCLUDE } } },
  travelAgent: true,
  assignments: {
    include: { roomType: true, room: true, ratePlan: true },
    orderBy: { startDate: "asc" as const },
  },
  property: true,
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: REGISTRATION_CARD_INCLUDE,
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    // Signature captured during eRegistration, keyed by guest profile so the card page can
    // look it up per guest — most recent submission wins if a slot was reopened and
    // resubmitted. Kept as a separate query rather than a nested include since the slot
    // isn't part of REGISTRATION_CARD_INCLUDE's guest/profile shape.
    const signedSlots = await prisma.eRegistrationGuestSlot.findMany({
      where: { reservationId: id, signatureDataUrl: { not: null }, existingProfileId: { not: null } },
      orderBy: { submittedAt: "asc" },
      select: { existingProfileId: true, signatureDataUrl: true, submittedAt: true },
    });
    const eregistrationSignatures: Record<string, { dataUrl: string; submittedAt: Date | null }> = {};
    for (const s of signedSlots) {
      if (s.existingProfileId && s.signatureDataUrl) {
        eregistrationSignatures[s.existingProfileId] = { dataUrl: s.signatureDataUrl, submittedAt: s.submittedAt };
      }
    }

    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: reservation.property.enterpriseId },
    });
    if (!settings) {
      settings = {
        id: "default",
        enterpriseId: reservation.property.enterpriseId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        cashierDefaultFloat: 300,
        exchangeFromCurrency: "USD",
        exchangeToCurrency: "MVR",
        systemDate: new Date(),
        defaultAccommodationChargeCodeId: null,
        defaultGreenTaxChargeCodeId: null,
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
        defaultFolioStyle: "detailed",
        invoiceHeaderText: "",
        invoiceFooterText: "",
        invoicePaymentTerms: "",
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
        eRegistrationEnabled: true,
        spaOutletId: null,
        excursionOutletId: null,
        eRegistrationExpiryHours: 72,
        eRegistrationMessage: null,
        registrationCardMessage: null,
        registrationCardTerms: null,
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

    return NextResponse.json({ reservation, settings, eregistrationSignatures });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
