import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { encryptSecret } from "@/lib/secret-crypto";
import { logActivity } from "@/lib/activity-log";
import { isFolioStyle } from "@/lib/folio-presentation";

// Stored SMTP/SFTP passwords are never sent to the browser — GET (and the PATCH
// response) replace a set password with this sentinel. The settings form round-trips
// the sentinel untouched, and PATCH treats it as "leave the stored value alone", so
// only an actually-typed new password ever overwrites. (Encryption at rest is a
// separate, still-open item — needs a key-management decision, see TODO.md.)
const SECRET_MASK = "********";

function redactSecrets<T extends { smtpPassword: string | null; sftpPassword: string | null }>(settings: T): T {
  return {
    ...settings,
    smtpPassword: settings.smtpPassword ? SECRET_MASK : settings.smtpPassword,
    sftpPassword: settings.sftpPassword ? SECRET_MASK : settings.sftpPassword,
  };
}

// Enterprise-wide settings (booking codes, invoice branding, Maldives tax defaults,
// app theme, SMTP/SFTP scaffold) — scoped to the session's own enterprise, never a
// client-supplied or "first enterprise found" shortcut.
export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "view");

    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: ctx.enterpriseId }
    });

    if (!settings) {
      // Auto-create default settings if none exist
      settings = await prisma.enterpriseSettings.create({
        data: {
          enterpriseId: ctx.enterpriseId,
          resConfirmPrefix: "",
          resConfirmLength: 6
        }
      });
    }

    return NextResponse.json(redactSecrets(settings));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    const enterpriseId = ctx.enterpriseId;

    // A round-tripped mask means "unchanged" — never store the literal sentinel.
    if (body.smtpPassword === SECRET_MASK) delete body.smtpPassword;
    if (body.sftpPassword === SECRET_MASK) delete body.sftpPassword;

    // Encrypt-at-rest: a real (non-empty, non-mask) password the client just entered is
    // encrypted here before it ever reaches the DB (S8). Empty string clears it (falls
    // through to null below); with no SECRETS_ENCRYPTION_KEY configured this is a no-op and
    // storage stays plaintext, as before. Both the update and create upsert branches read
    // body.*Password, so encrypting it once here covers both.
    if (body.smtpPassword) body.smtpPassword = encryptSecret(body.smtpPassword);
    if (body.sftpPassword) body.sftpPassword = encryptSecret(body.sftpPassword);

    // Posting & settlement defaults reference other enterprise records — validate they
    // belong to this enterprise (and that the city-ledger method is actually a
    // CITY_LEDGER payment method). Empty string clears the pointer (stored as null).
    if (body.defaultAccommodationChargeCodeId) {
      const cc = await prisma.chargeCode.findUnique({ where: { id: body.defaultAccommodationChargeCodeId } });
      if (!cc || cc.enterpriseId !== enterpriseId) {
        return NextResponse.json({ error: "Default accommodation charge code not found" }, { status: 400 });
      }
    }
    if (body.cityLedgerPaymentMethodId) {
      const pm = await prisma.paymentMethod.findUnique({ where: { id: body.cityLedgerPaymentMethodId } });
      if (!pm || pm.enterpriseId !== enterpriseId) {
        return NextResponse.json({ error: "City Ledger payment method not found" }, { status: 400 });
      }
      if (pm.type !== "CITY_LEDGER") {
        return NextResponse.json({ error: "The City Ledger settlement method must be a CITY_LEDGER payment method" }, { status: 400 });
      }
    }
    if (body.defaultGreenTaxChargeCodeId) {
      const cc = await prisma.chargeCode.findUnique({ where: { id: body.defaultGreenTaxChargeCodeId } });
      if (!cc || cc.enterpriseId !== enterpriseId) {
        return NextResponse.json({ error: "Green Tax charge code not found" }, { status: 400 });
      }
    }
    if (body.commissionChargeCodeId) {
      const cc = await prisma.chargeCode.findUnique({ where: { id: body.commissionChargeCodeId } });
      if (!cc || cc.enterpriseId !== enterpriseId) {
        return NextResponse.json({ error: "Commission charge code not found" }, { status: 400 });
      }
    }
    const normalizeId = (v: unknown) => (v === undefined ? undefined : v || null);

    const settings = await prisma.enterpriseSettings.upsert({
      where: { enterpriseId },
      update: {
        resConfirmPrefix: body.resConfirmPrefix !== undefined ? body.resConfirmPrefix : undefined,
        resConfirmLength: body.resConfirmLength !== undefined ? parseInt(body.resConfirmLength) : undefined,

        cashierDefaultFloat: body.cashierDefaultFloat !== undefined ? Math.max(0, parseFloat(body.cashierDefaultFloat) || 0) : undefined,
        exchangeFromCurrency: body.exchangeFromCurrency !== undefined ? String(body.exchangeFromCurrency).toUpperCase().slice(0, 8) : undefined,
        exchangeToCurrency: body.exchangeToCurrency !== undefined ? String(body.exchangeToCurrency).toUpperCase().slice(0, 8) : undefined,

        defaultAccommodationChargeCodeId: normalizeId(body.defaultAccommodationChargeCodeId),
        defaultGreenTaxChargeCodeId: normalizeId(body.defaultGreenTaxChargeCodeId),
        cityLedgerPaymentMethodId: normalizeId(body.cityLedgerPaymentMethodId),
        commissionChargeCodeId: normalizeId(body.commissionChargeCodeId),

        invoiceBrandName: body.invoiceBrandName !== undefined ? body.invoiceBrandName : undefined,
        invoiceLogoUrl: body.invoiceLogoUrl !== undefined ? body.invoiceLogoUrl : undefined,
        invoiceBrandColor: body.invoiceBrandColor !== undefined ? body.invoiceBrandColor : undefined,
        invoiceFontFamily: body.invoiceFontFamily !== undefined ? body.invoiceFontFamily : undefined,
        invoiceTaxId: body.invoiceTaxId !== undefined ? body.invoiceTaxId : undefined,
        invoicePhone: body.invoicePhone !== undefined ? body.invoicePhone : undefined,
        invoiceEmail: body.invoiceEmail !== undefined ? body.invoiceEmail : undefined,
        invoiceAddress: body.invoiceAddress !== undefined ? body.invoiceAddress : undefined,
        defaultFolioStyle: isFolioStyle(body.defaultFolioStyle) ? body.defaultFolioStyle : undefined,
        invoiceHeaderText: body.invoiceHeaderText !== undefined ? body.invoiceHeaderText : undefined,
        invoiceFooterText: body.invoiceFooterText !== undefined ? body.invoiceFooterText : undefined,
        invoicePaymentTerms: body.invoicePaymentTerms !== undefined ? body.invoicePaymentTerms : undefined,
        invoicePaymentAccountName: body.invoicePaymentAccountName !== undefined ? body.invoicePaymentAccountName : undefined,
        invoicePaymentAccountNumber: body.invoicePaymentAccountNumber !== undefined ? body.invoicePaymentAccountNumber : undefined,
        invoicePaymentIban: body.invoicePaymentIban !== undefined ? body.invoicePaymentIban : undefined,
        invoicePaymentBankInfo: body.invoicePaymentBankInfo !== undefined ? body.invoicePaymentBankInfo : undefined,
        receiptFooterText: body.receiptFooterText !== undefined ? body.receiptFooterText : undefined,
        receiptTerms: body.receiptTerms !== undefined ? body.receiptTerms : undefined,
        statementFooterText: body.statementFooterText !== undefined ? body.statementFooterText : undefined,
        statementTerms: body.statementTerms !== undefined ? body.statementTerms : undefined,
        confirmationLetterMessage: body.confirmationLetterMessage !== undefined ? body.confirmationLetterMessage : undefined,
        registrationCardEnabled: body.registrationCardEnabled !== undefined ? body.registrationCardEnabled : undefined,
        registrationCardMessage: body.registrationCardMessage !== undefined ? body.registrationCardMessage : undefined,
        registrationCardTerms: body.registrationCardTerms !== undefined ? body.registrationCardTerms : undefined,
        eRegistrationEnabled: body.eRegistrationEnabled !== undefined ? body.eRegistrationEnabled : undefined,
        eRegistrationExpiryHours: body.eRegistrationExpiryHours !== undefined ? parseInt(body.eRegistrationExpiryHours) : undefined,
        eRegistrationMessage: body.eRegistrationMessage !== undefined ? body.eRegistrationMessage : undefined,
        greenTaxEnabled: body.greenTaxEnabled !== undefined ? body.greenTaxEnabled : undefined,
        greenTaxAdultAmount: body.greenTaxAdultAmount !== undefined ? parseFloat(body.greenTaxAdultAmount) : undefined,
        greenTaxChildAmount: body.greenTaxChildAmount !== undefined ? parseFloat(body.greenTaxChildAmount) : undefined,
        greenTaxExemptAge: body.greenTaxExemptAge !== undefined ? parseInt(body.greenTaxExemptAge) : undefined,
        tgstEnabled: body.tgstEnabled !== undefined ? body.tgstEnabled : undefined,
        tgstRate: body.tgstRate !== undefined ? parseFloat(body.tgstRate) : undefined,
        serviceChargeEnabled: body.serviceChargeEnabled !== undefined ? body.serviceChargeEnabled : undefined,
        serviceChargeRate: body.serviceChargeRate !== undefined ? parseFloat(body.serviceChargeRate) : undefined,

        smtpHost: body.smtpHost !== undefined ? body.smtpHost : undefined,
        smtpPort: body.smtpPort !== undefined ? body.smtpPort : undefined,
        smtpUsername: body.smtpUsername !== undefined ? body.smtpUsername : undefined,
        smtpPassword: body.smtpPassword !== undefined ? body.smtpPassword : undefined,
        smtpFromAddress: body.smtpFromAddress !== undefined ? body.smtpFromAddress : undefined,
        smtpUseTls: body.smtpUseTls !== undefined ? body.smtpUseTls : undefined,
        sftpHost: body.sftpHost !== undefined ? body.sftpHost : undefined,
        sftpPort: body.sftpPort !== undefined ? body.sftpPort : undefined,
        sftpUsername: body.sftpUsername !== undefined ? body.sftpUsername : undefined,
        sftpPassword: body.sftpPassword !== undefined ? body.sftpPassword : undefined,
        sftpRemotePath: body.sftpRemotePath !== undefined ? body.sftpRemotePath : undefined,
      },
      create: {
        enterpriseId,
        resConfirmPrefix: body.resConfirmPrefix || "",
        resConfirmLength: body.resConfirmLength ? parseInt(body.resConfirmLength) : 6,

        cashierDefaultFloat: body.cashierDefaultFloat !== undefined ? Math.max(0, parseFloat(body.cashierDefaultFloat) || 0) : 300,
        exchangeFromCurrency: body.exchangeFromCurrency ? String(body.exchangeFromCurrency).toUpperCase().slice(0, 8) : "USD",
        exchangeToCurrency: body.exchangeToCurrency ? String(body.exchangeToCurrency).toUpperCase().slice(0, 8) : "MVR",

        defaultAccommodationChargeCodeId: body.defaultAccommodationChargeCodeId || null,
        defaultGreenTaxChargeCodeId: body.defaultGreenTaxChargeCodeId || null,
        cityLedgerPaymentMethodId: body.cityLedgerPaymentMethodId || null,
        commissionChargeCodeId: body.commissionChargeCodeId || null,

        invoiceBrandName: body.invoiceBrandName || "",
        invoiceLogoUrl: body.invoiceLogoUrl || "",
        invoiceBrandColor: body.invoiceBrandColor || DEFAULT_INVOICE_BRAND_COLOR,
        invoiceFontFamily: body.invoiceFontFamily || "Geist",
        invoiceTaxId: body.invoiceTaxId || "",
        invoicePhone: body.invoicePhone || "",
        invoiceEmail: body.invoiceEmail || "",
        invoiceAddress: body.invoiceAddress || "",
        defaultFolioStyle: isFolioStyle(body.defaultFolioStyle) ? body.defaultFolioStyle : "detailed",
        invoiceHeaderText: body.invoiceHeaderText || "",
        invoiceFooterText: body.invoiceFooterText || "",
        invoicePaymentTerms: body.invoicePaymentTerms || "",
        receiptFooterText: body.receiptFooterText || null,
        receiptTerms: body.receiptTerms || null,
        statementFooterText: body.statementFooterText || null,
        statementTerms: body.statementTerms || null,
        confirmationLetterMessage: body.confirmationLetterMessage || null,
        registrationCardEnabled: body.registrationCardEnabled !== undefined ? body.registrationCardEnabled : true,
        registrationCardMessage: body.registrationCardMessage || null,
        registrationCardTerms: body.registrationCardTerms || null,
        eRegistrationEnabled: body.eRegistrationEnabled !== undefined ? body.eRegistrationEnabled : true,
        eRegistrationExpiryHours: body.eRegistrationExpiryHours !== undefined ? parseInt(body.eRegistrationExpiryHours) : 72,
        eRegistrationMessage: body.eRegistrationMessage || null,
        greenTaxEnabled: body.greenTaxEnabled !== undefined ? body.greenTaxEnabled : true,
        greenTaxAdultAmount: body.greenTaxAdultAmount !== undefined ? parseFloat(body.greenTaxAdultAmount) : 12.00,
        greenTaxChildAmount: body.greenTaxChildAmount !== undefined ? parseFloat(body.greenTaxChildAmount) : 6.00,
        greenTaxExemptAge: body.greenTaxExemptAge !== undefined ? parseInt(body.greenTaxExemptAge) : 2,
        tgstEnabled: body.tgstEnabled !== undefined ? body.tgstEnabled : true,
        tgstRate: body.tgstRate !== undefined ? parseFloat(body.tgstRate) : 17.00,
        serviceChargeEnabled: body.serviceChargeEnabled !== undefined ? body.serviceChargeEnabled : true,
        serviceChargeRate: body.serviceChargeRate !== undefined ? parseFloat(body.serviceChargeRate) : 10.00,

        smtpHost: body.smtpHost || null,
        smtpPort: body.smtpPort ?? null,
        smtpUsername: body.smtpUsername || null,
        smtpPassword: body.smtpPassword || null,
        smtpFromAddress: body.smtpFromAddress || null,
        smtpUseTls: body.smtpUseTls !== undefined ? body.smtpUseTls : true,
        sftpHost: body.sftpHost || null,
        sftpPort: body.sftpPort ?? null,
        sftpUsername: body.sftpUsername || null,
        sftpPassword: body.sftpPassword || null,
        sftpRemotePath: body.sftpRemotePath || null,
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "EnterpriseSettings",
      entityId: settings.id,
      description: `Updated enterprise settings (${Object.keys(body).join(", ")})`,
    });

    return NextResponse.json(redactSecrets(settings));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
