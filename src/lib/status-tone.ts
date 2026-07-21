// Single source of truth for status → color mapping. Any component that needs to
// render a status (reservation, room, maintenance ticket, license, support grant, …)
// resolves through here instead of hand-rolling its own switch statement — keeps
// "what color means what" consistent across the whole app.
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral"

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  // Housekeeping / room status
  CLEAN: "success",
  INSPECTED: "info",
  DIRTY: "danger",
  OUT_OF_ORDER: "neutral",
  OUT_OF_SERVICE: "neutral",
  // Reservation / stay lifecycle
  IN_HOUSE: "success",
  CHECKED_IN: "success",
  RESERVED: "info",
  CONFIRMED: "info",
  CHECKED_OUT: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "danger",
  // Maintenance / task lifecycle
  OPEN: "danger",
  IN_PROGRESS: "info",
  PENDING: "warning",
  COMPLETED: "success",
  RESOLVED: "success",
  APPROVED: "success",
  DENIED: "danger",
  EXPIRED: "neutral",
  REVOKED: "neutral",
  ACTIVE: "success",
  INACTIVE: "neutral",
  // Property approval lifecycle (PENDING already covered above)
  REJECTED: "danger",
  // Group block lifecycle
  DEFINITE: "success",
  TENTATIVE: "warning",
}

export function statusTone(status: string): StatusTone {
  return STATUS_TONE_MAP[status.toUpperCase()] ?? "neutral"
}

// Muted background + colored text/border — the default for badges and pills.
const MUTED_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-muted text-success border-success/30",
  warning: "bg-warning-muted text-warning border-warning/30",
  danger: "bg-destructive-muted text-destructive border-destructive/30",
  info: "bg-info-muted text-info border-info/30",
  neutral: "bg-muted text-muted-foreground border-border",
}

// Solid fill — for elements that need to read at a glance from a distance (calendar/
// tape-chart cells, room-board tiles), not just a small inline label.
const SOLID_CLASSES: Record<StatusTone, string> = {
  success: "bg-success hover:bg-success/90 text-success-foreground",
  warning: "bg-warning hover:bg-warning/90 text-warning-foreground",
  danger: "bg-destructive hover:bg-destructive/90 text-destructive-foreground",
  info: "bg-info hover:bg-info/90 text-info-foreground",
  neutral: "bg-muted-foreground/70 hover:bg-muted-foreground/80 text-background",
}

export function toneMutedClasses(tone: StatusTone): string {
  return MUTED_CLASSES[tone]
}

export function toneSolidClasses(tone: StatusTone): string {
  return SOLID_CLASSES[tone]
}

export function statusMutedClasses(status: string): string {
  return MUTED_CLASSES[statusTone(status)]
}

export function statusSolidClasses(status: string): string {
  return SOLID_CLASSES[statusTone(status)]
}
