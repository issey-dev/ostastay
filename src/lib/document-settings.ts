import { getPropertySettings, type PropertySettingsValues } from "@/lib/property-settings"
import { resolveStationeryBrand, type PropertyBrandInput } from "@/lib/stationery-brand"

// What a printed or emailed document needs to know about its property's settings — and
// NOTHING else. The document data routes used to return the whole EnterpriseSettings row
// to the browser, SMTP/SFTP password columns included; this curated shape replaces it.
//
// Everything — wording and the tax switches a tax invoice prints — is the property's own
// (PropertySettings; each property has its own stationery and its own tax,
// .agents/docs/HUB_SETUP_PLAN.md).

export type DocumentSettings = PropertySettingsValues

export async function loadDocumentSettings(propertyId: string): Promise<DocumentSettings> {
  return getPropertySettings(propertyId)
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
