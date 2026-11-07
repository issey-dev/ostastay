import { describe, expect, it } from "vitest"
import {
  CHORD_KEY,
  FRONT_DESK_KEYS,
  GO_TO_TARGETS,
  RESERVED_GLOBAL_KEYS,
  SHORTCUTS,
  SHORTCUT_GROUP_ORDER,
  canUseSingleKey,
  chordTarget,
  isTypingTarget,
} from "@/lib/shortcuts"
import { reservationActions } from "@/lib/palette-actions"
import { NAV_GROUPS } from "@/components/app-sidebar-nav.config"
import type { Module } from "@/lib/scope"

// UX round 2 (8.9.0): keyboard shortcuts. The list is data (src/lib/shortcuts.ts) so the cheat
// sheet, the key handlers and the Operations guide cannot drift; these tests keep it honest and
// pin the safety rules (nothing destructive on a key, nothing taken away from typing).

const key = (over: Partial<Parameters<typeof canUseSingleKey>[0]> = {}) => ({
  key: "j",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  defaultPrevented: false,
  target: { tagName: "BODY" },
  ...over,
})

describe("shortcut list", () => {
  it("gives every 'go to' page its own letter, and never one that is already taken", () => {
    const letters = GO_TO_TARGETS.map((t) => t.key)
    expect(new Set(letters).size).toBe(letters.length)
    for (const l of letters) {
      expect(l).toHaveLength(1)
      expect(RESERVED_GLOBAL_KEYS as readonly string[]).not.toContain(l)
    }
    expect(RESERVED_GLOBAL_KEYS as readonly string[]).toContain(CHORD_KEY)
  })

  it("only points at real sidebar pages, behind the same module the sidebar uses", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    for (const t of GO_TO_TARGETS) {
      const item = items.find((i) => i.url === t.url)
      expect(item, `${t.label} (${t.url}) is not a sidebar page`).toBeDefined()
      expect(item?.module, `${t.label} is gated by a different module than the sidebar`).toBe(t.module)
    }
  })

  it("has unique ids, a known group and at least one key for every entry", () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SHORTCUTS) {
      expect(SHORTCUT_GROUP_ORDER).toContain(s.group)
      expect(s.keys.length).toBeGreaterThan(0)
      expect(s.label.length).toBeGreaterThan(2)
    }
  })

  it("lists every Front Desk key once, and none collides with a global one", () => {
    const keys = FRONT_DESK_KEYS.map((k) => k.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(RESERVED_GLOBAL_KEYS as readonly string[]).not.toContain(k)
  })

  it("has no key for no-show, cancel or void — they stay behind a menu and a confirmation", () => {
    const text = SHORTCUTS.map((s) => s.label.toLowerCase()).join(" | ")
    expect(text).not.toMatch(/no-show|cancel|void/)
  })

  it("says check-out always asks first", () => {
    const co = FRONT_DESK_KEYS.find((k) => k.key === "o")
    expect(co?.label.toLowerCase()).toContain("asks first")
  })
})

describe("go-to chords", () => {
  const some = new Set<Module>(["FRONT_DESK", "POS"])

  it("jumps to a page the person may open, whatever the letter's case", () => {
    expect(chordTarget("f", some)?.url).toBe("/dashboard/front-office")
    expect(chordTarget("F", some)?.url).toBe("/dashboard/front-office")
    expect(chordTarget("p", some)?.label).toBe("Fast Post")
  })

  it("does nothing for a page the person's role cannot open, or an unknown letter", () => {
    expect(chordTarget("w", some)).toBeUndefined() // Cashiering
    expect(chordTarget("z", some)).toBeUndefined()
    expect(chordTarget("f", [])).toBeUndefined()
  })
})

describe("never takes the keyboard away", () => {
  it("lets a single letter act only when nothing else owns the key press", () => {
    expect(canUseSingleKey(key(), false)).toBe(true)
    expect(canUseSingleKey(key({ ctrlKey: true }), false)).toBe(false)
    expect(canUseSingleKey(key({ metaKey: true }), false)).toBe(false)
    expect(canUseSingleKey(key({ altKey: true }), false)).toBe(false)
    expect(canUseSingleKey(key({ repeat: true }), false)).toBe(false)
    expect(canUseSingleKey(key({ defaultPrevented: true }), false)).toBe(false)
    expect(canUseSingleKey(key(), true)).toBe(false) // a window is open
  })

  it("treats inputs, text areas, selects, editable text and combo boxes as typing", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isTypingTarget({ tagName })).toBe(true)
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: "DIV", getAttribute: (n: string) => (n === "role" ? "combobox" : null) })).toBe(true)
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false)
    expect(isTypingTarget({ tagName: "BODY" })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(canUseSingleKey(key({ target: { tagName: "INPUT" } }), false)).toBe(false)
  })
})

describe("what the palette offers for a booking", () => {
  const BD = "2026-08-01"
  const all = new Set<Module>(["FRONT_DESK", "RESERVATIONS", "POS", "CASHIERING"])
  const base = { dashboardBase: "/e/veyo/dashboard", businessDate: BD }
  const ids = (a: { id: string }[]) => a.map((x) => x.id)

  const dueIn = { id: "r1", status: "RESERVED", checkInDate: "2026-08-01", checkOutDate: "2026-08-04", room: null as string | null }
  const inHouse = { id: "r2", status: "IN_HOUSE", checkInDate: "2026-07-30", checkOutDate: "2026-08-03", room: "204" }

  it("offers 'Assign room & check in' first when a due-in booking has no room, else 'Check in'", () => {
    const none = reservationActions(dueIn, { ...base, allowed: all })
    expect(none[0]).toMatchObject({ id: "check-in", label: "Assign room & check in", href: "/e/veyo/dashboard/front-office?checkin=r1" })
    const withRoom = reservationActions({ ...dueIn, room: "101" }, { ...base, allowed: all })
    expect(withRoom[0]).toMatchObject({ id: "check-in", label: "Check in" })
  })

  it("does not offer check-in for a future arrival, or when the business date is unknown", () => {
    expect(ids(reservationActions({ ...dueIn, checkInDate: "2026-08-05" }, { ...base, allowed: all }))).not.toContain("check-in")
    expect(ids(reservationActions(dueIn, { ...base, businessDate: null, allowed: all }))).not.toContain("check-in")
  })

  it("offers folio, a charge to the room, move room and check-out for an in-house guest", () => {
    const a = reservationActions(inHouse, { ...base, allowed: all })
    expect(ids(a)).toEqual(["folio", "post", "move", "check-out", "view"])
    expect(a.find((x) => x.id === "post")?.href).toBe("/e/veyo/dashboard/pos?reservation=r2&room=204")
    expect(a.find((x) => x.id === "check-out")?.href).toBe("/e/veyo/dashboard/front-office?checkout=r2")
    expect(a.find((x) => x.id === "check-out")?.hint?.toLowerCase()).toContain("confirm")
  })

  it("offers only 'open the booking' once the stay is over, cancelled or a no-show", () => {
    for (const status of ["CHECKED_OUT", "CANCELLED", "NO_SHOW"]) {
      expect(ids(reservationActions({ ...inHouse, status }, { ...base, allowed: all }))).toEqual(["view"])
    }
  })

  it("follows the person's modules — no front desk, no check-in / check-out / folio / move; no POS, no charge", () => {
    const noDesk = new Set<Module>(["RESERVATIONS", "POS"])
    expect(ids(reservationActions(inHouse, { ...base, allowed: noDesk }))).toEqual(["post", "view"])
    expect(ids(reservationActions(dueIn, { ...base, allowed: noDesk }))).toEqual(["view"])
    const noPos = new Set<Module>(["FRONT_DESK", "RESERVATIONS"])
    expect(ids(reservationActions(inHouse, { ...base, allowed: noPos }))).not.toContain("post")
  })

  it("never offers a no-show, cancel or void", () => {
    for (const res of [dueIn, inHouse]) {
      for (const a of reservationActions(res, { ...base, allowed: all })) {
        expect(`${a.id} ${a.label}`.toLowerCase()).not.toMatch(/no-show|cancel|void/)
      }
    }
  })
})
