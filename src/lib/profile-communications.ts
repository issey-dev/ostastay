// Shared helper for every route/page that needs "this profile's email/mobile" —
// replaces the old single-row ProfileContact.email/.mobile now that a profile can
// have several ProfileCommunication rows (see .agents/docs/PROFILES_REDESIGN_PLAN.md).
// Prefers the row marked isPrimary; falls back to the first row of that type.

type CommunicationLike = { type: string; value: string; isPrimary: boolean }

export function primaryCommunication(
  communications: CommunicationLike[] | undefined | null,
  type: "EMAIL" | "MOBILE" | "SOCIAL"
): string | undefined {
  if (!communications) return undefined
  return (
    communications.find((c) => c.type === type && c.isPrimary)?.value ??
    communications.find((c) => c.type === type)?.value
  )
}

export const primaryEmail = (communications: CommunicationLike[] | undefined | null) =>
  primaryCommunication(communications, "EMAIL")

export const primaryMobile = (communications: CommunicationLike[] | undefined | null) =>
  primaryCommunication(communications, "MOBILE")

export const COMMUNICATION_TYPES = ["EMAIL", "MOBILE", "SOCIAL"] as const
export const ADDRESS_TYPES = ["HOME", "BUSINESS", "BILLING"] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Loose international phone pattern — optional leading +, 7-15 digits, spaces/dashes
// allowed between groups. Deliberately not stricter (E.164 validation would reject
// plenty of real front-desk-entered numbers).
const MOBILE_RE = /^\+?[0-9][0-9\s-]{6,14}$/

// Server-side validation mirrored by the client form — the API remains the authority.
// Returns an error string, or null when valid. SOCIAL has no format constraint beyond
// non-empty (a handle, a URL, whatever the guest gave).
export function validateCommunicationValue(type: string, value: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return "Value is required"
  if (type === "EMAIL" && !EMAIL_RE.test(trimmed)) return "Must be a valid email address"
  if (type === "MOBILE" && !MOBILE_RE.test(trimmed)) return "Must be a valid phone number"
  return null
}
