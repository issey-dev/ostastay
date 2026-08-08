import { CRIMSON_OS, OBSIDIAN_BLACK } from "@/lib/brand"

// Shared source of truth for the invoice document's branding fallbacks — previously
// duplicated as independent hex literals across the print page and the invoice-data API
// route (which generates the same document's default settings). invoiceBrandColor
// itself is a legitimate per-tenant customization (set via Controls > Invoice Settings),
// not a design-system token — this just centralizes its *default* value and the
// balance-due color logic that depends on it.
//
// These are RAW HEX rather than CSS tokens on purpose: they are consumed by print
// documents and PDF renderers, which have no access to the app's custom properties.
// The brand values come from src/lib/brand.ts; the status green is kept in step with
// --success in src/app/theme.css by hand.
//
// The default was #4f46e5 (indigo) — a color from no palette this product has ever
// used, and the most visible off-brand mark in the app, since it accents every printed
// document of every tenant who has not picked a banner color. It is now Crimson OS.
export const DEFAULT_INVOICE_BRAND_COLOR = CRIMSON_OS

const BALANCE_SETTLED_COLOR = "#2F7D55" // credit / zero balance — matches --success
const BALANCE_DUE_NEUTRAL_COLOR = OBSIDIAN_BLACK // exact zero, no brand emphasis needed

export function resolveInvoiceBrandColor(brandColor: string | null | undefined): string {
  return brandColor || DEFAULT_INVOICE_BRAND_COLOR
}

export function resolveBalanceColor(balance: number, brandColor: string): string {
  if (balance > 0) return brandColor
  if (balance < 0) return BALANCE_SETTLED_COLOR
  return BALANCE_DUE_NEUTRAL_COLOR
}
