// The notification catalogue — every kind of notification the app can raise, in one place
// (.agents/docs/NOTIFICATIONS_PLAN.md, section 4). A producer names a `type` from here; the
// code decides severity and wording, never the caller. The settings page is drawn from it.
//
// Add a type only when someone is expected to act or know soon. Anything else is a log line.
//
//   severity  INFO stays in the bell; ACTION and URGENT also go to phones.
//   locked    the bell cannot be switched off for this kind (security notices, announcements).
//             The person can still choose whether it also goes to their phone.

export const SEVERITY = { INFO: "INFO", ACTION: "ACTION", URGENT: "URGENT" } as const
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY]

export type TypeMeta = {
  label: string
  /** One plain sentence for the settings page: what it is and who gets it. */
  description: string
  severity: Severity
  group: "Property" | "Bookings" | "Work" | "Account and security" | "Announcements"
  locked?: boolean
}

export const NOTIFICATION_TYPES = {
  BUSINESS_DATE_ROLLED: {
    label: "Business date rolled",
    description: "A new business day has started at your property. Sent to everyone who works there.",
    severity: SEVERITY.INFO,
    group: "Property",
  },
  NIGHT_AUDIT_FAILED: {
    label: "Night Audit did not finish",
    description: "A scheduled Night Audit stopped, failed or fell behind. Sent to people with Night Audit access.",
    severity: SEVERITY.URGENT,
    group: "Property",
  },
  CHANNEL_BOOKING_RECEIVED: {
    label: "Online booking received",
    description: "A booking arrived from a booking channel and became a reservation. Sent to people who can create reservations.",
    severity: SEVERITY.ACTION,
    group: "Bookings",
  },
  CHANNEL_BOOKING_FAILED: {
    label: "Online booking needs attention",
    description: "A booking from a channel could not be added and needs a person. Sent to people who can create reservations.",
    severity: SEVERITY.ACTION,
    group: "Bookings",
  },
  CHANNEL_CONNECTION_FAILED: {
    label: "Channel connection failed",
    description: "A channel-manager connection stopped working. Sent to people who manage integrations.",
    severity: SEVERITY.URGENT,
    group: "Property",
  },
  ACTIVITY_BOOKING_RECEIVED: {
    label: "Excursion or spa booking from the website",
    description: "A guest booked an excursion or spa treatment on the property's website. Sent to people who manage that service.",
    severity: SEVERITY.ACTION,
    group: "Bookings",
  },
  TASK_ASSIGNED: {
    label: "A task was assigned to you",
    description: "Someone assigned a maintenance task to you.",
    severity: SEVERITY.ACTION,
    group: "Work",
  },
  ROOMS_ASSIGNED: {
    label: "Rooms were assigned to you",
    description: "Someone assigned rooms to you to clean.",
    severity: SEVERITY.ACTION,
    group: "Work",
  },
  TRANSPORT_ATTENTION: {
    label: "A transfer needs attention",
    description: "A transfer in the next two days has a problem, such as a boat that leaves before the flight lands. Sent to people who manage transport manifests.",
    severity: SEVERITY.ACTION,
    group: "Work",
  },
  CASHIER_SHIFT_OPEN: {
    label: "A cashier shift was left open",
    description: "A cashier shift has been open for over 16 hours. Sent to the cashier, and to people who supervise cashiering.",
    severity: SEVERITY.ACTION,
    group: "Work",
  },
  GROUP_CUTOFF: {
    label: "A group cut-off date is close",
    description: "A group's cut-off date is today or tomorrow and rooms are still not picked up. Sent to people who manage group blocks.",
    severity: SEVERITY.ACTION,
    group: "Bookings",
  },
  NEW_DEVICE_SIGN_IN: {
    label: "Sign-in from a new device",
    description: "Your account was signed in on a browser or device it has not been used on before.",
    severity: SEVERITY.INFO,
    group: "Account and security",
    locked: true,
  },
  SUPPORT_SESSION_OPENED: {
    label: "Osta support opened a session",
    description: "Osta support started working in your enterprise under an approved access grant. Sent to people who manage users.",
    severity: SEVERITY.URGENT,
    group: "Account and security",
    locked: true,
  },
  ANNOUNCEMENT: {
    label: "Announcements",
    description: "A message from your administrators to everyone, or to a property.",
    severity: SEVERITY.ACTION,
    group: "Announcements",
    locked: true,
  },
} as const satisfies Record<string, TypeMeta>

export type NotificationType = keyof typeof NOTIFICATION_TYPES

export function isNotificationType(v: string): v is NotificationType {
  return v in NOTIFICATION_TYPES
}

export function typeMeta(type: string): TypeMeta | null {
  return isNotificationType(type) ? NOTIFICATION_TYPES[type] : null
}
