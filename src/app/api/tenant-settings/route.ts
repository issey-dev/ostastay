import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";

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

    return NextResponse.json(settings);
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

    const settings = await prisma.enterpriseSettings.upsert({
      where: { enterpriseId },
      update: {
        resConfirmPrefix: body.resConfirmPrefix !== undefined ? body.resConfirmPrefix : undefined,
        resConfirmLength: body.resConfirmLength !== undefined ? parseInt(body.resConfirmLength) : undefined,

        invoiceBrandName: body.invoiceBrandName !== undefined ? body.invoiceBrandName : undefined,
        invoiceLogoUrl: body.invoiceLogoUrl !== undefined ? body.invoiceLogoUrl : undefined,
        invoiceBrandColor: body.invoiceBrandColor !== undefined ? body.invoiceBrandColor : undefined,
        invoiceFontFamily: body.invoiceFontFamily !== undefined ? body.invoiceFontFamily : undefined,
        invoiceTaxId: body.invoiceTaxId !== undefined ? body.invoiceTaxId : undefined,
        invoicePhone: body.invoicePhone !== undefined ? body.invoicePhone : undefined,
        invoiceEmail: body.invoiceEmail !== undefined ? body.invoiceEmail : undefined,
        invoiceAddress: body.invoiceAddress !== undefined ? body.invoiceAddress : undefined,
        invoiceHeaderText: body.invoiceHeaderText !== undefined ? body.invoiceHeaderText : undefined,
        invoiceFooterText: body.invoiceFooterText !== undefined ? body.invoiceFooterText : undefined,
        invoicePaymentTerms: body.invoicePaymentTerms !== undefined ? body.invoicePaymentTerms : undefined,
        invoicePaymentAccountName: body.invoicePaymentAccountName !== undefined ? body.invoicePaymentAccountName : undefined,
        invoicePaymentAccountNumber: body.invoicePaymentAccountNumber !== undefined ? body.invoicePaymentAccountNumber : undefined,
        invoicePaymentIban: body.invoicePaymentIban !== undefined ? body.invoicePaymentIban : undefined,
        invoicePaymentBankInfo: body.invoicePaymentBankInfo !== undefined ? body.invoicePaymentBankInfo : undefined,
        confirmationLetterMessage: body.confirmationLetterMessage !== undefined ? body.confirmationLetterMessage : undefined,
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

        invoiceBrandName: body.invoiceBrandName || "",
        invoiceLogoUrl: body.invoiceLogoUrl || "",
        invoiceBrandColor: body.invoiceBrandColor || DEFAULT_INVOICE_BRAND_COLOR,
        invoiceFontFamily: body.invoiceFontFamily || "Geist",
        invoiceTaxId: body.invoiceTaxId || "",
        invoicePhone: body.invoicePhone || "",
        invoiceEmail: body.invoiceEmail || "",
        invoiceAddress: body.invoiceAddress || "",
        invoiceHeaderText: body.invoiceHeaderText || "",
        invoiceFooterText: body.invoiceFooterText || "",
        invoicePaymentTerms: body.invoicePaymentTerms || "",
        confirmationLetterMessage: body.confirmationLetterMessage || null,
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

    return NextResponse.json(settings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
