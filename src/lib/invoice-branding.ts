// Shared source of truth for the invoice document's branding fallbacks — previously
// duplicated as independent hex literals across the print page and the invoice-data API
// route (which generates the same document's default settings). invoiceBrandColor
// itself is a legitimate per-tenant customization (set via Controls > Invoice Settings),
// not a design-system token — this just centralizes its *default* value and the
// balance-due color logic that depends on it.
export const DEFAULT_INVOICE_BRAND_COLOR = "#4f46e5"

const BALANCE_SETTLED_COLOR = "#10b981" // credit / zero balance
const BALANCE_DUE_NEUTRAL_COLOR = "#1e293b" // exact zero, no brand emphasis needed

export function resolveInvoiceBrandColor(brandColor: string | null | undefined): string {
  return brandColor || DEFAULT_INVOICE_BRAND_COLOR
}

export function resolveBalanceColor(balance: number, brandColor: string): string {
  if (balance > 0) return brandColor
  if (balance < 0) return BALANCE_SETTLED_COLOR
  return BALANCE_DUE_NEUTRAL_COLOR
}
