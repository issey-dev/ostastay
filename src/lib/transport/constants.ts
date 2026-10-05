// Transportation module — closed lists and their labels (see .agents/docs/TRANSPORTATION_PLAN.md).
// No server-only imports: the Hub managers, the board and the API schemas all read these.

export const TRANSPORT_MODES = ["SPEEDBOAT", "SEAPLANE", "DOMESTIC_FLIGHT", "FERRY", "LAND", "OTHER"] as const
export type TransportMode = (typeof TRANSPORT_MODES)[number]
export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  SPEEDBOAT: "Speedboat",
  SEAPLANE: "Seaplane",
  DOMESTIC_FLIGHT: "Domestic flight",
  FERRY: "Ferry",
  LAND: "Land",
  OTHER: "Other",
}

export const LOCATION_TYPES = ["AIRPORT", "JETTY", "SEAPLANE_PLATFORM", "ISLAND", "RESORT", "GUESTHOUSE", "OTHER"] as const
export type LocationType = (typeof LOCATION_TYPES)[number]
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  AIRPORT: "Airport",
  JETTY: "Jetty",
  SEAPLANE_PLATFORM: "Seaplane platform",
  ISLAND: "Island",
  RESORT: "Resort",
  GUESTHOUSE: "Guesthouse",
  OTHER: "Other",
}

export const ROUTE_CATEGORIES = ["AIRPORT_TRANSFER", "LOCAL_TRANSFER"] as const
export type RouteCategory = (typeof ROUTE_CATEGORIES)[number]
export const ROUTE_CATEGORY_LABELS: Record<RouteCategory, string> = {
  AIRPORT_TRANSFER: "Airport transfer",
  LOCAL_TRANSFER: "Local transfer",
}

export const DIRECTIONS = ["PICKUP", "DROP_OFF"] as const
export type Direction = (typeof DIRECTIONS)[number]
export const DIRECTION_LABELS: Record<Direction, string> = { PICKUP: "Pickup", DROP_OFF: "Drop-off" }

export const ROUTE_DIRECTIONS = ["PICKUP", "DROP_OFF", "BOTH"] as const
export type RouteDirection = (typeof ROUTE_DIRECTIONS)[number]
export const ROUTE_DIRECTION_LABELS: Record<RouteDirection, string> = { PICKUP: "Pickup", DROP_OFF: "Drop-off", BOTH: "Both" }

export const PROVIDER_KINDS = ["OWN", "THIRD_PARTY"] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = { OWN: "Own", THIRD_PARTY: "Third party" }

export const PRICING_BASES = ["PER_PERSON", "PER_VEHICLE", "PER_TRIP"] as const
export type PricingBasis = (typeof PRICING_BASES)[number]
export const PRICING_BASIS_LABELS: Record<PricingBasis, string> = {
  PER_PERSON: "Per person",
  PER_VEHICLE: "Per vehicle",
  PER_TRIP: "Per trip",
}

// How a rate is taxed — the same three choices as an outlet's tax override:
// CHARGE_CODE = the charge code's own setting, DEFAULT = the property's Service Charge + GST,
// CUSTOM = a chosen tax profile.
export const TAX_MODES = ["CHARGE_CODE", "DEFAULT", "CUSTOM"] as const
export type TaxMode = (typeof TAX_MODES)[number]
export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  CHARGE_CODE: "As the charge code",
  DEFAULT: "Default tax (Service Charge + GST)",
  CUSTOM: "Custom tax profile",
}

export const BOOKING_STATUSES = ["DRAFT", "CONFIRMED", "ASSIGNED", "COMPLETED", "NO_SHOW", "CANCELLED"] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  ASSIGNED: "Assigned",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelled",
}
/** Bookings that still travel (count on a manifest, show on the board by default). */
export const LIVE_BOOKING_STATUSES: BookingStatus[] = ["DRAFT", "CONFIRMED", "ASSIGNED", "COMPLETED"]
/** Bookings Night Audit may post (section 5: confirmed or completed, never no-show/cancelled/draft). */
export const POSTABLE_BOOKING_STATUSES: BookingStatus[] = ["CONFIRMED", "ASSIGNED", "COMPLETED"]

export const MANIFEST_STATUSES = ["OPEN", "CONFIRMED", "DEPARTED", "COMPLETED", "CANCELLED"] as const
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number]
export const MANIFEST_STATUS_LABELS: Record<ManifestStatus, string> = {
  OPEN: "Open",
  CONFIRMED: "Confirmed",
  DEPARTED: "Departed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

export const BILLING_STATUSES = ["NOT_BILLED", "PENDING", "POSTED", "VOIDED", "WAIVED", "NON_BILLABLE"] as const
export type BillingStatus = (typeof BILLING_STATUSES)[number]
export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  NOT_BILLED: "Not billed",
  PENDING: "Pending",
  POSTED: "Posted",
  VOIDED: "Voided",
  WAIVED: "Waived",
  NON_BILLABLE: "Complimentary",
}

/** StatusBadge tones (src/lib/status-tone.ts) — one table for bookings, manifests, billing. */
export const STATUS_TONES: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  CONFIRMED: "info",
  ASSIGNED: "success",
  COMPLETED: "success",
  NO_SHOW: "danger",
  CANCELLED: "danger",
  OPEN: "warning",
  DEPARTED: "info",
  NOT_BILLED: "neutral",
  PENDING: "warning",
  POSTED: "success",
  VOIDED: "neutral",
  WAIVED: "neutral",
  NON_BILLABLE: "neutral",
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function label<T extends string>(labels: Record<T, string>, value: string | null | undefined): string {
  if (!value) return "—"
  return (labels as Record<string, string>)[value] ?? value
}
