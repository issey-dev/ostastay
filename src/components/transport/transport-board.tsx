"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import type { DateRange } from "react-day-picker"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Ship,
  Plane,
  Download,
  CalendarClock,
  ListChecks,
  Receipt,
  UserCheck,
  X,
  Filter,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { PageHeader } from "@/components/ui/page-header"
import { ActionBar } from "@/components/ui/action-bar"
import { FilterBar } from "@/components/ui/filter-bar"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { ContactLink } from "@/components/ui/contact-link"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProperty } from "@/components/providers/property-provider"
import { useUrlState } from "@/lib/use-url-state"
import { toDateKey, parseDateKey, todayKey } from "@/lib/date-only"
import { toast } from "@/lib/toast"
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, DIRECTION_LABELS, label } from "@/lib/transport/constants"
import { cn } from "@/lib/utils"
import {
  api,
  addDays,
  AttentionBadge,
  BillingStatus,
  BookingStatus,
  DirectionIcon,
  GroupTag,
  ManifestStatus,
  dayLabel,
  flightLabel,
  paxLabel,
  useStaff,
  useTransportConfig,
  type BookingView,
  type ManifestView,
} from "@/components/transport/shared"
import { BookingFormDialog, type BookingPrefill } from "@/components/transport/booking-form-dialog"
import { BookingPanel, type TransportPerms } from "@/components/transport/booking-panel"
import { ManifestPanel } from "@/components/transport/manifest-panel"
import { ManifestFormDialog } from "@/components/transport/manifest-form-dialog"

// The daily Transportation board (section 3.3 of the brief). One day at a time, a compact
// week strip above it, and three views of the same data:
//   Board     — the day's transfers grouped by transport type, with bulk actions
//   Airport   — chronological by flight: guest, pax, contact and meeting notes (the rep's view)
//   Dispatch  — by departure: each boat's passenger list and seats, plus who is unassigned
// Details and every action open in side panels, so the screen itself stays a calm list.
// All view state (date, view, filters) is in the URL. Desktop first; on phones the tables
// become cards and actions move into one menu.

type Board = {
  date: string
  week: { date: string; pickups: number; dropOffs: number; pickupPax: number; dropOffPax: number }[]
  bookings: BookingView[]
  manifests: ManifestView[]
}

type Suggestion = {
  reservationId: string
  confirmationNo: string
  guestName: string
  direction: "PICKUP" | "DROP_OFF"
  serviceDate: string
  pax: number
  groupBlock: { id: string; code: string; name: string } | null
  flightNo: string | null
}

const VIEWS = ["board", "airport", "dispatch"] as const
const DIRS = ["ALL", "PICKUP", "DROP_OFF"] as const

function timeOf(b: BookingView) {
  return b.departureLocal?.time ?? b.flightLocal?.time ?? null
}

export function TransportBoard({ perms }: { perms: TransportPerms }) {
  const { currentProperty } = useProperty()
  const { slug } = useParams<{ slug: string }>()
  const propertyId = currentProperty?.id ?? ""
  const businessToday = currentProperty?.businessDate ? currentProperty.businessDate.slice(0, 10) : todayKey()

  const [date, setDate] = useUrlState<string>("date", "")
  const day = date || businessToday
  const [view, setView] = useUrlState<(typeof VIEWS)[number]>("view", "board", VIEWS)
  const [dir, setDir] = useUrlState<(typeof DIRS)[number]>("dir", "ALL", DIRS)
  const [q, setQ] = useUrlState<string>("q", "")
  const [type, setType] = useUrlState<string>("type", "")
  const [status, setStatus] = useUrlState<string>("status", "")
  const [rep, setRep] = useUrlState<string>("rep", "")
  const [route, setRoute] = useUrlState<string>("route", "")
  const [provider, setProvider] = useUrlState<string>("provider", "")
  const [group, setGroup] = useUrlState<string>("group", "")
  const [attention, setAttention] = useUrlState<string>("attention", "")
  const [unassigned, setUnassigned] = useUrlState<string>("unassigned", "")

  const { config, reload: reloadConfig } = useTransportConfig(propertyId)
  const staff = useStaff(propertyId)
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; disabled?: boolean } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [manifestId, setManifestId] = useState<string | null>(null)
  const [bookingForm, setBookingForm] = useState<{ editing: BookingView | null; prefill?: BookingPrefill | null } | null>(null)
  const [manifestForm, setManifestForm] = useState<{ editing: ManifestView | null; bookingIds?: string[]; direction?: "PICKUP" | "DROP_OFF" } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const filterQs = useMemo(() => {
    const sp = new URLSearchParams()
    if (dir !== "ALL") sp.set("direction", dir)
    if (q) sp.set("q", q)
    if (type) sp.set("transportTypeId", type)
    if (status) sp.set("status", status)
    if (rep) sp.set("airportRepUserId", rep)
    if (route) sp.set("routeId", route)
    if (provider) sp.set("providerId", provider)
    if (group) sp.set("groupBlockId", group)
    if (attention) sp.set("attention", "1")
    if (unassigned) sp.set("unassigned", "1")
    return sp.toString()
  }, [dir, q, type, status, rep, route, provider, group, attention, unassigned])

  const load = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/transport/board?propertyId=${propertyId}&date=${day}${filterQs ? `&${filterQs}` : ""}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError({ message: body.error ?? "Couldn't load the board.", disabled: body.code === "TRANSPORT_NOT_ENABLED" || body.code === "TRANSPORT_ADDON_NOT_ENABLED" })
        return
      }
      setBoard(await res.json())
      setError(null)
    } catch {
      setError({ message: "Couldn't load the board." })
    } finally {
      setLoading(false)
    }
  }, [propertyId, day, filterQs])

  // Typing in the search box shouldn't fire a request per key.
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  useEffect(() => setSelected(new Set()), [day, filterQs])

  const bookings = board?.bookings ?? []
  const manifests = board?.manifests ?? []
  const selectedRows = bookings.filter((b) => selected.has(b.id))
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; code: string; name: string }>()
    bookings.forEach((b) => b.groupBlock && m.set(b.groupBlock.id, b.groupBlock))
    return [...m.values()]
  }, [bookings])

  const activeFilters = [q, type, status, rep, route, provider, group, attention, unassigned].filter(Boolean).length
  const moreFilters = [rep, route, provider, group, attention, unassigned].filter(Boolean).length
  const clearFilters = () => {
    for (const set of [setQ, setType, setStatus, setRep, setRoute, setProvider, setGroup, setAttention, setUnassigned]) set("")
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  // ── Bulk actions ──
  const bulk = async (body: Record<string, unknown>, ok: string) => {
    try {
      const r = await api<{ done: number; failed: { reference: string; guestName: string; error: string }[] }>(`/api/transport/bookings/bulk?propertyId=${propertyId}`, {
        method: "POST",
        json: { ...body, bookingIds: [...selected] },
      })
      if (r.failed.length) toast.warning(`${ok}: ${r.done}. Not done: ${r.failed.map((f) => `${f.guestName} (${f.error})`).join("; ")}`)
      else toast.success(`${ok}: ${r.done}`)
      setSelected(new Set())
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const attachSelected = async (target: string) => {
    if (!target) return
    try {
      await api(`/api/transport/manifests/${target}/bookings?propertyId=${propertyId}`, { method: "POST", json: { action: "ATTACH", bookingIds: [...selected] } })
      toast.success(`${selected.size} booking(s) put on the departure`)
      setSelected(new Set())
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const selectedDirection = selectedRows.length && selectedRows.every((b) => b.direction === selectedRows[0].direction) ? (selectedRows[0].direction as "PICKUP" | "DROP_OFF") : null

  const fromSlots = async () => {
    const directions = dir === "ALL" ? (["PICKUP", "DROP_OFF"] as const) : [dir]
    let created = 0
    try {
      for (const d of directions) {
        const r = await api<{ created: number }>(`/api/transport/manifests/from-slots?propertyId=${propertyId}`, { method: "POST", json: { serviceDate: day, direction: d } })
        created += r.created
      }
      toast.success(created ? `${created} departure(s) created from the routes' times` : "Every route time already has a departure")
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const more = [
    ...(perms.manageManifests ? [{ label: "New departure", icon: Ship, onSelect: () => setManifestForm({ editing: null }) }] : []),
    ...(perms.manageManifests ? [{ label: "Departures from route times", icon: CalendarClock, onSelect: fromSlots }] : []),
    { label: "Suggested transfers", icon: ListChecks, onSelect: () => setSuggestOpen(true) },
    { label: "Export report", icon: Download, onSelect: () => setExportOpen(true) },
  ]

  if (!propertyId) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transportation"
        hint="Pickups and drop-offs by day. Put guests from different reservations on the same departure; warnings never stop you saving. Charges post at Night Audit."
        actions={
          <ActionBar
            secondary={
              perms.manageBookings && (
                <Button onClick={() => setBookingForm({ editing: null })}>
                  <Plus className="mr-2 h-4 w-4" /> New transfer
                </Button>
              )
            }
            more={more}
          />
        }
      />

      {/* Date + week strip */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(day, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DatePicker className="w-44" value={day} onChange={(v) => v && setDate(v === businessToday ? "" : v)} />
          <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(day, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {day !== businessToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate("")}>
              Today
            </Button>
          )}
        </div>
        <div className="grid flex-1 grid-cols-7 border border-border" role="list" aria-label="Week overview">
          {(board?.week ?? []).map((w) => (
            <button
              key={w.date}
              type="button"
              role="listitem"
              onClick={() => setDate(w.date === businessToday ? "" : w.date)}
              aria-current={w.date === day ? "date" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 border-r border-border px-1 py-1.5 text-xs last:border-r-0 hover:bg-muted/50",
                w.date === day && "bg-primary text-primary-foreground hover:bg-primary"
              )}
            >
              <span className="font-medium">{dayLabel(w.date, { weekday: "short", day: "2-digit" })}</span>
              <span className={cn("tabular-nums", w.date !== day && "text-muted-foreground")} title={`${w.pickups} pickups, ${w.dropOffs} drop-offs`}>
                ↓{w.pickups} ↑{w.dropOffs}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* View + filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as (typeof VIEWS)[number])}>
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="airport">Airport rep</TabsTrigger>
              <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={dir} onValueChange={(v) => setDir(v as (typeof DIRS)[number])}>
            <TabsList>
              <TabsTrigger value="ALL">All</TabsTrigger>
              <TabsTrigger value="PICKUP">Pickups</TabsTrigger>
              <TabsTrigger value="DROP_OFF">Drop-offs</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <FilterBar search={{ value: q, onChange: setQ, placeholder: "Guest, reservation, flight, group" }} activeCount={activeFilters} onClear={clearFilters}>
          <OptionSelect
            className="w-40"
            value={type}
            onChange={setType}
            aria-label="Transport type"
            options={[{ value: "", label: "All types" }, ...(config?.types ?? []).map((t) => ({ value: t.id, label: t.name }))]}
          />
          <OptionSelect
            className="w-36"
            value={status}
            onChange={setStatus}
            aria-label="Status"
            options={[{ value: "", label: "Any status" }, ...BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] }))]}
          />
          <Popover>
            <PopoverTrigger render={<Button variant="outline" className="gap-1.5" />}>
              <Filter className="h-4 w-4" /> More filters{moreFilters ? ` (${moreFilters})` : ""}
            </PopoverTrigger>
            <PopoverContent align="start" className="grid w-72 gap-3">
              <OptionSelect value={rep} onChange={setRep} aria-label="Airport rep" options={[{ value: "", label: "Any airport rep" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]} />
              <OptionSelect value={route} onChange={setRoute} aria-label="Route" options={[{ value: "", label: "Any route" }, ...(config?.routes ?? []).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))]} />
              <OptionSelect value={provider} onChange={setProvider} aria-label="Provider" options={[{ value: "", label: "Any provider" }, ...(config?.providers ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
              <OptionSelect value={group} onChange={setGroup} aria-label="Group block" options={[{ value: "", label: "Any group" }, ...groups.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }))]} />
              <Label className="flex items-center justify-between gap-3 font-normal">
                Needs attention only <Switch checked={!!attention} onCheckedChange={(c) => setAttention(c ? "1" : "")} />
              </Label>
              <Label className="flex items-center justify-between gap-3 font-normal">
                Not on a departure only <Switch checked={!!unassigned} onCheckedChange={(c) => setUnassigned(c ? "1" : "")} />
              </Label>
            </PopoverContent>
          </Popover>
        </FilterBar>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 border border-border bg-card p-2 shadow-elevation-1" role="region" aria-label="Bulk actions">
          <span className="px-2 text-sm font-medium">{selected.size} selected</span>
          {perms.manageManifests && selectedDirection && (
            <OptionSelect
              size="sm"
              className="w-56"
              value=""
              placeholder="Put on departure…"
              onChange={attachSelected}
              options={manifests.filter((m) => m.direction === selectedDirection && m.status !== "CANCELLED" && m.status !== "COMPLETED").map((m) => ({ value: m.id, label: `${m.departureLocal.time} · ${m.route.name} (${m.pax}${m.capacity ? `/${m.capacity}` : ""})` }))}
            />
          )}
          {perms.manageManifests && selectedDirection && (
            <Button size="sm" variant="outline" onClick={() => setManifestForm({ editing: null, bookingIds: [...selected], direction: selectedDirection })}>
              <Ship className="mr-1.5 h-4 w-4" /> New departure from selected
            </Button>
          )}
          {perms.manageBookings && (
            <OptionSelect
              size="sm"
              className="w-48"
              value=""
              placeholder="Assign airport rep…"
              onChange={(id) => bulk({ action: "ASSIGN_REP", airportRepUserId: id === "none" ? null : id }, "Airport rep assigned")}
              options={[{ value: "none", label: "Nobody" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          {perms.manageBookings && (
            <OptionSelect
              size="sm"
              className="w-40"
              value=""
              placeholder="Set status…"
              onChange={(s) => s && bulk(s === "CONFIRM_DRAFTS" ? { action: "CONFIRM_DRAFTS" } : { action: "STATUS", status: s }, "Updated")}
              options={[
                { value: "CONFIRM_DRAFTS", label: "Confirm drafts" },
                { value: "COMPLETED", label: "Completed" },
                { value: "NO_SHOW", label: "No-show" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
          )}
          {perms.canBill && (
            <Button size="sm" variant="outline" onClick={() => bulk({ action: "POST" }, "Charges posted")}>
              <Receipt className="mr-1.5 h-4 w-4" /> Post charges
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Content */}
      {error ? (
        error.disabled ? (
          <EmptyState
            icon={Ship}
            title="Transportation is off for this property"
            description="An administrator can switch it on and set up routes and rates in the Hub, under Transportation."
            action={
              <Button variant="outline" onClick={() => (window.location.href = `/e/${slug}/hub/p/${propertyId}/transportation`)}>
                Open the Hub
              </Button>
            }
          />
        ) : (
          <ErrorState onRetry={load} />
        )
      ) : loading && !board ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : view === "board" ? (
        <BoardView bookings={bookings} selected={selected} onToggle={toggle} onOpen={setBookingId} canSelect={perms.manageBookings || perms.manageManifests || perms.canBill} onNew={perms.manageBookings ? () => setBookingForm({ editing: null }) : undefined} />
      ) : view === "airport" ? (
        <AirportView bookings={bookings} onOpen={setBookingId} />
      ) : (
        <DispatchView manifests={manifests} bookings={bookings} onOpenManifest={setManifestId} onOpenBooking={setBookingId} onNewDeparture={perms.manageManifests ? () => setManifestForm({ editing: null }) : undefined} />
      )}

      <BookingPanel
        bookingId={bookingId}
        onOpenChange={(o) => !o && setBookingId(null)}
        propertyId={propertyId}
        config={config}
        perms={perms}
        dayManifests={manifests}
        onChanged={load}
        onEdit={(b) => setBookingForm({ editing: b })}
        onOpenManifest={(id) => {
          setBookingId(null)
          setManifestId(id)
        }}
      />
      <ManifestPanel
        manifestId={manifestId}
        onOpenChange={(o) => !o && setManifestId(null)}
        propertyId={propertyId}
        perms={perms}
        onChanged={load}
        onEdit={(m) => setManifestForm({ editing: m })}
        onOpenBooking={(id) => {
          setManifestId(null)
          setBookingId(id)
        }}
      />
      <BookingFormDialog
        open={!!bookingForm}
        onOpenChange={(o) => !o && setBookingForm(null)}
        propertyId={propertyId}
        config={config}
        staff={staff}
        editing={bookingForm?.editing ?? null}
        prefill={bookingForm?.prefill}
        canBill={perms.canBill}
        defaultDate={day}
        onSaved={(b) => {
          load()
          reloadConfig()
          setBookingId(b.id)
        }}
      />
      <ManifestFormDialog
        open={!!manifestForm}
        onOpenChange={(o) => !o && setManifestForm(null)}
        propertyId={propertyId}
        config={config}
        editing={manifestForm?.editing ?? null}
        defaults={{ serviceDate: day, direction: manifestForm?.direction ?? (dir === "DROP_OFF" ? "DROP_OFF" : "PICKUP") }}
        bookingIds={manifestForm?.bookingIds}
        onSaved={(m) => {
          setSelected(new Set())
          load()
          setManifestId(m.id)
        }}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} propertyId={propertyId} day={day} />
      <SuggestionsSheet
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        propertyId={propertyId}
        day={day}
        canCreate={perms.manageBookings}
        onCreated={load}
        onBook={(s) => {
          setSuggestOpen(false)
          setBookingForm({
            editing: null,
            prefill: {
              reservation: { id: s.reservationId, confirmationNo: s.confirmationNo, guestName: s.guestName, checkInDate: s.direction === "PICKUP" ? s.serviceDate : "", checkOutDate: s.direction === "DROP_OFF" ? s.serviceDate : "", adults: s.pax, children: 0, infants: 0, groupBlock: s.groupBlock },
              direction: s.direction,
              date: s.serviceDate,
            },
          })
        }}
      />
    </div>
  )
}

// ── Board view: grouped by transport type ───────────────────────────────────────────────

function BoardView({
  bookings,
  selected,
  onToggle,
  onOpen,
  canSelect,
  onNew,
}: {
  bookings: BookingView[]
  selected: Set<string>
  onToggle: (id: string, on: boolean) => void
  onOpen: (id: string) => void
  canSelect: boolean
  onNew?: () => void
}) {
  if (bookings.length === 0) {
    return (
      <EmptyState
        icon={Ship}
        title="No transfers on this day"
        description="Book one, or review the suggested transfers from this week's arrivals and departures."
        action={onNew && <Button onClick={onNew}>New transfer</Button>}
      />
    )
  }
  const groups = new Map<string, BookingView[]>()
  for (const b of [...bookings].sort((a, c) => (timeOf(a) ?? "99").localeCompare(timeOf(c) ?? "99"))) {
    const k = b.transportType?.name ?? "No transport type yet"
    groups.set(k, [...(groups.get(k) ?? []), b])
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([name, rows]) => {
        const allOn = rows.every((r) => selected.has(r.id))
        return (
          <section key={name} className="border border-border bg-card" aria-label={name}>
            <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {canSelect && (
                  <Checkbox className="max-md:hidden" checked={allOn} onCheckedChange={(c) => rows.forEach((r) => onToggle(r.id, !!c))} aria-label={`Select all ${name}`} />
                )}
                {name}
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.length} transfer{rows.length === 1 ? "" : "s"} · {rows.filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + r.pax, 0)} pax
              </span>
            </header>
            <MobileCardList className="p-3">
              {rows.map((b) => (
                <MobileCard
                  key={b.id}
                  tone={b.status === "CANCELLED" || b.status === "NO_SHOW" ? "muted" : undefined}
                  onClick={() => onOpen(b.id)}
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <DirectionIcon direction={b.direction} /> {b.guestName} <GroupTag group={b.groupBlock} />
                    </span>
                  }
                  subtitle={b.reservation ? `${b.reservation.confirmationNo}${b.reservation.roomNumber ? ` · Room ${b.reservation.roomNumber}` : ""}` : "No stay"}
                  badge={<BookingStatus status={b.status} />}
                  meta={[
                    { label: "Time", value: timeOf(b) ?? "—" },
                    { label: "Pax", value: b.pax },
                    { label: "Flight", value: flightLabel(b) || "—" },
                    { label: "Departure", value: b.manifest ? b.manifest.departureLocal.time : "Unassigned" },
                  ]}
                >
                  {b.attention.length > 0 && <AttentionBadge reasons={b.attention} />}
                </MobileCard>
              ))}
            </MobileCardList>
            <div className="overflow-x-auto max-md:hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    {canSelect && <th className="w-10 px-3 py-2" />}
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Guest</th>
                    <th className="px-3 py-2 font-medium">Res. / room</th>
                    <th className="px-3 py-2 text-right font-medium">Pax</th>
                    <th className="px-3 py-2 font-medium">Flight</th>
                    <th className="px-3 py-2 font-medium">Route</th>
                    <th className="px-3 py-2 font-medium">Departure</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => onOpen(b.id)}
                      className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted/50", (b.status === "CANCELLED" || b.status === "NO_SHOW") && "text-muted-foreground")}
                    >
                      {canSelect && (
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(b.id)} onCheckedChange={(c) => onToggle(b.id, !!c)} aria-label={`Select ${b.guestName}`} />
                        </td>
                      )}
                      <td className="px-3 py-2 font-mono tabular-nums">{timeOf(b) ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <DirectionIcon direction={b.direction} className="h-3.5 w-3.5" />
                          <button type="button" className="font-medium hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(b.id) }}>
                            {b.guestName}
                          </button>
                          <GroupTag group={b.groupBlock} />
                          <AttentionBadge reasons={b.attention} compact />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{b.reservation ? `${b.reservation.confirmationNo}${b.reservation.roomNumber ? ` / ${b.reservation.roomNumber}` : ""}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums" title={paxLabel(b)}>
                        {b.pax}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{flightLabel(b) || "—"}</td>
                      <td className="px-3 py-2 text-xs">{b.route ? `${b.route.from.code} → ${b.route.to.code}` : "—"}</td>
                      <td className="px-3 py-2 text-xs">{b.manifest ? <span className="font-mono">{b.manifest.departureLocal.time}</span> : <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="px-3 py-2">
                        <BookingStatus status={b.status} />
                      </td>
                      <td className="px-3 py-2">
                        <BillingStatus status={b.billing.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ── Airport rep view: chronological by flight ────────────────────────────────────────────

function AirportView({ bookings, onOpen }: { bookings: BookingView[]; onOpen: (id: string) => void }) {
  const rows = bookings
    .filter((b) => (b.needsFlight || b.flightNo) && b.status !== "CANCELLED")
    .sort((a, b) => (a.flightAt ?? "9").localeCompare(b.flightAt ?? "9"))
  if (rows.length === 0) return <EmptyState icon={Plane} title="No flights to meet on this day" description="Transfers that include a flight show here, in flight order." />
  return (
    <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Flights in time order">
      {rows.map((b) => (
        <li key={b.id}>
          <button
            type="button"
            onClick={() => onOpen(b.id)}
            className={cn("flex h-full w-full flex-col gap-2 border border-border bg-card p-4 text-left hover:bg-muted/40", b.status === "NO_SHOW" && "opacity-60")}
          >
            <span className="flex items-start justify-between gap-2">
              <span>
                <span className="block font-mono text-lg font-semibold">{b.flightLocal?.time ?? "--:--"}</span>
                <span className="text-xs text-muted-foreground">
                  {b.direction === "PICKUP" ? "Lands" : "Leaves"} · {b.flightNo ?? "No flight no."}
                  {b.airline ? ` · ${b.airline}` : ""}
                  {b.terminal ? ` · ${b.terminal}` : ""}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <BookingStatus status={b.status} />
                <AttentionBadge reasons={b.attention} compact />
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 font-medium">
              <DirectionIcon direction={b.direction} /> {b.guestName} <GroupTag group={b.groupBlock} />
            </span>
            <span className="text-sm">
              {b.pax} pax ({paxLabel(b)}){b.reservation?.roomNumber ? ` · Room ${b.reservation.roomNumber}` : ""}
            </span>
            {b.guestContact && (
              <span onClick={(e) => e.stopPropagation()}>
                <ContactLink type="phone" value={b.guestContact} showIcon className="text-sm" />
              </span>
            )}
            {b.meetingNotes && <span className="text-sm text-muted-foreground">{b.meetingNotes}</span>}
            <span className="mt-auto flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
              <span>{b.airportRep ? `Rep: ${b.airportRep.name}` : "No rep assigned"}</span>
              <span>{b.manifest ? `Boat ${b.manifest.departureLocal.time}${b.route ? ` · ${b.route.to.code}` : ""}` : b.route ? `${b.route.name} · unassigned` : "No route"}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

// ── Dispatch view: by departure ──────────────────────────────────────────────────────────

function DispatchView({
  manifests,
  bookings,
  onOpenManifest,
  onOpenBooking,
  onNewDeparture,
}: {
  manifests: ManifestView[]
  bookings: BookingView[]
  onOpenManifest: (id: string) => void
  onOpenBooking: (id: string) => void
  onNewDeparture?: () => void
}) {
  const unassigned = bookings.filter((b) => !b.manifest && b.status !== "CANCELLED" && b.status !== "NO_SHOW")
  if (manifests.length === 0 && unassigned.length === 0) {
    return (
      <EmptyState
        icon={Ship}
        title="No departures on this day"
        description="Create departures by hand, from the routes' default times (More), or from selected bookings on the Board."
        action={onNewDeparture && <Button onClick={onNewDeparture}>New departure</Button>}
      />
    )
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {manifests.map((m) => (
        <button key={m.id} type="button" onClick={() => onOpenManifest(m.id)} className="flex flex-col gap-2 border border-border bg-card p-4 text-left hover:bg-muted/40">
          <span className="flex items-start justify-between gap-2">
            <span>
              <span className="block font-mono text-lg font-semibold">{m.departureLocal.time}</span>
              <span className="text-xs text-muted-foreground">
                {label(DIRECTION_LABELS, m.direction)} · {m.route.name}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <ManifestStatus status={m.status} />
              {m.attentionCount > 0 && <AttentionBadge reasons={[{ message: `${m.attentionCount} passenger(s) need attention` }]} compact />}
            </span>
          </span>
          <span className="text-sm">
            <span className={cn("font-semibold tabular-nums", m.capacityState === "OVER" && "text-destructive")}>
              {m.pax}
              {m.capacity ? ` / ${m.capacity}` : ""} pax
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {[m.vessel?.name, m.provider?.name].filter(Boolean).join(" · ") || "No vessel yet"}
            </span>
          </span>
          {m.capacity ? (
            <span className="h-1.5 w-full bg-muted" aria-hidden>
              <span className={cn("block h-full", m.capacityState === "OVER" ? "bg-destructive" : m.capacityState === "FULL" ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, (m.pax / m.capacity) * 100)}%` }} />
            </span>
          ) : null}
          <ul className="space-y-0.5 text-sm">
            {m.bookings.slice(0, 6).map((b) => (
              <li key={b.id} className={cn("flex justify-between gap-2", b.status === "NO_SHOW" && "text-muted-foreground line-through")}>
                <span className="truncate">
                  {b.guestName} {b.groupBlock && <span className="font-mono text-[10px] text-muted-foreground">{b.groupBlock.code}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {b.pax}
                  {b.flightNo ? ` · ${b.flightNo}` : ""}
                </span>
              </li>
            ))}
            {m.bookings.length > 6 && <li className="text-xs text-muted-foreground">+{m.bookings.length - 6} more</li>}
            {m.bookings.length === 0 && <li className="text-xs text-muted-foreground">No passengers yet</li>}
          </ul>
        </button>
      ))}
      {unassigned.length > 0 && (
        <div className="flex flex-col gap-2 border border-dashed border-border p-4">
          <span className="flex items-center justify-between">
            <span className="text-sm font-semibold">Not on a departure</span>
            <Badge variant="outline">{unassigned.reduce((s, b) => s + b.pax, 0)} pax</Badge>
          </span>
          <ul className="space-y-1 text-sm">
            {unassigned.map((b) => (
              <li key={b.id}>
                <button type="button" className="flex w-full justify-between gap-2 text-left hover:underline" onClick={() => onOpenBooking(b.id)}>
                  <span className="truncate">
                    <DirectionIcon direction={b.direction} className="mr-1 inline h-3.5 w-3.5" />
                    {b.guestName}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{[b.pax, b.flightLocal?.time].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Select them on the Board to put several on one departure at once.</p>
        </div>
      )}
    </div>
  )
}

// ── Export ───────────────────────────────────────────────────────────────────────────────

function ExportDialog({ open, onOpenChange, propertyId, day }: { open: boolean; onOpenChange: (o: boolean) => void; propertyId: string; day: string }) {
  const [range, setRange] = useState<DateRange | undefined>()
  const [format, setFormat] = useState("pdf")
  useEffect(() => {
    if (open) setRange({ from: parseDateKey(day), to: parseDateKey(day) })
  }, [open, day])
  const from = range?.from ? toDateKey(range.from) : day
  const to = range?.to ? toDateKey(range.to) : from
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Daily Transportation Report</DialogTitle>
          <DialogDescription>Arrivals and departures by transport type, with departures, flights, reps, providers, status and billing. Up to 62 days.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Dates</Label>
            <DateRangePicker value={range} onChange={setRange} />
          </div>
          <div className="grid gap-1.5">
            <Label>Format</Label>
            <OptionSelect
              value={format}
              onChange={setFormat}
              options={[
                { value: "pdf", label: "PDF" },
                { value: "csv", label: "CSV" },
                { value: "xlsx", label: "Excel" },
              ]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              window.location.href = `/api/transport/report?propertyId=${propertyId}&from=${from}&to=${to}&format=${format}`
              onOpenChange(false)
            }}
          >
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Suggestions ──────────────────────────────────────────────────────────────────────────

function SuggestionsSheet({
  open,
  onOpenChange,
  propertyId,
  day,
  canCreate,
  onCreated,
  onBook,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  propertyId: string
  day: string
  canCreate: boolean
  onCreated: () => void
  onBook: (s: Suggestion) => void
}) {
  const [rows, setRows] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const key = (s: Suggestion) => `${s.reservationId}:${s.direction}`
  const load = useCallback(() => {
    setRows(null)
    api<Suggestion[]>(`/api/transport/suggestions?propertyId=${propertyId}&from=${day}&to=${addDays(day, 6)}`)
      .then(setRows)
      .catch((e: Error) => {
        toast.error(e.message)
        setRows([])
      })
  }, [propertyId, day])
  useEffect(() => {
    if (open) {
      setPicked(new Set())
      load()
    }
  }, [open, load])
  const create = async () => {
    setBusy(true)
    try {
      const items = (rows ?? []).filter((s) => picked.has(key(s))).map((s) => ({ reservationId: s.reservationId, direction: s.direction }))
      const r = await api<{ created: number; skipped: number }>(`/api/transport/suggestions?propertyId=${propertyId}`, { method: "POST", json: { items } })
      toast.success(`${r.created} draft transfer(s) created — confirm them on the board`)
      onCreated()
      load()
      setPicked(new Set())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Suggested transfers</SheetTitle>
          <SheetDescription>Arrivals and departures in the next 7 days with no transfer booked. Created as drafts — nothing is confirmed until you confirm it.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {rows === null ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState icon={ListChecks} title="Nothing to suggest" description="Every arrival and departure this week has a transfer, or none is needed." size="inline" />
          ) : (
            <>
              <ul className="divide-y divide-border border border-border">
                {rows.map((s) => (
                  <li key={key(s)} className="flex items-center gap-3 p-3 text-sm">
                    {canCreate && (
                      <Checkbox
                        checked={picked.has(key(s))}
                        onCheckedChange={(c) =>
                          setPicked((p) => {
                            const n = new Set(p)
                            if (c) n.add(key(s))
                            else n.delete(key(s))
                            return n
                          })
                        }
                        aria-label={`Suggest ${s.guestName}`}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium">
                        <DirectionIcon direction={s.direction} className="h-3.5 w-3.5" /> {s.guestName} <GroupTag group={s.groupBlock} />
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {label(DIRECTION_LABELS, s.direction)} · {dayLabel(s.serviceDate)} · {s.confirmationNo} · {s.pax} pax{s.flightNo ? ` · ${s.flightNo}` : ""}
                      </span>
                    </span>
                    {canCreate && (
                      <Button variant="ghost" size="sm" onClick={() => onBook(s)}>
                        Book
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {canCreate && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(rows.map(key)))}>
                    Select all {rows.length}
                  </Button>
                  <Button size="sm" disabled={!picked.size || busy} onClick={create}>
                    <UserCheck className="mr-1.5 h-4 w-4" /> Create {picked.size || ""} draft{picked.size === 1 ? "" : "s"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
