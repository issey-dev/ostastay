import type { Module } from "@/lib/scope"
import { canCheckIn } from "@/lib/reservation-state"

// What the command palette offers for ONE booking when you press Tab / → on it (UX round 2,
// 8.9.0). Pure, so the rules are testable: it mirrors what the Front Desk buttons offer and the
// same module gates the sidebar uses. The server still enforces every permission — the palette
// only decides what is worth showing.
//
// Nothing here acts by itself. Every action is a link into the screen that already does the
// job with its own checks: check-in opens the check-in steps, check-out asks first (and then the
// existing balance / early check-out prompts apply), folio opens the folio panel. There is no
// no-show, cancel or void action on purpose.

export type PaletteActionIcon = "check-in" | "check-out" | "folio" | "post" | "move" | "view"

export type PaletteAction = {
  id: string
  label: string
  hint?: string
  icon: PaletteActionIcon
  href: string
}

export type PaletteReservation = {
  id: string
  status: string
  checkInDate: string
  checkOutDate: string
  /** Room number of the first stay segment, if any. */
  room: string | null
}

export function reservationActions(
  res: PaletteReservation,
  opts: { allowed: ReadonlySet<Module>; businessDate?: string | null; dashboardBase: string }
): PaletteAction[] {
  const { allowed, businessDate, dashboardBase: d } = opts
  const frontDesk = allowed.has("FRONT_DESK")
  const out: PaletteAction[] = []

  if (frontDesk && businessDate && canCheckIn(res.status, res.checkInDate, businessDate)) {
    out.push({
      id: "check-in",
      label: res.room ? "Check in" : "Assign room & check in",
      hint: res.room ? `Room ${res.room}` : "No room yet — you pick one first",
      icon: "check-in",
      href: `${d}/front-office?checkin=${res.id}`,
    })
  }

  if (res.status === "IN_HOUSE") {
    if (frontDesk) {
      out.push({ id: "folio", label: "Folio", icon: "folio", href: `${d}/front-office?folio=${res.id}` })
    }
    if (allowed.has("POS")) {
      const room = res.room ? `&room=${encodeURIComponent(res.room)}` : ""
      out.push({
        id: "post",
        label: "Post a charge",
        hint: res.room ? `Fast Post to room ${res.room}` : "Fast Post",
        icon: "post",
        href: `${d}/pos?reservation=${res.id}${room}`,
      })
    }
    if (frontDesk) {
      out.push({ id: "move", label: "Move room", icon: "move", href: `${d}/front-office?move=${res.id}` })
      out.push({
        id: "check-out",
        label: "Check out",
        hint: "Asks you to confirm first",
        icon: "check-out",
        href: `${d}/front-office?checkout=${res.id}`,
      })
    }
  } else if (frontDesk && res.status === "RESERVED") {
    out.push({ id: "folio", label: "Folio", icon: "folio", href: `${d}/front-office?folio=${res.id}` })
  }

  if (allowed.has("RESERVATIONS")) {
    out.push({ id: "view", label: "Open the booking", icon: "view", href: `${d}/reservations/${res.id}` })
  }
  return out
}
