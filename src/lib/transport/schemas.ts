import { z } from "zod"
import {
  BOOKING_STATUSES,
  DATE_KEY,
  DIRECTIONS,
  HHMM,
  LOCATION_TYPES,
  MANIFEST_STATUSES,
  PRICING_BASES,
  PROVIDER_KINDS,
  ROUTE_CATEGORIES,
  ROUTE_DIRECTIONS,
  TAX_MODES,
  TRANSPORT_MODES,
} from "@/lib/transport/constants"

// Server-side request schemas for the Transportation module — shared by the session routes
// (src/app/api/transport/**) and the public Booking API (src/app/api/website/v1/.../transport/**)
// so both refuse the same input with the same message. Forms keep their own string-typed
// Zod schemas (APP STANDARD 001) and send payloads in these shapes.

const code = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters")
  .max(12, "Code must be at most 12 characters")
  .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only")
  .transform((v) => v.toUpperCase())
const name = z.string().trim().min(2, "Name must be at least 2 characters").max(80)
const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))
const optId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
const money = z.coerce.number().min(0, "Must be 0 or more").max(1_000_000)
const dateKey = z.string().regex(DATE_KEY, "Use yyyy-MM-dd")
const hhmm = z.string().regex(HHMM, "Use HH:MM (24-hour)")

export const settingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    defaultTaxMode: z.enum(TAX_MODES),
    defaultTaxProfileId: optId,
    defaultChargeCodeId: optId,
    requireProvider: z.boolean(),
    attentionToleranceMinutes: z.coerce.number().int().min(0).max(720),
  })
  .partial()

export const typeSchema = z.object({
  code,
  name,
  mode: z.enum(TRANSPORT_MODES),
  requiresFlightDetails: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export const locationSchema = z.object({
  code,
  name,
  type: z.enum(LOCATION_TYPES),
  notes: optText(),
  isActive: z.boolean().default(true),
})

export const routeBaseSchema = z.object({
  code,
  name,
  originId: z.string().min(1, "Origin is required"),
  destinationId: z.string().min(1, "Destination is required"),
  transportTypeId: z.string().min(1, "Transport type is required"),
  category: z.enum(ROUTE_CATEGORIES),
  direction: z.enum(ROUTE_DIRECTIONS),
  durationMinutes: z.coerce.number().int().min(0).max(1440).nullish().transform((v) => v ?? null),
  instructions: optText(1000),
  departureSlots: z
    .array(hhmm)
    .max(24)
    .default([])
    .transform((v) => [...new Set(v)].sort()),
  isActive: z.boolean().default(true),
})
export const routeSchema = routeBaseSchema.refine((r) => r.originId !== r.destinationId, {
  message: "Origin and destination must differ",
  path: ["destinationId"],
})

export const providerSchema = z.object({
  name,
  kind: z.enum(PROVIDER_KINDS),
  contactName: optText(80),
  phone: optText(40),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .nullish()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  notes: optText(),
  isActive: z.boolean().default(true),
})

export const vesselSchema = z.object({
  providerId: z.string().min(1, "Provider is required"),
  name,
  transportTypeId: optId,
  capacity: z.coerce.number().int().min(1, "At least 1 seat").max(500),
  registration: optText(40),
  isActive: z.boolean().default(true),
})

export const rateBaseSchema = z.object({
  routeId: z.string().min(1, "Route is required"),
  transportTypeId: optId,
  providerId: optId,
  name: optText(80),
  direction: z.enum(ROUTE_DIRECTIONS),
  pricingBasis: z.enum(PRICING_BASES),
  price: money.default(0),
  adultPrice: money.default(0),
  childPrice: money.default(0),
  infantPrice: money.default(0),
  childMinAge: z.coerce.number().int().min(0).max(17).default(2),
  childMaxAge: z.coerce.number().int().min(0).max(17).default(11),
  validFrom: dateKey.nullish().transform((v) => v ?? null),
  validTo: dateKey.nullish().transform((v) => v ?? null),
  chargeCodeId: z.string().min(1, "Charge code is required"),
  taxMode: z.enum(TAX_MODES).default("CHARGE_CODE"),
  taxProfileId: optId,
  isBillable: z.boolean().default(true),
  isActive: z.boolean().default(true),
})
export const rateSchema = rateBaseSchema
  .refine((r) => r.childMaxAge >= r.childMinAge, { message: "Must be at least the child minimum age", path: ["childMaxAge"] })
  .refine((r) => !r.validFrom || !r.validTo || r.validTo >= r.validFrom, { message: "End date is before start date", path: ["validTo"] })
  .refine((r) => r.taxMode !== "CUSTOM" || !!r.taxProfileId, { message: "Choose a tax profile", path: ["taxProfileId"] })

// ── Bookings ─────────────────────────────────────────────────────────────────────────

export const bookingFieldsSchema = z.object({
  direction: z.enum(DIRECTIONS),
  /** Local day (property time zone). Defaults to the reservation's arrival/departure. */
  serviceDate: dateKey.optional(),
  adults: z.coerce.number().int().min(0).max(200).optional(),
  children: z.coerce.number().int().min(0).max(200).optional(),
  infants: z.coerce.number().int().min(0).max(200).optional(),
  notes: optText(1000),
  guestName: optText(120),
  guestContact: optText(80),
  airline: optText(60),
  flightNo: z
    .string()
    .trim()
    .max(12)
    .nullish()
    .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "") : null)),
  /** Local day of the flight; defaults to serviceDate. */
  flightDate: dateKey.nullish().transform((v) => v ?? null),
  /** Local ETA (pickup) or ETD (drop-off). */
  flightTime: hhmm.nullish().transform((v) => v ?? null),
  terminal: optText(20),
  airportRepUserId: optId,
  meetingNotes: optText(500),
  routeId: optId,
  transportTypeId: optId,
  /** Local departure time on serviceDate. */
  departureTime: hhmm.nullish().transform((v) => v ?? null),
  providerId: optId,
  vesselId: optId,
  driverName: optText(80),
  driverContact: optText(40),
  seatNote: optText(120),
  vehicleCount: z.coerce.number().int().min(1).max(50).optional(),
  /** Set a price by hand (needs the billing permission and a reason). null clears it. */
  priceOverride: z
    .object({ amount: money, reason: z.string().trim().min(3, "Give a reason") })
    .nullish(),
})

export const bookingCreateSchema = bookingFieldsSchema.extend({
  reservationId: optId,
  /** DRAFT for a suggestion, else CONFIRMED. */
  status: z.enum(["DRAFT", "CONFIRMED"]).default("CONFIRMED"),
})

export const bookingUpdateSchema = bookingFieldsSchema.partial()

export const bookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES),
  reason: optText(300),
})

export const billingActionSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("POST"),
      /** FULL = the booking's own price; CUSTOM = an amount you give (a no-show fee, say). */
      mode: z.enum(["FULL", "CUSTOM"]).default("FULL"),
      amount: z.coerce.number().positive("Must be more than 0").max(1_000_000).optional(),
      reason: z.string().trim().optional(),
      chargeCodeId: optId,
      description: optText(120),
    }),
    z.object({ action: z.literal("WAIVE"), reason: z.string().trim().min(3, "Give a reason") }),
    z.object({ action: z.literal("RESUME") }),
    z.object({ action: z.literal("VOID"), reason: z.string().trim().min(3, "Give a reason") }),
  ])
  .superRefine((v, ctx) => {
    if (v.action === "POST" && v.mode === "CUSTOM") {
      if (v.amount === undefined) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount" })
      if (!v.reason || v.reason.length < 3) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason" })
    }
  })
export type BillingAction = z.infer<typeof billingActionSchema>

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("STATUS"), bookingIds: z.array(z.string()).min(1).max(200), status: z.enum(BOOKING_STATUSES), reason: optText(300) }),
  z.object({ action: z.literal("ASSIGN_REP"), bookingIds: z.array(z.string()).min(1).max(200), airportRepUserId: optId }),
  z.object({ action: z.literal("POST"), bookingIds: z.array(z.string()).min(1).max(200) }),
  z.object({ action: z.literal("CONFIRM_DRAFTS"), bookingIds: z.array(z.string()).min(1).max(200) }),
])

// ── Manifests ────────────────────────────────────────────────────────────────────────

export const manifestCreateSchema = z.object({
  routeId: z.string().min(1, "Route is required"),
  direction: z.enum(DIRECTIONS),
  serviceDate: dateKey,
  departureTime: hhmm,
  transportTypeId: optId,
  providerId: optId,
  vesselId: optId,
  driverName: optText(80),
  driverContact: optText(40),
  notes: optText(1000),
  bookingIds: z.array(z.string()).max(200).default([]),
})

export const manifestUpdateSchema = z
  .object({
    serviceDate: dateKey,
    departureTime: hhmm,
    transportTypeId: optId,
    providerId: optId,
    vesselId: optId,
    driverName: optText(80),
    driverContact: optText(40),
    notes: optText(1000),
    status: z.enum(MANIFEST_STATUSES),
  })
  .partial()

export const manifestBookingsSchema = z.object({
  /** ATTACH (also moves from another manifest), DETACH, or KEEP (accept a changed flight). */
  action: z.enum(["ATTACH", "DETACH", "KEEP"]),
  bookingIds: z.array(z.string()).min(1).max(200),
})

export const fromSlotsSchema = z.object({
  serviceDate: dateKey,
  direction: z.enum(DIRECTIONS),
  routeId: optId,
})

export const boardQuerySchema = z.object({
  date: dateKey,
  /** Optional range end for the list/report (inclusive); defaults to `date`. */
  to: dateKey.optional(),
})

/** First Zod issue as one readable message (the session routes' `{ error }` shape). */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid input"
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}
