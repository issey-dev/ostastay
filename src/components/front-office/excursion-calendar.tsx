"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  format,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  startOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isToday,
} from "date-fns"
import { ChevronLeft, ChevronRight, MapPin } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"

type Departure = {
  id: string
  excursionTypeId: string
  excursionType: { id: string; code: string; name: string; pricingMode: string; cutoffHours: number }
  departureDate: string
  departureTime: string
  meetingTime: string | null
  meetingPoint: string | null
  capacity: number
  minCapacity: number | null
  status: string
  bookedHeadcount: number
}

type ViewMode = "day" | "week" | "month"

// The app's 5-slot categorical chart palette (theme.css --chart-1..5), reused here so
// each excursion type gets a stable, theme-aware color without inventing a new one.
// Written as literal classes (not template-interpolated) so Tailwind's compiler
// actually generates them.
const TYPE_COLORS = [
  { dot: "bg-chart-1", border: "border-chart-1" },
  { dot: "bg-chart-2", border: "border-chart-2" },
  { dot: "bg-chart-3", border: "border-chart-3" },
  { dot: "bg-chart-4", border: "border-chart-4" },
  { dot: "bg-chart-5", border: "border-chart-5" },
]

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function dayKey(dateString: string) {
  return format(new Date(dateString), "yyyy-MM-dd")
}

function getRange(view: ViewMode, anchorDate: Date) {
  if (view === "month") {
    return {
      start: startOfWeek(startOfMonth(anchorDate), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(anchorDate), { weekStartsOn: 1 }),
    }
  }
  if (view === "week") {
    return { start: startOfWeek(anchorDate, { weekStartsOn: 1 }), end: endOfWeek(anchorDate, { weekStartsOn: 1 }) }
  }
  return { start: startOfDay(anchorDate), end: startOfDay(anchorDate) }
}

interface ExcursionCalendarProps {
  propertyId: string
  onSelectDeparture: (departureId: string) => void
}

export function ExcursionCalendar({ propertyId, onSelectDeparture }: ExcursionCalendarProps) {
  const isMobile = useIsMobile()
  const [view, setView] = useState<ViewMode>("week")
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [departures, setDepartures] = useState<Departure[]>([])
  const [loading, setLoading] = useState(true)

  const { start: rangeStart, end: rangeEnd } = useMemo(() => getRange(view, anchorDate), [view, anchorDate])

  useEffect(() => {
    if (!propertyId) return
    setLoading(true)
    const from = format(rangeStart, "yyyy-MM-dd")
    const to = format(rangeEnd, "yyyy-MM-dd")
    fetch(`/api/excursions/departures?propertyId=${propertyId}&from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setDepartures(data)
      })
      .finally(() => setLoading(false))
    // rangeStart/rangeEnd are recomputed each render from primitive view/anchorDate — depend
    // on those directly (not the Date objects) so this effect doesn't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, view, anchorDate])

  // Stable color per excursion type, assigned in first-seen order within the visible range.
  const typeColorIndex = useMemo(() => {
    const order = new Map<string, number>()
    for (const d of departures) {
      if (!order.has(d.excursionTypeId)) order.set(d.excursionTypeId, order.size)
    }
    return order
  }, [departures])

  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of departures) {
      if (!seen.has(d.excursionTypeId)) seen.set(d.excursionTypeId, d.excursionType.name)
    }
    return Array.from(seen.entries())
  }, [departures])

  const departuresByDay = useMemo(() => {
    const map = new Map<string, Departure[]>()
    for (const d of departures) {
      const key = dayKey(d.departureDate)
      const list = map.get(key)
      if (list) list.push(d)
      else map.set(key, [d])
    }
    for (const list of map.values()) list.sort((a, b) => a.departureTime.localeCompare(b.departureTime))
    return map
  }, [departures])

  const goPrev = useCallback(() => {
    setAnchorDate((d) => (view === "month" ? subMonths(d, 1) : view === "week" ? subWeeks(d, 1) : subDays(d, 1)))
  }, [view])
  const goNext = useCallback(() => {
    setAnchorDate((d) => (view === "month" ? addMonths(d, 1) : view === "week" ? addWeeks(d, 1) : addDays(d, 1)))
  }, [view])
  const goToday = useCallback(() => setAnchorDate(startOfDay(new Date())), [])

  const headerLabel =
    view === "month"
      ? format(anchorDate, "MMMM yyyy")
      : view === "week"
        ? `${format(rangeStart, "d MMM")} – ${format(rangeEnd, "d MMM yyyy")}`
        : format(anchorDate, "EEEE, d MMM yyyy")

  function chipColor(excursionTypeId: string) {
    const idx = typeColorIndex.get(excursionTypeId) ?? 0
    return TYPE_COLORS[idx % TYPE_COLORS.length]
  }

  function Chip({ d, dense }: { d: Departure; dense: boolean }) {
    const cancelled = d.status === "CANCELLED"
    const overCapacity = d.bookedHeadcount >= d.capacity
    const atRisk = d.minCapacity != null && d.bookedHeadcount < d.minCapacity
    const color = chipColor(d.excursionTypeId)
    return (
      <button
        type="button"
        onClick={() => onSelectDeparture(d.id)}
        className={`w-full text-left rounded-md border-l-4 bg-card border border-border ${color.border} px-2 py-1 hover:bg-muted transition-colors ${dense ? "text-xs" : "text-sm"} ${cancelled ? "opacity-50" : ""}`}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={`font-medium truncate ${cancelled ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {d.departureTime} {d.excursionType.name}
          </span>
        </div>
        {!cancelled && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`${dense ? "text-[10px]" : "text-xs"} ${overCapacity ? "text-warning" : "text-muted-foreground"}`}>
              {d.bookedHeadcount}/{d.capacity} booked
            </span>
            {atRisk && <span className={`${dense ? "text-[10px]" : "text-xs"} text-warning`}>· at risk</span>}
          </div>
        )}
        {cancelled && <p className={`${dense ? "text-[10px]" : "text-xs"} text-muted-foreground mt-0.5`}>Cancelled</p>}
      </button>
    )
  }

  const headerControls = (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={goPrev} aria-label="Previous">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={goToday}>
          Today
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={goNext} aria-label="Next">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <span className="text-sm font-semibold text-foreground ml-2">{headerLabel}</span>
      </div>
      <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
        {(["day", "week", "month"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`px-3 py-1.5 capitalize ${view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )

  const legendRow = legend.length > 0 && (
    <div className="flex flex-wrap gap-3 mb-3 text-xs text-muted-foreground">
      {legend.map(([id, name]) => (
        <span key={id} className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${chipColor(id).dot}`} />
          {name}
        </span>
      ))}
    </div>
  )

  // Small screens: skip the grid entirely and render a chronological agenda list —
  // same instinct as the Reservations tape chart's mobile fallback, a cramped 7-column
  // grid isn't practical on a phone regardless of which view is selected.
  if (isMobile) {
    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    return (
      <div>
        {headerControls}
        {legendRow}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-4">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd")
              const list = departuresByDay.get(key) ?? []
              if (list.length === 0) return null
              return (
                <div key={key}>
                  <p className={`text-xs font-semibold mb-1.5 ${isToday(day) ? "text-primary" : "text-muted-foreground"}`}>
                    {format(day, "EEE, d MMM")}
                  </p>
                  <div className="space-y-1.5">
                    {list.map((d) => (
                      <Chip key={d.id} d={d} dense={false} />
                    ))}
                  </div>
                </div>
              )
            })}
            {days.every((day) => (departuresByDay.get(format(day, "yyyy-MM-dd")) ?? []).length === 0) && (
              <p className="text-sm text-muted-foreground">No departures in this range.</p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (view === "day") {
    const list = departuresByDay.get(format(anchorDate, "yyyy-MM-dd")) ?? []
    return (
      <div>
        {headerControls}
        {legendRow}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departures on this date.</p>
        ) : (
          <div className="space-y-2">
            {list.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelectDeparture(d.id)}
                className={`w-full text-left bg-card p-3 rounded-lg shadow-sm border-l-4 border border-border ${chipColor(d.excursionTypeId).border} hover:bg-muted transition-colors ${d.status === "CANCELLED" ? "opacity-50" : ""}`}
              >
                <p className={`font-bold text-sm ${d.status === "CANCELLED" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {d.departureTime} — {d.excursionType.name}
                </p>
                {d.meetingPoint && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {d.meetingPoint}
                    {d.meetingTime ? ` (${d.meetingTime})` : ""}
                  </p>
                )}
                {d.status === "CANCELLED" ? (
                  <p className="text-xs text-muted-foreground mt-1">Cancelled</p>
                ) : (
                  <p className={`text-xs mt-1 ${d.bookedHeadcount >= d.capacity ? "text-warning" : "text-muted-foreground"}`}>
                    {d.bookedHeadcount}/{d.capacity} booked
                    {d.minCapacity != null && d.bookedHeadcount < d.minCapacity ? " · at risk of not running" : ""}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Week and month share the same 7-column grid — month just pads to full weeks before
  // and after so every visible cell belongs to a complete row.
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
  const maxChipsPerCell = view === "month" ? 3 : 8

  return (
    <div>
      {headerControls}
      {legendRow}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border border-border">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="bg-muted text-center text-xs font-medium text-muted-foreground py-2">
              {label}
            </div>
          ))}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd")
            const list = departuresByDay.get(key) ?? []
            const outside = view === "month" && !isSameMonth(day, anchorDate)
            return (
              <div
                key={key}
                className={`bg-card min-h-[110px] p-1.5 space-y-1 ${outside ? "opacity-40" : ""} ${view === "week" ? "min-h-[220px]" : ""}`}
              >
                <p className={`text-xs font-medium ${isToday(day) ? "text-primary" : "text-foreground"}`}>{format(day, "d")}</p>
                {list.slice(0, maxChipsPerCell).map((d) => (
                  <Chip key={d.id} d={d} dense />
                ))}
                {list.length > maxChipsPerCell && (
                  <p className="text-[10px] text-muted-foreground">+{list.length - maxChipsPerCell} more</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
