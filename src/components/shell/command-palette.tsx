"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useProperty } from "@/components/providers/property-provider"
import { NAV_GROUPS } from "@/components/app-sidebar-nav.config"
import type { Module } from "@/lib/scope"
import { BedDouble, CalendarDays, Contact, Plus, Search, Settings, UserPlus, Store } from "@/components/icons"

// Ctrl+K / ⌘K (and "/" outside a text field) — jump anywhere (DESKTOP_PLAN §3.9, owner-approved):
// pages from the sidebar (same allow-list), a few actions, and a live search over reservations,
// guests and rooms (/api/search, gated per module server-side). Enter opens, ↑/↓ move, Esc closes.
// The header's search button opens it too (OPEN_EVENT).

export const OPEN_COMMAND_PALETTE = "open-command-palette"

type Item = {
  id: string
  group: string
  label: string
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
  href: string
}

type SearchResult = {
  reservations: { id: string; confirmationNo: string; status: string; guest: string; checkInDate: string; checkOutDate: string; room: string | null }[]
  profiles: { upid: string; name: string; type: string }[]
  rooms: { id: string; roomNumber: string; roomType: string | null; reservationId: string | null; guest: string | null }[]
}

const STATUS: Record<string, string> = { RESERVED: "Reserved", IN_HOUSE: "In-house", CHECKED_OUT: "Checked out", CANCELLED: "Cancelled", NO_SHOW: "No-show" }

export function CommandPalette({ allowedModules, prefix, hubHref }: { allowedModules: Module[]; prefix: string; hubHref?: string }) {
  const router = useRouter()
  const { currentProperty } = useProperty()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState("")
  const [results, setResults] = React.useState<SearchResult | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)

  // Open on Ctrl/⌘+K anywhere, "/" when not typing, or the header button's event.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen)
    }
  }, [])

  React.useEffect(() => {
    if (!open) {
      setQ("")
      setResults(null)
      setActive(0)
    }
  }, [open])

  // Debounced search; a newer term aborts the older request.
  React.useEffect(() => {
    const term = q.trim()
    if (term.length < 2 || !currentProperty?.id) {
      setResults(null)
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?propertyId=${encodeURIComponent(currentProperty.id)}&q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        if (res.ok) setResults(await res.json())
      } catch {
        /* aborted or offline — keep the last results */
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, currentProperty?.id])

  const allowed = React.useMemo(() => new Set(allowedModules), [allowedModules])
  const d = `${prefix}/dashboard`

  const items = React.useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase()
    const match = (s: string) => !term || s.toLowerCase().includes(term)

    const actions: Item[] = []
    if (allowed.has("RESERVATIONS")) actions.push({ id: "a-new", group: "Actions", label: "New booking", icon: Plus, href: `${d}/reservations/new` })
    if (allowed.has("FRONT_DESK")) actions.push({ id: "a-walkin", group: "Actions", label: "Walk-in booking", icon: UserPlus, href: `${d}/reservations/new?walkin=1` })
    if (allowed.has("POS")) actions.push({ id: "a-post", group: "Actions", label: "Post a charge", icon: Store, href: `${d}/pos` })
    if (allowed.has("PROFILES")) actions.push({ id: "a-profile", group: "Actions", label: "New guest profile", icon: Contact, href: `${d}/profiles/new` })
    if (hubHref) actions.push({ id: "a-hub", group: "Actions", label: "Setup (Hub)", icon: Settings, href: hubHref })

    const pages: Item[] = NAV_GROUPS.flatMap((g) =>
      g.items
        .filter((i) => !i.module || allowed.has(i.module))
        .map((i) => ({ id: `p-${i.url}`, group: "Pages", label: i.title, hint: g.label, icon: i.icon, href: `${prefix}${i.url}` }))
    )

    const found: Item[] = []
    if (results) {
      for (const r of results.reservations)
        found.push({
          id: `r-${r.id}`,
          group: "Reservations",
          label: `${r.guest || "Guest"} · ${r.confirmationNo}`,
          hint: `${STATUS[r.status] ?? r.status} · ${format(new Date(r.checkInDate), "dd MMM")} → ${format(new Date(r.checkOutDate), "dd MMM")}${r.room ? ` · Room ${r.room}` : ""}`,
          icon: CalendarDays,
          href: `${d}/reservations/${r.id}`,
        })
      for (const p of results.rooms)
        found.push({
          id: `room-${p.id}`,
          group: "Rooms",
          label: `Room ${p.roomNumber}`,
          hint: [p.roomType, p.guest ? `In-house: ${p.guest}` : "Vacant"].filter(Boolean).join(" · "),
          icon: BedDouble,
          href: p.reservationId ? `${d}/reservations/${p.reservationId}` : `${d}/housekeeping`,
        })
      for (const p of results.profiles)
        found.push({ id: `g-${p.upid}`, group: "Guests & companies", label: p.name || p.upid, hint: p.type.replace("_", " ").toLowerCase(), icon: Contact, href: `${d}/profiles/${p.upid}` })
    }

    return [...found, ...actions.filter((a) => match(a.label)), ...pages.filter((p) => match(p.label))]
  }, [q, results, allowed, d, prefix, hubHref])

  React.useEffect(() => setActive(0), [q, results])

  const go = (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    router.push(item.href)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(items[active])
    }
  }

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  let lastGroup = ""
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md" showCloseButton={false} className="gap-0 p-0 sm:top-[15%] sm:translate-y-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search guests, bookings, rooms or pages"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
          />
          {searching && <span className="text-xs text-muted-foreground">Searching…</span>}
        </div>
        <div ref={listRef} id="command-palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-1 sm:max-h-[420px]">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {q.trim().length >= 2 && !searching ? "Nothing found" : "Type a name, booking number or room"}
            </p>
          ) : (
            items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null
              lastGroup = item.group
              const Icon = item.icon
              return (
                <React.Fragment key={item.id}>
                  {header && <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{header}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", i === active && "bg-muted")}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 truncate text-xs text-muted-foreground max-sm:hidden">{item.hint}</span>}
                  </button>
                </React.Fragment>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground max-sm:hidden">
          <span><kbd className="font-sans">↑↓</kbd> move</span>
          <span><kbd className="font-sans">Enter</kbd> open</span>
          <span><kbd className="font-sans">Esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The header's search field look-alike — opens the palette. */
export function CommandPaletteTrigger() {
  const [mac, setMac] = React.useState(false)
  React.useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), [])
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
      className="flex h-8 w-64 items-center gap-2 border border-border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground max-md:hidden lg:w-80"
      aria-label="Search (Ctrl+K)"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search</span>
      <kbd className="font-sans text-xs">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  )
}
