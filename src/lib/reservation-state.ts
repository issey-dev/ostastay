import { toUtcMidnight } from "@/lib/business-date"

// Derived front-desk lifecycle state. The database only stores the five hard statuses
// (RESERVED, IN_HOUSE, CHECKED_OUT, NO_SHOW, CANCELLED); "Due In" and "Due Out" are
// COMPUTED from the stay dates against the property's business date, because that's how
// the front desk actually thinks about a booking and what gates the day's actions:
//
//   Reserved  — arriving in the future            → cancel only
//   Due In    — arriving today (= business date)   → check-in enabled
//   In-House  — currently staying                  → early departure enabled
//   Due Out   — departing today (= business date)  → check-out enabled
//
// One place derives it so every surface (reservation list, detail, board) agrees.
export type ReservationDerivedState =
  | "RESERVED"
  | "DUE_IN"
  | "IN_HOUSE"
  | "DUE_OUT"
  | "CHECKED_OUT"
  | "NO_SHOW"
  | "CANCELLED"

type Dateish = Date | string | null | undefined

function dayMs(d: Dateish): number {
  if (!d) return NaN
  return toUtcMidnight(new Date(d)).getTime()
}

export function deriveReservationState(
  status: string,
  checkInDate: Dateish,
  checkOutDate: Dateish,
  businessDate: Dateish
): ReservationDerivedState {
  const bd = dayMs(businessDate)
  // No business date to compare against → fall back to the stored status.
  if (Number.isNaN(bd)) return status as ReservationDerivedState
  if (status === "RESERVED") return dayMs(checkInDate) === bd ? "DUE_IN" : "RESERVED"
  if (status === "IN_HOUSE") return dayMs(checkOutDate) === bd ? "DUE_OUT" : "IN_HOUSE"
  return status as ReservationDerivedState
}

const LABELS: Record<string, string> = {
  RESERVED: "Reserved",
  DUE_IN: "Due In",
  IN_HOUSE: "In-House",
  DUE_OUT: "Due Out",
  CHECKED_OUT: "Checked Out",
  NO_SHOW: "No Show",
  CANCELLED: "Cancelled",
}

export function reservationStateLabel(state: string): string {
  return LABELS[state] ?? state.replace(/_/g, " ")
}

// Strict check-in gate: a guest can only be checked in on their arrival day — i.e. when
// the reservation is Due In (arrival = business date). A future arrival is too early; a
// past-arrival that never checked in is handled by Night Audit as a No-Show.
export function canCheckIn(status: string, checkInDate: Dateish, businessDate: Dateish): boolean {
  return status === "RESERVED" && deriveReservationState(status, checkInDate, null, businessDate) === "DUE_IN"
}
