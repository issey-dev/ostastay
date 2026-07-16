import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// TODO(Phase 2): this whole route is still the pre-existing single-tenant shortcut —
// it always resolves the first STANDARD enterprise rather than deriving enterpriseId
// from the session. Real per-enterprise settings + session scoping is Phase 2's job
// (see the approved plan: "tenant-settings → enterprise-settings").
async function getDemoEnterpriseId(): Promise<string> {
  const enterprise = await prisma.enterprise.findFirst({
    where: { type: "STANDARD" },
    orderBy: { createdAt: "asc" },
  });
  if (!enterprise) throw new Error("No STANDARD enterprise found — run the seed route first");
  return enterprise.id;
}

export async function GET(request: Request) {
  try {
    const enterpriseId = await getDemoEnterpriseId();
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    if (!settings) {
      // Auto-create default settings if none exist
      settings = await prisma.enterpriseSettings.create({
        data: {
          enterpriseId,
          resConfirmPrefix: "",
          resConfirmLength: 6
        }
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to fetch settings", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const enterpriseId = await getDemoEnterpriseId();

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
        greenTaxEnabled: body.greenTaxEnabled !== undefined ? body.greenTaxEnabled : undefined,
        greenTaxAmount: body.greenTaxAmount !== undefined ? parseFloat(body.greenTaxAmount) : undefined,
        greenTaxExemptAge: body.greenTaxExemptAge !== undefined ? parseInt(body.greenTaxExemptAge) : undefined,
        tgstEnabled: body.tgstEnabled !== undefined ? body.tgstEnabled : undefined,
        tgstRate: body.tgstRate !== undefined ? parseFloat(body.tgstRate) : undefined,
        serviceChargeEnabled: body.serviceChargeEnabled !== undefined ? body.serviceChargeEnabled : undefined,
        serviceChargeRate: body.serviceChargeRate !== undefined ? parseFloat(body.serviceChargeRate) : undefined,
        pricesIncludeTaxes: body.pricesIncludeTaxes !== undefined ? body.pricesIncludeTaxes : undefined,
      },
      create: {
        enterpriseId,
        resConfirmPrefix: body.resConfirmPrefix || "",
        resConfirmLength: body.resConfirmLength ? parseInt(body.resConfirmLength) : 6,

        invoiceBrandName: body.invoiceBrandName || "",
        invoiceLogoUrl: body.invoiceLogoUrl || "",
        invoiceBrandColor: body.invoiceBrandColor || "#4f46e5",
        invoiceFontFamily: body.invoiceFontFamily || "Geist",
        invoiceTaxId: body.invoiceTaxId || "",
        invoicePhone: body.invoicePhone || "",
        invoiceEmail: body.invoiceEmail || "",
        invoiceAddress: body.invoiceAddress || "",
        invoiceHeaderText: body.invoiceHeaderText || "",
        invoiceFooterText: body.invoiceFooterText || "",
        invoicePaymentTerms: body.invoicePaymentTerms || "",
        greenTaxEnabled: body.greenTaxEnabled !== undefined ? body.greenTaxEnabled : true,
        greenTaxAmount: body.greenTaxAmount !== undefined ? parseFloat(body.greenTaxAmount) : 6.00,
        greenTaxExemptAge: body.greenTaxExemptAge !== undefined ? parseInt(body.greenTaxExemptAge) : 2,
        tgstEnabled: body.tgstEnabled !== undefined ? body.tgstEnabled : true,
        tgstRate: body.tgstRate !== undefined ? parseFloat(body.tgstRate) : 16.00,
        serviceChargeEnabled: body.serviceChargeEnabled !== undefined ? body.serviceChargeEnabled : true,
        serviceChargeRate: body.serviceChargeRate !== undefined ? parseFloat(body.serviceChargeRate) : 10.00,
        pricesIncludeTaxes: body.pricesIncludeTaxes !== undefined ? body.pricesIncludeTaxes : true,
      }
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to update settings", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

