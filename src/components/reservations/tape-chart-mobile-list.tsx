"use client"

import { format, parseISO, addDays, isSameDay } from "date-fns"
import { DoorOpen, User, ChevronLeft } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { DesktopOnlyNotice } from "@/components/ui/mobile"
import { toDateKey, parseDateKey } from "@/lib/date-only"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import type { Room, Reservation } from "@/components/reservations/tape-chart-grid"

// The tape chart's horizontal-scroll timeline doesn't translate to a phone-width
// viewport — this is the deliberately distinct mobile layout called for in
// DESIGN_PLAN.md §4.4: a flat, sorted agenda of reservations for the visible window
// instead of a grid, mirroring how most booking apps present a calendar on mobile.
export function TapeChartMobileList({
  rooms,
  reservations,
  startDate,
  daysToShow,
  isLoading,
  onSelectReservation,
  onNavigate,
  today,
  onJumpTo,
}: {
  rooms: Room[]
  reservations: Reservation[]
  startDate: Date
  daysToShow: number
  isLoading: boolean
  onSelectReservation: (res: Reservation) => void
  onNavigate: (direction: -1 | 1) => void
  /** The property's business date — "Today" jumps back to it. */
  today?: Date
  /** Start the window on a chosen day (Today button / date picker). */
  onJumpTo?: (date: Date) => void
}) {
  const roomNumber = (roomId: string | null) => rooms.find(r => r.id === roomId)?.roomNumber ?? "Unassigned"

  const sorted = [...reservations].sort(
    (a, b) => parseISO(a.checkInDate).getTime() - parseISO(b.checkInDate).getTime()
  )

  return (
    <div className="w-full">
      <div className="flex flex-col gap-2 p-3 border-b border-border bg-muted">
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" onClick={() => onNavigate(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground text-center">
            {format(startDate, "MMM d")} – {format(addDays(startDate, daysToShow - 1), "MMM d, yyyy")}
          </span>
          <Button variant="outline" size="icon" onClick={() => onNavigate(1)} aria-label="Next week">
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </Button>
        </div>
        {onJumpTo && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="shrink-0"
              disabled={!today || isSameDay(startDate, today)}
              onClick={() => today && onJumpTo(today)}
            >
              Today
            </Button>
            <div className="min-w-0 flex-1">
              <DatePicker
                value={toDateKey(startDate)}
                onChange={(v) => {
                  const d = parseDateKey(v)
                  if (d) onJumpTo(d)
                }}
                placeholder="Jump to date"
              />
            </div>
          </div>
        )}
      </div>

      {/* Moving a booking is a drag across the room grid — not something a phone does well. */}
      <DesktopOnlyNotice
        feature="Moving bookings"
        description="Open the tape chart on a tablet or computer to drag bookings between rooms or book straight from an empty cell."
        className="m-3 mb-0"
      />

      {isLoading ? (
        <div className="p-3 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No reservations in this window"
          description="Nothing checks in or out during the selected date range."
        />
      ) : (
        <div className="p-3 space-y-3">
          {sorted.map(res => (
            <button
              key={res.id}
              onClick={() => onSelectReservation(res)}
              className="w-full text-left bg-card border border-border rounded-lg p-3 shadow-elevation-1 active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  {res.primaryGuest.firstName} {res.primaryGuest.lastName}
                </div>
                <StatusBadge status={res.status} label={res.status.replace(/_/g, " ")} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <DoorOpen className="w-3.5 h-3.5" /> Room {roomNumber(res.roomId)} · {res.roomType.code}
                </span>
                <span className="font-mono">#{res.confirmationNo.slice(0, 6)}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {format(parseISO(res.checkInDate), "dd MMM")} – {format(parseISO(res.checkOutDate), "dd MMM yyyy")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
