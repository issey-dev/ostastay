import type { Module } from "@/lib/scope"

// THE list of keyboard shortcuts (UX round 2, 8.9.0). The cheat sheet (press ?), the key
// handlers and the Operations guide page (/docs/operations/keyboard-shortcuts) all read this,
// so a shortcut cannot exist in one and not the others. tests/business-rules/shortcuts.test.ts
// keeps it honest: no two shortcuts share a key, every "go to" target is a real sidebar page.
//
// Ground rules (DECISIONS 2026-11-07, owner: "existing functionality must not stop"):
//  - Single-letter keys only act when nothing is focused — never while typing, never with a
//    dialog open, never with Ctrl / ⌘ / Alt held — so a browser or typing shortcut is never
//    taken away. Ctrl+K, "/" and Ctrl+B keep working exactly as before.
//  - A person can switch the single-letter keys off (cheat sheet → "Quick keys"); Ctrl+K and
//    "?" always work.
//  - Nothing destructive is one keystroke: check-out asks first, no-show / void / cancel have
//    no key at all.

export type ShortcutGroup = "Everywhere" | "Go to a page" | "Search and commands" | "Front Desk lists"

export type ShortcutDoc = {
  id: string
  /** Keys in the order they are pressed, as shown on the cap ("g" then "f"). */
  keys: string[]
  /** "then" between keys (g, f) · "+" for a held combination (Ctrl + K) · "or" for alternatives. */
  join: "then" | "+" | "or"
  label: string
  group: ShortcutGroup
}

/** `g` then a letter — jump to a sidebar page. `url` is the sidebar item's url, so the test can
 *  prove every target exists; `module` gates it exactly like the sidebar does. */
export const GO_TO_TARGETS = [
  { key: "d", label: "Dashboard", url: "/dashboard/overview", module: "DASHBOARD" },
  { key: "f", label: "Front Desk", url: "/dashboard/front-office", module: "FRONT_DESK" },
  { key: "r", label: "Reservations", url: "/dashboard/reservations", module: "RESERVATIONS" },
  { key: "t", label: "Tape Chart", url: "/dashboard/reservations/tape-chart", module: "TAPE_CHART" },
  { key: "a", label: "Availability", url: "/dashboard/availability", module: "AVAILABILITY" },
  { key: "b", label: "Group Blocks", url: "/dashboard/groups", module: "GROUP_BLOCKS" },
  { key: "c", label: "Client Relations", url: "/dashboard/profiles", module: "PROFILES" },
  { key: "h", label: "Housekeeping", url: "/dashboard/housekeeping", module: "HOUSEKEEPING" },
  { key: "m", label: "Maintenance", url: "/dashboard/maintenance", module: "MAINTENANCE" },
  { key: "p", label: "Fast Post", url: "/dashboard/pos", module: "POS" },
  { key: "e", label: "Excursions", url: "/dashboard/excursions", module: "EXCURSIONS" },
  { key: "s", label: "Spa", url: "/dashboard/spa", module: "SPA" },
  { key: "x", label: "Transportation", url: "/dashboard/transportation", module: "TRANSPORTATION" },
  { key: "v", label: "Revenue", url: "/dashboard/revenue", module: "REVENUE" },
  { key: "w", label: "Cashiering", url: "/dashboard/cashiering", module: "CASHIERING" },
  { key: "y", label: "Debtors", url: "/dashboard/debtors", module: "DEBTORS" },
  { key: "n", label: "Night Audit", url: "/dashboard/financials/night-audit", module: "NIGHT_AUDIT" },
  { key: "o", label: "Daily Reports", url: "/dashboard/reports", module: "REPORTS" },
  { key: "l", label: "Activity Log", url: "/dashboard/activity-log", module: "ACTIVITY_LOG" },
] as const satisfies readonly { key: string; label: string; url: string; module: Module }[]

export type GoToTarget = (typeof GO_TO_TARGETS)[number]

/** The key that starts a "go to" chord. */
export const CHORD_KEY = "g"
/** How long the second key of a chord may take, in ms. */
export const CHORD_TIMEOUT_MS = 1500

/** The page a chord letter leads to, if this person may open it. */
export function chordTarget(key: string, allowed: ReadonlySet<Module> | readonly Module[]): GoToTarget | undefined {
  const has = (m: Module) => (allowed instanceof Set ? allowed.has(m) : (allowed as readonly Module[]).includes(m))
  const target = GO_TO_TARGETS.find((t) => t.key === key.toLowerCase())
  return target && has(target.module) ? target : undefined
}

/** Front Desk list keys. Tabs are numbered in the order they appear on screen. */
export const FRONT_DESK_TAB_ORDER = ["arrivals", "inhouse", "roommoves", "departures"] as const

export const FRONT_DESK_KEYS = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open the selected booking" },
  { key: "c", label: "Check in (Arrivals) — opens the check-in steps; picks a room first if there is none" },
  { key: "o", label: "Check out (In-House and Departures) — always asks first" },
  { key: "f", label: "Open the folio" },
  { key: "a", label: "Assign a room (Arrivals without a room)" },
  { key: "m", label: "Move room (In-House)" },
  { key: "1", label: "Arrivals tab" },
  { key: "2", label: "In-House tab" },
  { key: "3", label: "Room moves tab" },
  { key: "4", label: "Departures tab" },
  { key: "Esc", label: "Clear the selected row" },
] as const

/** Keys that are claimed by something else and must never be given to a new shortcut. */
export const RESERVED_GLOBAL_KEYS = ["?", "/", "g"] as const

export const SHORTCUTS: ShortcutDoc[] = [
  { id: "palette", keys: ["Ctrl", "K"], join: "+", label: "Search and commands (⌘ K on a Mac)", group: "Everywhere" },
  { id: "palette-slash", keys: ["/"], join: "+", label: "Search and commands, when you are not typing", group: "Everywhere" },
  { id: "cheat-sheet", keys: ["?"], join: "+", label: "This list of shortcuts", group: "Everywhere" },
  { id: "sidebar", keys: ["Ctrl", "B"], join: "+", label: "Show or hide the menu", group: "Everywhere" },
  { id: "esc", keys: ["Esc"], join: "+", label: "Close a window, or step back out of a list of actions", group: "Everywhere" },

  ...GO_TO_TARGETS.map<ShortcutDoc>((t) => ({
    id: `go-${t.key}`,
    keys: [CHORD_KEY, t.key],
    join: "then",
    label: t.label,
    group: "Go to a page",
  })),

  { id: "pal-move", keys: ["↑", "↓"], join: "or", label: "Move through the results", group: "Search and commands" },
  { id: "pal-open", keys: ["Enter"], join: "+", label: "Open the highlighted result", group: "Search and commands" },
  { id: "pal-actions", keys: ["Tab", "→"], join: "or", label: "Show what you can do with a booking (check in, check out, folio, post a charge, move room)", group: "Search and commands" },
  { id: "pal-back", keys: ["Esc"], join: "+", label: "Back from a booking's actions to the results", group: "Search and commands" },

  ...FRONT_DESK_KEYS.map<ShortcutDoc>((k) => ({
    id: `fd-${k.key}`,
    keys: [k.key],
    join: "+",
    label: k.label,
    group: "Front Desk lists",
  })),
]

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = ["Everywhere", "Go to a page", "Search and commands", "Front Desk lists"]

// ── Safety checks shared by every handler ────────────────────────────────────────────

type TargetLike = { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null }

/** True when the key press belongs to something the person is typing or choosing in.
 *  Takes `unknown` so a DOM event's `target` (an EventTarget) can be passed straight in. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false
  const t = target as TargetLike
  if (t.isContentEditable) return true
  const tag = (t.tagName ?? "").toUpperCase()
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  const role = t.getAttribute?.("role")
  return role === "textbox" || role === "combobox" || role === "listbox" || role === "searchbox" || role === "spinbutton"
}

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat?: boolean; defaultPrevented?: boolean; target?: unknown }

/**
 * May a single-letter shortcut act on this key press? Only when no modifier is held, the key
 * is not auto-repeating, nothing is being typed into, and no window is open on top. The caller
 * passes `dialogOpen` (a DOM question) so this stays testable without a browser.
 */
export function canUseSingleKey(e: KeyLike, dialogOpen: boolean): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return false
  if (dialogOpen) return false
  return !isTypingTarget(e.target)
}
