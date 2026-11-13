"use client"

import { addDays, differenceInCalendarDays, format, isEqual, parseISO, startOfDay } from "date-fns"
import { Suspense, useState } from "react"
import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { Check, ChevronLeft, ChevronRight } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useUrlState } from "@/lib/use-url-state"
import { MarkerIconView, bookingBarFill } from "@/components/reservations/booking-marker"
import { MARKER_COLORS, isMarkerColor, isMarkerIcon, type MarkerColor, type MarkerIcon } from "@/lib/booking-markers"
import { useBusinessToday } from "@/hooks/use-business-today"
import { cn } from "@/lib/utils"

// A block's schedule, drawn like the Tape Chart: the same date header (weekday, day, month),
// weekend and today tints, room column, grid cells and bars. One row per pickup; read-only,
// click a bar to open the reservation. Scrolls sideways when the block spans many days.
type Pickup = {
  id: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  primaryGuest?: { firstName?: string; lastName?: string } | null
  assignments?: { room?: { roomNumber?: string } | null; roomType?: { code?: string; name?: string } | null }[]
}

// Window choice (?scheduleDays=7|14|30), 14 by default; the chart shows that many days from the
// block's start and can be paged by a week.
const DAY_OPTIONS = ["7", "14", "30"] as const
type DayOption = (typeof DAY_OPTIONS)[number]
const MIN_COL_PX: Record<DayOption, number> = { "7": 80, "14": 52, "30": 40 }
const LABEL_W = 128 // px, the room column (w-32 on the Tape Chart)

export function GroupScheduleTimeline(props: ScheduleProps) {
  // useUrlState reads the query string, which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <Schedule {...props} />
    </Suspense>
  )
}

type ScheduleProps = {
  startDate: string
  endDate: string
  pickups: Pickup[]
  slug: string
  /** The block's Source, if it has one: its icon and colour mark every pickup. */
  source?: { markerIcon?: string | null; markerColor?: string | null; companyName?: string | null; firstName?: string | null } | null
}

function Schedule({
  startDate,
  pickups,
  slug,
  source,
}: ScheduleProps) {
  const [daysParam, setDaysParam] = useUrlState<DayOption>("scheduleDays", "14", DAY_OPTIONS)
  const [offset, setOffset] = useState(0) // days from the block's start
  const business = useBusinessToday()
  const blockStart = startOfDay(parseISO(startDate))
  const start = addDays(blockStart, offset)
  const totalDays = Number(daysParam)
  const dense = totalDays === 30
  const days = Array.from({ length: totalDays }, (_, i) => addDays(start, i))
  const colTemplate = `repeat(${totalDays}, minmax(${MIN_COL_PX[daysParam]}px, 1fr))`
  const viewEnd = addDays(start, totalDays - 1)
  // Rows with a stay inside the window.
  const visible = pickups.filter((p) => {
    const ci = startOfDay(parseISO(p.checkInDate))
    const co = startOfDay(parseISO(p.checkOutDate))
    return differenceInCalendarDays(co, start) > 0 && differenceInCalendarDays(ci, viewEnd) <= 0
  })

  // Same look as the Tape Chart: a Source's own icon and colour, else the group's (slate).
  const color: MarkerColor = source ? (isMarkerColor(source.markerColor) ? source.markerColor : "sky") : "slate"
  const icon: MarkerIcon = source ? (isMarkerIcon(source.markerIcon) ? source.markerIcon : "Briefcase") : "Users"
  const kindLabel = source ? source.companyName || source.firstName || "Source" : "Group"

  const guestName = (p: Pickup) => `${p.primaryGuest?.firstName ?? ""} ${p.primaryGuest?.lastName ?? ""}`.trim() || "Guest"
  const lastName = (p: Pickup) => p.primaryGuest?.lastName || p.primaryGuest?.firstName || "Guest"
  const roomOf = (p: Pickup) => p.assignments?.[0]?.room?.roomNumber ?? null
  const typeOf = (p: Pickup) => p.assignments?.[0]?.roomType?.name || p.assignments?.[0]?.roomType?.code || ""

  // Weekend columns get a tint and the business date a primary one, as on the Tape Chart.
  const dayTint = (date: Date, header = false) => {
    if (business.ready && isEqual(date, business.today)) return header ? "bg-primary/15 border-b-2 border-b-primary" : "bg-primary/[0.07]"
    const weekend = date.getDay() === 0 || date.getDay() === 6
    return weekend ? (header ? "bg-muted-foreground/15" : "bg-muted-foreground/[0.08]") : ""
  }

  if (pickups.length === 0) {
    return <EmptyState size="inline" className="justify-center px-6 py-8" title="No pickups yet — the schedule fills in as rooms are picked up" />
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2">
      <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(0)}>
        Block start
      </Button>
      <div className="flex items-center">
        <Button variant="ghost" size="icon-sm" onClick={() => setOffset((o) => o - 7)} aria-label="Previous week" title="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setOffset((o) => o + 7)} aria-label="Next week" title="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {format(start, "d MMM")} – {format(viewEnd, "d MMM yyyy")}
      </span>
      <div role="group" aria-label="Days shown" className="ml-auto flex border border-border">
        {DAY_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={daysParam === opt}
            onClick={() => setDaysParam(opt)}
            className={cn(
              "h-7 px-2.5 text-xs font-medium tabular-nums transition-colors not-first:border-l not-first:border-border pointer-coarse:min-h-11",
              daysParam === opt ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {opt} days
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      {toolbar}
      <div className="overflow-auto border-t border-border bg-card">
        <div className="w-max min-w-full">
          {/* Date header */}
          <div className="sticky top-0 z-30 flex border-b border-border bg-muted">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-muted p-2 text-sm font-semibold text-foreground shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
              style={{ width: LABEL_W }}
            >
              Rooms
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: colTemplate }}>
              {days.map((d) => (
                <div key={d.toISOString()} className={cn("border-r border-border p-1 text-center", dayTint(d, true))}>
                  <div className={cn("font-semibold uppercase text-muted-foreground", dense ? "text-[10px]" : "text-[11px] tracking-wider")}>{format(d, dense ? "EEEEE" : "EEE")}</div>
                  <div className={cn("text-base font-bold tabular-nums", business.ready && isEqual(d, business.today) ? "text-primary" : "text-foreground")}>
                    {format(d, "d")}
                  </div>
                  <div className="text-[10px] font-medium text-muted-foreground">{format(d, "MMM")}</div>
                </div>
              ))}
            </div>
          </div>

          {visible.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No stays in these dates. Use the arrows or Block start.</p>}
          {/* One row per pickup */}
          {visible.map((p) => {
            const ci = startOfDay(parseISO(p.checkInDate))
            const co = startOfDay(parseISO(p.checkOutDate))
            // Clamp the bar to the block window.
            const startIdx = Math.max(0, differenceInCalendarDays(ci, start))
            const endIdx = Math.min(totalDays, differenceInCalendarDays(co, start))
            const span = Math.max(1, endIdx - startIdx)
            const nights = Math.max(1, differenceInCalendarDays(co, ci))
            const room = roomOf(p)
            return (
              <div key={p.id} className="group flex border-b border-border transition-colors hover:bg-muted/50">
                <div
                  className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r border-border bg-card p-2 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/50"
                  style={{ width: LABEL_W }}
                >
                  <span className={cn("text-sm font-bold leading-tight", room ? "text-foreground" : "text-warning")}>{room ?? "Unassigned"}</span>
                  <span className="truncate text-[11px] font-medium text-muted-foreground">{typeOf(p) || "—"}</span>
                </div>

                <div className="relative grid flex-1 p-1" style={{ gridTemplateColumns: colTemplate }}>
                  {days.map((d, i) => (
                    <div key={i} className={cn("h-14 border-r border-border", dayTint(d))} style={{ gridColumn: i + 1 }} />
                  ))}
                  <Link
                    href={`/e/${slug}/dashboard/reservations/${p.id}`}
                    title={`${guestName(p)} · ${p.status.replace("_", " ")} · ${p.confirmationNo} · ${kindLabel} · ${format(ci, "dd MMM")} → ${format(co, "dd MMM")}`}
                    className={cn(
                      "absolute inset-y-1 left-0 right-0 z-10 mx-0.5 flex flex-col justify-between overflow-hidden border px-1.5 py-1 transition-colors hover:shadow-sm hover:brightness-110",
                      bookingBarFill(p.status, color)
                    )}
                    style={{ gridColumn: `${startIdx + 1} / ${startIdx + 1 + span}` }}
                  >
                    <span className="flex min-w-0 items-center gap-1 text-xs font-bold leading-tight">
                      {p.status === "CHECKED_OUT" ? <Check aria-hidden className="size-3.5 shrink-0" /> : <MarkerIconView name={icon} className="size-3.5 shrink-0" />}
                      <span className="truncate">{lastName(p)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-[10px] opacity-80">
                      <span className="truncate font-mono">#{p.confirmationNo}</span>
                      <span className="shrink-0">{nights} night{nights === 1 ? "" : "s"}</span>
                    </span>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("inline-flex h-4 w-4 items-center justify-center border", MARKER_COLORS[color].solid)}>
            <MarkerIconView name={icon} className="size-3" />
          </span>
          {kindLabel}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-3 border", MARKER_COLORS[color].glass)} />
          Tentative
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-3", MARKER_COLORS[color].outline)} />
          Checked out
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 border border-border bg-muted opacity-60" />
          No-show
        </li>
      </ul>
    </div>
  )
}
