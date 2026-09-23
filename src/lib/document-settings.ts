import { prisma } from "@/lib/db"
import { getPropertySettings, type PropertySettingsValues } from "@/lib/property-settings"
import { resolveStationeryBrand, type PropertyBrandInput } from "@/lib/stationery-brand"

// What a printed or emailed document needs to know about its property's settings — and
// NOTHING else. The document data routes used to return the whole EnterpriseSettings row
// to the browser, SMTP/SFTP password columns included; this curated shape replaces it.
//
// Content comes from the property's own PropertySettings (each property has its own
// stationery, .agents/docs/HUB_SETUP_PLAN.md). The tax switches a tax invoice prints come
// from the enterprise until tax moves per property (Phase 2) — this is the one place to
// change when it does.

const TAX_DEFAULTS = {
  greenTaxEnabled: true,
  greenTaxAdultAmount: 12,
  greenTaxChildAmount: 6,
  greenTaxExemptAge: 2,
  tgstEnabled: true,
  tgstRate: 17,
  serviceChargeEnabled: true,
  serviceChargeRate: 10,
}

export type DocumentSettings = PropertySettingsValues & typeof TAX_DEFAULTS

export async function loadDocumentSettings(propertyId: string): Promise<DocumentSettings> {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { enterpriseId: true } })
  const [content, tax] = await Promise.all([
    getPropertySettings(propertyId),
    property
      ? prisma.enterpriseSettings.findUnique({
          where: { enterpriseId: property.enterpriseId },
          select: {
            greenTaxEnabled: true,
            greenTaxAdultAmount: true,
            greenTaxChildAmount: true,
            greenTaxExemptAge: true,
            tgstEnabled: true,
            tgstRate: true,
            serviceChargeEnabled: true,
            serviceChargeRate: true,
          },
        })
      : null,
  ])
  return { ...content, ...TAX_DEFAULTS, ...(tax ?? {}) }
}

// For EMAILED documents: the property's identity (name, logo, address, contact, accent —
// the same resolver printed documents use) under the field names the email builders
// already read, plus the property's own document content. Emails used to take identity
// from the deprecated EnterpriseSettings.invoice* columns, so a guest's email could name
// a different brand from the PDF attached to it.
export async function loadEmailBranding(property: PropertyBrandInput & { id: string }) {
  const brand = resolveStationeryBrand(property)
  const content = await getPropertySettings(property.id)
  return {
    brandColor: brand.brandColor,
    settings: {
      ...content,
      invoiceBrandName: brand.name,
      invoiceLogoUrl: brand.logoUrl,
      invoiceAddress: brand.address,
      invoicePhone: brand.phone,
      invoiceEmail: brand.email,
    },
  }
}
