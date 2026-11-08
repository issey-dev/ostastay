"use client"

import * as React from "react"
import { addDays, format, isSameDay, isToday, startOfWeek } from "date-fns"
import { ChevronLeft, ChevronRight } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Phones: a calendar-style week — month label with previous/next week and Today, then seven
// day cells (weekday, date, how many things that day). Tapping a day selects it; the page
// lists that day under the strip. Used by the Excursions and Spa schedules (the Transportation
// board has its own strip with pickup/drop-off counts). Never wider than the screen.
export function MobileWeekStrip({
  value,
  onChange,
  counts,
  countLabel = "items",
}: {
  /** The selected day. */
  value: Date
  onChange: (day: Date) => void
  /** yyyy-MM-dd → how many items that day (missing = 0). */
  counts: Map<string, number>
  /** For screen readers: "3 departures". */
  countLabel?: string
}) {
  const weekStart = startOfWeek(value, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const label = format(days[0], "MMM") === format(days[6], "MMM") ? format(days[0], "MMMM yyyy") : `${format(days[0], "MMM")} – ${format(days[6], "MMM yyyy")}`
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" aria-label="Previous week" onClick={() => onChange(addDays(value, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="flex-1 text-center text-sm font-semibold">{label}</span>
        <Button type="button" variant="ghost" size="icon" aria-label="Next week" onClick={() => onChange(addDays(value, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {!isToday(value) && (
          <Button type="button" variant="outline" size="sm" className="ml-1" onClick={() => onChange(new Date())}>
            Today
          </Button>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1" role="list" aria-label="Week">
        {days.map((d) => {
          const on = isSameDay(d, value)
          const n = counts.get(format(d, "yyyy-MM-dd")) ?? 0
          return (
            <button
              key={d.toISOString()}
              type="button"
              role="listitem"
              aria-current={on ? "date" : undefined}
              aria-label={`${format(d, "EEEE d MMMM")}: ${n} ${countLabel}`}
              onClick={() => onChange(d)}
              className={cn("relative flex flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors", on ? "bg-primary text-primary-foreground" : "active:bg-muted")}
            >
              <span className={cn("text-[10px] font-medium uppercase tracking-wide", !on && "text-muted-foreground")}>{format(d, "EEE")}</span>
              <span className="text-base font-semibold leading-tight tabular-nums">{format(d, "d")}</span>
              <span className={cn("text-[10px] leading-none tabular-nums", !on && (n ? "text-foreground" : "text-muted-foreground/50"))}>{n || "–"}</span>
              {isToday(d) && !on && <span aria-hidden className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
