"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  format, addDays, addWeeks, addMonths, subDays, subWeeks, subMonths,
  startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIsMobile } from "@/hooks/use-mobile"

type Participant = {
  reservation: { primaryGuest: { firstName: string; lastName: string | null } } | null
  walkInGuestName: string | null
  therapist: { id: string; displayName: string } | null
}
type SpaAppt = {
  id: string
  appointmentDate: string
  startTime: string
  treatmentEndTime: string
  appointmentStatus: string
  folioId: string | null
  treatment: { id: string; name: string }
  room: { id: string; name: string } | null
  participants: Participant[]
}
type Therapist = { id: string; displayName: string }
type ViewMode = "day" | "week" | "month"

// Same 5-slot categorical palette the Excursions calendar uses, so the two schedules read
// as one family. Here a stable colour is keyed by THERAPIST (this schedule is organised by
// therapist), assigned in first-seen order.
const COLORS = [
  { dot: "bg-chart-1", border: "border-chart-1" },
  { dot: "bg-chart-2", border: "border-chart-2" },
  { dot: "bg-chart-3", border: "border-chart-3" },
  { dot: "bg-chart-4", border: "border-chart-4" },
  { dot: "bg-chart-5", border: "border-chart-5" },
]
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const dayKey = (s: string) => format(new Date(s), "yyyy-MM-dd")

function getRange(view: ViewMode, anchor: Date) {
  if (view === "month") return { start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }) }
  if (view === "week") return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) }
  return { start: startOfDay(anchor), end: startOfDay(anchor) }
}

const guestName = (a: SpaAppt) => {
  const p = a.participants[0]
  if (!p) return "Guest"
  if (p.reservation) return `${p.reservation.primaryGuest.firstName} ${p.reservation.primaryGuest.lastName ?? ""}`.trim()
  return p.walkInGuestName ?? "Walk-in"
}
const therapistOf = (a: SpaAppt) => a.participants.map((p) => p.therapist?.id).find(Boolean) ?? null
const therapistLabel = (a: SpaAppt) => {
  const names = [...new Set(a.participants.map((p) => p.therapist?.displayName).filter(Boolean))]
  return names.join(", ")
}

export function SpaSchedule({ propertyId, onSelectAppointment }: { propertyId: string; onSelectAppointment?: (a: SpaAppt) => void }) {
  const isMobile = useIsMobile()
  const [view, setView] = useState<ViewMode>("week")
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [therapists, setTherapists] = useState<Therapist[]>([])
  const [therapistId, setTherapistId] = useState<string>("") // "" = all
  const [appts, setAppts] = useState<SpaAppt[]>([])
  const [loading, setLoading] = useState(true)

  const { start: rangeStart, end: rangeEnd } = useMemo(() => getRange(view, anchorDate), [view, anchorDate])

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/spa/therapists?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTherapists(d.map((t: Therapist) => ({ id: t.id, displayName: t.displayName }))) })
      .catch(() => {})
  }, [propertyId])

  useEffect(() => {
    if (!propertyId) return
    setLoading(true)
    const qs = new URLSearchParams({ propertyId, from: format(rangeStart, "yyyy-MM-dd"), to: format(rangeEnd, "yyyy-MM-dd") })
    if (therapistId) qs.set("therapistId", therapistId)
    fetch(`/api/spa/appointments?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setAppts(d) })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, view, anchorDate, therapistId])

  const colorIndex = useMemo(() => {
    const order = new Map<string, number>()
    for (const a of appts) { const t = therapistOf(a); if (t && !order.has(t)) order.set(t, order.size) }
    return order
  }, [appts])
  const chipColor = (a: SpaAppt) => COLORS[(colorIndex.get(therapistOf(a) ?? "") ?? 0) % COLORS.length]

  const byDay = useMemo(() => {
    const map = new Map<string, SpaAppt[]>()
    for (const a of appts) {
      const k = dayKey(a.appointmentDate)
      const l = map.get(k); if (l) l.push(a); else map.set(k, [a])
    }
    for (const l of map.values()) l.sort((a, b) => a.startTime.localeCompare(b.startTime))
    return map
  }, [appts])

  const goPrev = useCallback(() => setAnchorDate((d) => (view === "month" ? subMonths(d, 1) : view === "week" ? subWeeks(d, 1) : subDays(d, 1))), [view])
  const goNext = useCallback(() => setAnchorDate((d) => (view === "month" ? addMonths(d, 1) : view === "week" ? addWeeks(d, 1) : addDays(d, 1))), [view])
  const goToday = useCallback(() => setAnchorDate(startOfDay(new Date())), [])

  const headerLabel = view === "month" ? format(anchorDate, "MMMM yyyy")
    : view === "week" ? `${format(rangeStart, "d MMM")} – ${format(rangeEnd, "d MMM yyyy")}`
    : format(anchorDate, "EEEE, d MMM yyyy")

  const cancelled = (a: SpaAppt) => a.appointmentStatus === "CANCELLED"

  const Chip = ({ a, dense }: { a: SpaAppt; dense: boolean }) => (
    <button
      type="button"
      onClick={() => onSelectAppointment?.(a)}
      className={`w-full text-left rounded-md border-l-4 bg-card border border-border ${chipColor(a).border} px-2 py-1 hover:bg-muted transition-colors ${dense ? "text-xs" : "text-sm"} ${cancelled(a) ? "opacity-50" : ""}`}
    >
      <span className={`font-medium block truncate ${cancelled(a) ? "line-through text-muted-foreground" : "text-foreground"}`}>
        {a.startTime} {a.treatment.name}
      </span>
      <span className={`block truncate text-muted-foreground ${dense ? "text-[10px]" : "text-xs"}`}>
        {guestName(a)}{therapistLabel(a) ? ` · ${therapistLabel(a)}` : ""}
      </span>
    </button>
  )

  const headerControls = (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={goPrev} aria-label="Previous"><ChevronLeft className="w-4 h-4" /></Button>
        <Button type="button" variant="outline" size="sm" onClick={goToday}>Today</Button>
        <Button type="button" variant="outline" size="icon" onClick={goNext} aria-label="Next"><ChevronRight className="w-4 h-4" /></Button>
        <span className="text-sm font-semibold text-foreground ml-2">{headerLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <Select value={therapistId || "all"} onValueChange={(v) => setTherapistId(v === "all" ? "" : (v ?? ""))}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue>{therapistId ? therapists.find((t) => t.id === therapistId)?.displayName : "All therapists"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All therapists</SelectItem>
            {therapists.map((t) => <SelectItem key={t.id} value={t.id}>{t.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
          {(["day", "week", "month"] as const).map((v) => (
            <button key={v} type="button" className={`px-3 py-1.5 capitalize ${view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
      </div>
    </div>
  )

  const legendRow = therapists.length > 0 && (
    <div className="flex flex-wrap gap-3 mb-3 text-xs text-muted-foreground">
      {[...colorIndex.keys()].map((tid) => {
        const t = therapists.find((x) => x.id === tid)
        return <span key={tid} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${COLORS[(colorIndex.get(tid) ?? 0) % COLORS.length].dot}`} />{t?.displayName ?? "—"}</span>
      })}
    </div>
  )

  if (isMobile || view === "day") {
    const days = view === "day" ? [anchorDate] : eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    return (
      <div>
        {headerControls}{legendRow}
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="space-y-4">
            {days.map((day) => {
              const list = byDay.get(format(day, "yyyy-MM-dd")) ?? []
              if (list.length === 0) return null
              return (
                <div key={format(day, "yyyy-MM-dd")}>
                  <p className={`text-xs font-semibold mb-1.5 ${isToday(day) ? "text-primary" : "text-muted-foreground"}`}>{format(day, "EEE, d MMM")}</p>
                  <div className="space-y-1.5">{list.map((a) => <Chip key={a.id} a={a} dense={false} />)}</div>
                </div>
              )
            })}
            {days.every((day) => (byDay.get(format(day, "yyyy-MM-dd")) ?? []).length === 0) && <p className="text-sm text-muted-foreground">No appointments in this range.</p>}
          </div>
        )}
      </div>
    )
  }

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
  const maxChips = view === "month" ? 3 : 8
  return (
    <div>
      {headerControls}{legendRow}
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
          {WEEKDAY_LABELS.map((label) => <div key={label} className="bg-muted text-center text-xs font-medium text-muted-foreground py-2">{label}</div>)}
          {days.map((day) => {
            const list = byDay.get(format(day, "yyyy-MM-dd")) ?? []
            const outside = view === "month" && !isSameMonth(day, anchorDate)
            return (
              <div key={format(day, "yyyy-MM-dd")} className={`bg-card min-h-[110px] p-1.5 space-y-1 ${outside ? "opacity-40" : ""} ${view === "week" ? "min-h-[220px]" : ""}`}>
                <p className={`text-xs font-medium ${isToday(day) ? "text-primary" : "text-foreground"}`}>{format(day, "d")}</p>
                {list.slice(0, maxChips).map((a) => <Chip key={a.id} a={a} dense />)}
                {list.length > maxChips && <p className="text-[10px] text-muted-foreground">+{list.length - maxChips} more</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
