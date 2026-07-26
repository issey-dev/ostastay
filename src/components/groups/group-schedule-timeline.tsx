"use client"

import { differenceInCalendarDays, format, parseISO } from "date-fns"
import Link from "next/link"

// A compact tape-chart for a group block: one row per pickup, a bar spanning the
// guest's stay across the block's date range. Read-only, click a bar to open the
// reservation. Horizontally scrollable when the block spans many days.
type Pickup = {
  id: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  primaryGuest?: { firstName?: string; lastName?: string } | null
  assignments?: { room?: { roomNumber?: string } | null; roomType?: { code?: string } | null }[]
}

const DAY_W = 40 // px per day
const LABEL_W = 176 // px for the left name column

// Bar tone by reservation state — mirrors the app's status colour language.
const BAR_TONE: Record<string, string> = {
  RESERVED: "bg-info/80 hover:bg-info text-info-foreground",
  IN_HOUSE: "bg-success/80 hover:bg-success text-success-foreground",
  CHECKED_OUT: "bg-muted-foreground/60 hover:bg-muted-foreground text-background",
  NO_SHOW: "bg-warning/80 hover:bg-warning text-warning-foreground",
  CANCELLED: "bg-destructive/70 hover:bg-destructive text-destructive-foreground line-through",
}

export function GroupScheduleTimeline({
  startDate,
  endDate,
  pickups,
  slug,
}: {
  startDate: string
  endDate: string
  pickups: Pickup[]
  slug: string
}) {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1)
  const days = Array.from({ length: totalDays }, (_, i) => new Date(start.getTime() + i * 86_400_000))

  const guestName = (p: Pickup) => `${p.primaryGuest?.firstName ?? ""} ${p.primaryGuest?.lastName ?? ""}`.trim() || "Guest"
  const roomLabel = (p: Pickup) => p.assignments?.[0]?.room?.roomNumber || p.assignments?.[0]?.roomType?.code || "TBA"

  if (pickups.length === 0) {
    return <p className="text-sm text-muted-foreground px-6 py-8 text-center">No pickups yet — the schedule fills in as rooms are picked up.</p>
  }

  return (
    <div className="flex border-t border-border">
      {/* Fixed left column: guest + room */}
      <div className="shrink-0 border-r border-border bg-muted/30" style={{ width: LABEL_W }}>
        <div className="h-10 border-b border-border" />
        {pickups.map((p) => (
          <div key={p.id} className="h-11 border-b border-border px-3 flex flex-col justify-center">
            <span className="text-sm font-medium truncate leading-tight">{guestName(p)}</span>
            <span className="text-[11px] text-muted-foreground truncate">{roomLabel(p)}</span>
          </div>
        ))}
      </div>

      {/* Scrollable timeline track */}
      <div className="overflow-x-auto flex-1">
        <div style={{ minWidth: totalDays * DAY_W }}>
          {/* Date axis */}
          <div className="h-10 border-b border-border flex">
            {days.map((d, i) => {
              const weekend = d.getDay() === 0 || d.getDay() === 6
              return (
                <div
                  key={i}
                  className={`shrink-0 border-r border-border/60 flex flex-col items-center justify-center ${weekend ? "bg-muted/40" : ""}`}
                  style={{ width: DAY_W }}
                >
                  <span className="text-[10px] text-muted-foreground leading-none">{format(d, "EEEEE")}</span>
                  <span className="text-xs font-medium leading-tight">{format(d, "d")}</span>
                </div>
              )
            })}
          </div>

          {/* One row per pickup */}
          {pickups.map((p) => {
            const ci = parseISO(p.checkInDate)
            const co = parseISO(p.checkOutDate)
            // Clamp the bar to the block window.
            const startIdx = Math.max(0, differenceInCalendarDays(ci, start))
            const endIdx = Math.min(totalDays, differenceInCalendarDays(co, start))
            const span = Math.max(1, endIdx - startIdx)
            const left = startIdx * DAY_W
            const width = span * DAY_W
            return (
              <div key={p.id} className="h-11 border-b border-border relative">
                {/* Weekend shading behind the bar */}
                {days.map((d, i) => (
                  (d.getDay() === 0 || d.getDay() === 6) ? (
                    <div key={i} className="absolute top-0 bottom-0 bg-muted/30" style={{ left: i * DAY_W, width: DAY_W }} />
                  ) : null
                ))}
                <Link
                  href={`/e/${slug}/dashboard/reservations/${p.id}`}
                  title={`${guestName(p)} · ${format(ci, "dd MMM")} → ${format(co, "dd MMM")}`}
                  className={`absolute top-1.5 bottom-1.5 rounded-md px-2 flex items-center text-[11px] font-medium shadow-sm transition-colors ${BAR_TONE[p.status] ?? BAR_TONE.RESERVED}`}
                  style={{ left: left + 2, width: width - 4 }}
                >
                  <span className="truncate">{guestName(p)}</span>
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
