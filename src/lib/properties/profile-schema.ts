import * as z from "zod"

// Property Information (Hub › General) — one set of rules shared by the form (APP STANDARD
// 001, inline validation) and PUT /api/properties/[id], so the two can never disagree.

// 24-hour clock. A single-digit hour ("9:00") is still accepted — the create form
// (src/components/property-form.tsx) has always allowed it, so existing rows may hold one.
export const TIME_HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/
// A NEW property's code (the tenant create form): 2–5 letters/digits.
export const PROPERTY_CODE = /^[A-Z0-9]{2,5}$/
// An EXISTING property's code may be longer: the Osta console creates codes of up to 12
// characters with dashes (e.g. "VEYO-MAIN"), and those properties must stay editable.
export const EXISTING_PROPERTY_CODE = /^[A-Z0-9][A-Z0-9-]{1,11}$/

export const PROFILE_MESSAGES = {
  name: "Property name must be at least 2 characters.",
  legalName: "Legal name must be at least 2 characters.",
  code: "Short code must be 2–5 letters or digits (A–Z, 0–9).",
  existingCode: "Short code must be 2–12 letters, digits or dashes, starting with a letter or digit.",
  starRating: "Star rating must be a whole number from 0 to 5.",
  time: "Use 24-hour HH:MM, e.g. 14:00.",
  email: "Enter a valid email address.",
} as const

// ── Form (client) ─────────────────────────────────────────────────────────────────────
// Inputs are strings; empty string means "not set" for the optional fields.
export const propertyProfileFormSchema = z.object({
  name: z.string().trim().min(2, PROFILE_MESSAGES.name).max(120),
  legalName: z.string().trim().min(2, PROFILE_MESSAGES.legalName).max(200),
  code: z.string().trim().regex(EXISTING_PROPERTY_CODE, PROFILE_MESSAGES.existingCode),
  starRating: z.string().trim().regex(/^[0-5]?$/, PROFILE_MESSAGES.starRating),
  checkInTime: z.string().trim().regex(TIME_HHMM, PROFILE_MESSAGES.time),
  checkOutTime: z.string().trim().regex(TIME_HHMM, PROFILE_MESSAGES.time),
  taxId: z.string().trim().max(60),
  contactPhone: z.string().trim().max(40, "Phone number is too long."),
  contactEmail: z.union([z.literal(""), z.string().trim().email(PROFILE_MESSAGES.email)]),
  address: z.string().trim().max(300),
})
export type PropertyProfileFormValues = z.infer<typeof propertyProfileFormSchema>

// ── PUT body (server) ─────────────────────────────────────────────────────────────────
// Every key is optional: the same route takes one-field bodies from the banner-colour,
// stationery-font, allocation-mode, session-timeout and Night Audit panels, and the full
// create/edit body from src/components/property-form.tsx. A key that is ABSENT is left
// unchanged; a key that is present must be valid. Keys not listed here are not validated
// by this schema (the route handles them itself).
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v)
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional()

export const propertyProfilePatchSchema = z.object({
  name: z.string().trim().min(2, PROFILE_MESSAGES.name).max(120).optional(),
  legalName: z.string().trim().min(2, PROFILE_MESSAGES.legalName).max(200).optional(),
  // Normalised to upper case before the check, so "sgh" saves as "SGH".
  code: z.string().trim().toUpperCase().regex(EXISTING_PROPERTY_CODE, PROFILE_MESSAGES.existingCode).optional(),
  // null / "" clears it; a numeric string is accepted for older callers.
  starRating: z
    .preprocess(
      (v) => (v === "" ? null : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : v),
      z.number(PROFILE_MESSAGES.starRating).int(PROFILE_MESSAGES.starRating).min(0, PROFILE_MESSAGES.starRating).max(5, PROFILE_MESSAGES.starRating).nullable(),
    )
    .optional(),
  checkInTime: z.string().trim().regex(TIME_HHMM, PROFILE_MESSAGES.time).optional(),
  checkOutTime: z.string().trim().regex(TIME_HHMM, PROFILE_MESSAGES.time).optional(),
  // defaultCurrency / timeZone are NOT here: the route validates them itself
  // (src/lib/properties/property-input.ts) and locks them once the property is ACTIVE.
  taxId: optionalText(60),
  contactPhone: optionalText(40),
  contactEmail: z.preprocess(emptyToNull, z.string().trim().email(PROFILE_MESSAGES.email).nullable()).optional(),
  address: optionalText(300),
})
export type PropertyProfilePatch = z.infer<typeof propertyProfilePatchSchema>

// Field → first message, for a 400 body the form can map straight onto its inputs.
export function profileFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "")
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}
