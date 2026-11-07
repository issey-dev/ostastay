// The notification catalogue — every kind of notification the app can raise, in one place
// (.agents/docs/NOTIFICATIONS_PLAN.md, section 4). A producer names a `type` from here; the
// code decides severity and the icon, never the caller.
//
// Add a type only when someone is expected to act or know soon. Anything else is a log line.

export const SEVERITY = { INFO: "INFO", ACTION: "ACTION", URGENT: "URGENT" } as const
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY]

export const NOTIFICATION_TYPES = {
  /** The property's business date moved on. Everyone at the property. */
  BUSINESS_DATE_ROLLED: { label: "Business date rolled", severity: SEVERITY.INFO },
  /** A scheduled Night Audit stopped or failed. Users with Night Audit access. */
  NIGHT_AUDIT_FAILED: { label: "Night Audit failed", severity: SEVERITY.URGENT },
  /** A booking arrived from a channel (OTA) and became a reservation. Users who create reservations. */
  CHANNEL_BOOKING_RECEIVED: { label: "Online booking received", severity: SEVERITY.ACTION },
  /** A channel booking could not be turned into a reservation. Users who create reservations. */
  CHANNEL_BOOKING_FAILED: { label: "Online booking needs attention", severity: SEVERITY.ACTION },
  /** A channel-manager connection broke. Users with Integrations access. */
  CHANNEL_CONNECTION_FAILED: { label: "Channel connection failed", severity: SEVERITY.URGENT },
} as const

export type NotificationType = keyof typeof NOTIFICATION_TYPES

export function isNotificationType(v: string): v is NotificationType {
  return v in NOTIFICATION_TYPES
}
