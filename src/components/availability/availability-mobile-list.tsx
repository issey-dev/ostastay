"use client";

import { useBusinessToday } from "@/hooks/use-business-today";
import { useState } from "react";
import { format, isEqual } from "date-fns";
import { Ban, ChevronLeft, Loader2 } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Cell = {
  available: number;
  occupancy: number;
  arrivals: number;
  departures: number;
  adults: number;
  children: number;
  infants: number;
  groupBlocks: number;
  closed: boolean;
};

type RoomTypeMeta = { id: string; code: string; name: string; capacity: number };

// The Date x Room Type pivot grid doesn't translate to a phone-width viewport (a 7/14/30
// column horizontal scroll leaves the desk unable to see a date and its room-type
// breakdown at once) — this is the dedicated mobile layout called for in
// DESIGN_PLAN.md §4.4/TODO.md: a day-by-day agenda instead of the grid. Each date is a
// row showing the House total; tapping it expands the per-room-type breakdown. Stop Sale
// is deliberately NOT one tap away here: the expanded day ends with a quiet "Stop sale…"
// link (and the toolbar's ⋯ menu) that opens the Stop Sale dialog to confirm.

/** Tone for a free-room count: sold out / oversold red, low stock amber. */
function stockTone(available: number, capacity: number) {
  if (available <= 0) return "text-destructive";
  if (available <= Math.max(1, Math.round(capacity * 0.2))) return "text-warning";
  return "text-foreground";
}
export function AvailabilityMobileList({
  dates,
  roomTypes,
  houseCapacity,
  houseCells,
  rows,
  isLoading,
  onOpenStopSale,
}: {
  dates: Date[];
  roomTypes: RoomTypeMeta[];
  houseCapacity: number;
  houseCells: Cell[];
  rows: { roomTypeId: string; cells: Cell[] }[];
  isLoading: boolean;
  onOpenStopSale: (roomTypeId: string | null, dateIso: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Highlight the property's trading day, not the device's date.
  const today = useBusinessToday().today;

  if (isLoading && dates.length === 0) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (dates.length === 0) {
    return <EmptyState icon={Ban} title="No availability data for this range" />;
  }

  return (
    <div className="relative w-full">
      <div className="divide-y divide-border">
        {dates.map((date, i) => {
          const house = houseCells[i];
          const dateIso = format(date, "yyyy-MM-dd");
          const isOpen = expanded.has(i);
          const isToday = isEqual(date, today);
          return (
            <div key={dateIso}>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-muted/60"
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className={cn("text-sm font-semibold", isToday ? "text-primary" : "text-foreground")}>
                    {format(date, "EEE d MMM")}
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Today</span>
                  )}
                </span>
                {house?.closed ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-destructive-muted text-destructive">
                    <Ban className="h-3 w-3" /> Closed
                  </span>
                ) : (
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className={cn("font-bold", stockTone(house?.available ?? 0, houseCapacity))}>{house?.available ?? 0}</span>
                    <span className="text-xs text-muted-foreground"> / {houseCapacity} free</span>
                  </span>
                )}
                <ChevronLeft
                  aria-hidden
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen ? "-rotate-90" : "rotate-180")}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border/60 bg-muted/20 px-3 py-1">
                  {roomTypes.map((rt) => {
                    const row = rows.find((r) => r.roomTypeId === rt.id);
                    const cell = row?.cells[i];
                    if (!cell) return null;
                    return (
                      <div key={rt.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-2 last:border-0">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {rt.code} <span className="font-normal text-muted-foreground">· {rt.name}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {cell.arrivals} in · {cell.departures} out
                          </div>
                        </div>
                        {cell.closed ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-destructive">
                            <Ban className="h-3 w-3" /> Closed
                          </span>
                        ) : (
                          <span className={cn("shrink-0 text-sm font-bold tabular-nums", stockTone(cell.available, rt.capacity))}>
                            {cell.available}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => onOpenStopSale(null, dateIso)}
                    className="flex min-h-11 w-full items-center gap-1.5 text-xs font-medium text-muted-foreground"
                  >
                    <Ban className="h-3.5 w-3.5" /> Stop sale on {format(date, "d MMM")}…
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isLoading && dates.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-[var(--z-modal)]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
