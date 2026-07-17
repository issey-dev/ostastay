"use client"

import { format, parseISO, addDays } from "date-fns"
import { DoorOpen, User } from "lucide-react"
import { Button } from "@/components/ui/button"
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
}: {
  rooms: Room[]
  reservations: Reservation[]
  startDate: Date
  daysToShow: number
  isLoading: boolean
  onSelectReservation: (res: Reservation) => void
  onNavigate: (direction: -1 | 1) => void
}) {
  const roomNumber = (roomId: string | null) => rooms.find(r => r.id === roomId)?.roomNumber ?? "Unassigned"

  const sorted = [...reservations].sort(
    (a, b) => parseISO(a.checkInDate).getTime() - parseISO(b.checkInDate).getTime()
  )

  return (
    <div className="w-full">
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted">
        <Button variant="outline" size="sm" onClick={() => onNavigate(-1)}>&lt;</Button>
        <span className="text-sm font-semibold text-foreground">
          {format(startDate, "MMM d")} – {format(addDays(startDate, daysToShow - 1), "MMM d, yyyy")}
        </span>
        <Button variant="outline" size="sm" onClick={() => onNavigate(1)}>&gt;</Button>
      </div>

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
