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

// ── Closed bookings ───────────────────────────────────────────────────────────
// Once a booking leaves the live lifecycle it stops being an operational record and
// becomes a historical one, so the front desk gets a deliberately short action list.
// These gates mirror the server's own guards (PATCH /api/reservations/[id]/status and
// POST .../reverse-check-out) so the UI never offers a button the API will reject:
//
//   Cancelled   — reinstate while the arrival is still in the future; edit; view.
//   No-show     — reinstate while the departure hasn't passed yet; edit; view.
//   Checked out — reverse the check-out on the day it happened; view and reprint
//                 folios after that. Never editable — the stay is settled.
//
// Nothing else: no folio postings, no deposits, no housekeeping requests, no
// confirmation letters, no delete.
export function isClosedReservation(status: string): boolean {
  return status === "CANCELLED" || status === "NO_SHOW" || status === "CHECKED_OUT"
}

// Editing is a live-booking operation. A departed stay is financially settled — moving
// its dates, rooms or rates behind an already-closed folio would desync the two. A
// cancelled or no-show booking stays editable because it can still be reinstated.
export function canEditReservation(status: string): boolean {
  return status !== "CHECKED_OUT"
}

// Reinstate = CANCELLED/NO_SHOW → RESERVED. Date-bounded by the stay itself: a cancelled
// booking whose arrival has already come and gone is a fresh booking, not a
// reinstatement; a no-show can only come back while the stay period is still open.
export function canReinstate(
  status: string,
  checkInDate: Dateish,
  checkOutDate: Dateish,
  businessDate: Dateish
): boolean {
  const bd = dayMs(businessDate)
  if (Number.isNaN(bd)) return false
  if (status === "CANCELLED") {
    const arrival = dayMs(checkInDate)
    return !Number.isNaN(arrival) && arrival > bd
  }
  if (status === "NO_SHOW") {
    const departure = dayMs(checkOutDate)
    return !Number.isNaN(departure) && departure >= bd
  }
  return false
}

// Reverse check-out is a same-day correction only: the guest goes back In-House on the
// business date they departed on. Once Night Audit rolls past that day the departure
// belongs to a closed period and the folio is reprint-only.
export function canReverseCheckOut(
  status: string,
  checkOutDate: Dateish,
  businessDate: Dateish,
  checkedOutAt?: Dateish
): boolean {
  if (status !== "CHECKED_OUT") return false
  const bd = dayMs(businessDate)
  if (Number.isNaN(bd)) return false
  // checkedOutAt is the truth when present (it covers early departures); the scheduled
  // departure date is the fallback for legacy rows that never stamped it.
  const departed = checkedOutAt ? dayMs(checkedOutAt) : dayMs(checkOutDate)
  return !Number.isNaN(departed) && departed === bd
}

// Subtle whole-row tint that replaces the old strikethrough: red for cancelled, amber
// for no-show, grey for departed. Deliberately near-invisible at rest — it's a state
// hint on a dense list, not an alert. Returned as `bg-* hover:bg-*` so tailwind-merge
// drops TableRow's default `hover:bg-muted/50` instead of fighting it.
const CLOSED_ROW_TONE: Record<string, string> = {
  CANCELLED: "bg-destructive-muted hover:bg-destructive/[0.09]",
  NO_SHOW: "bg-warning-muted hover:bg-warning/[0.09]",
  CHECKED_OUT: "bg-muted/50 hover:bg-muted",
}

export function reservationRowToneClass(status: string): string {
  return CLOSED_ROW_TONE[status] ?? ""
}
