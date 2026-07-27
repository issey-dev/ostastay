import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"
import { resolveStationeryFontClass } from "@/lib/stationery-fonts"

// Single resolver for the identity block printed at the top of every stationary
// (Invoices, Receipts, Confirmation Letters, Registration Cards, Statements). Branding now
// comes from the property's own General profile + Appearance (name, logo, tax id, contact,
// address, banner colour, font) — NOT the deprecated EnterpriseSettings.invoice* columns.
//
// An outlet-scoped document (a walk-in bill raised on behalf of an outlet) overrides the
// name/address/contact/tax fields with the outlet's own, but still inherits the property's
// accent colour and font. See src/app/api/folios/[id]/invoice-data/route.ts.

export type PropertyBrandInput = {
  name: string
  logoUrl?: string | null
  taxId?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  address?: string | null
  bannerColor?: string | null
  stationeryFont?: string | null
}

export type OutletHeaderInput =
  | {
      name: string
      address?: string | null
      phone?: string | null
      email?: string | null
      taxNo?: string | null
    }
  | null
  | undefined

export type StationeryBrand = {
  name: string
  logoUrl: string | null
  address: string | null
  phone: string | null
  email: string | null
  taxId: string | null
  // Resolved accent hex (never null — falls back to the default brand colour).
  brandColor: string
  // Resolved Tailwind font class (e.g. "font-sans").
  fontClass: string
}

export function resolveStationeryBrand(
  property: PropertyBrandInput,
  outletHeader?: OutletHeaderInput
): StationeryBrand {
  return {
    name: outletHeader?.name || property.name,
    // The outlet header has no logo of its own — suppress the property logo so it isn't
    // shown against an outlet's name.
    logoUrl: outletHeader ? null : property.logoUrl ?? null,
    address: outletHeader ? outletHeader.address ?? null : property.address ?? null,
    phone: outletHeader ? outletHeader.phone ?? null : property.contactPhone ?? null,
    email: outletHeader ? outletHeader.email ?? null : property.contactEmail ?? null,
    taxId: outletHeader ? outletHeader.taxNo ?? null : property.taxId ?? null,
    // Accent + font are always the property's, even for an outlet document.
    brandColor: resolveInvoiceBrandColor(property.bannerColor),
    fontClass: resolveStationeryFontClass(property.stationeryFont),
  }
}
