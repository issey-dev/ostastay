// Shared rules for a property's CURRENCY and TIME ZONE — the two fields every date and
// money figure of the property hangs off. Used by the tenant create/edit routes
// (/api/properties, /api/properties/[id]) and the Hub's property form, so the client and
// the server agree on what is accepted. The Osta console's create route applies the same
// 3-letter / non-empty checks (src/app/api/osta/properties/create/route.ts).
//
// Pure — no Prisma, safe to import from a client component.

/** Default for a new property: most of the customer base operates in the Maldives. */
export const DEFAULT_PROPERTY_TIME_ZONE = "Indian/Maldives"
export const DEFAULT_PROPERTY_CURRENCY = "USD"

/** Trimmed, upper-cased — "usd " → "USD". Non-strings become "". */
export function normalizeCurrency(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

/** An ISO 4217-shaped code: exactly three letters (after normalizeCurrency). */
export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code)
}

/** True when the runtime knows this IANA zone. Intl throws a RangeError on an unknown
 *  one, which is exactly the check we want — a typo'd zone would otherwise be stored and
 *  quietly break every business-date calculation for the property. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** Every IANA zone the runtime supports, for the searchable picker. "UTC" is added
 *  explicitly — some engines list only the Etc/ aliases — and the default sits first. */
export function timeZoneOptions(): string[] {
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  } catch {
    zones = []
  }
  const set = new Set([DEFAULT_PROPERTY_TIME_ZONE, "UTC", ...zones])
  return [DEFAULT_PROPERTY_TIME_ZONE, ...[...set].filter((z) => z !== DEFAULT_PROPERTY_TIME_ZONE).sort()]
}
