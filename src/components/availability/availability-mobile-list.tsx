"use client";

import { useState } from "react";
import { format, isEqual, startOfDay } from "date-fns";
import { Ban, ChevronDown, ChevronRight, Loader2 } from "@/components/icons";
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
// row showing the House total; tapping it expands the per-room-type breakdown, and
// tapping a room type opens the same Stop Sale dialog a grid cell click would.
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

  const today = startOfDay(new Date());

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
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/60"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="w-16 shrink-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {format(date, "EEE")}
                  </div>
                  <div className={cn("text-base font-bold", isToday ? "text-primary" : "text-foreground")}>
                    {format(date, "d MMM")}
                  </div>
                </div>
                <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                  <span className="truncate text-xs text-muted-foreground">House · {houseCapacity} rooms</span>
                  {house?.closed ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-destructive-muted text-destructive">
                      <Ban className="h-3 w-3" /> Closed
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 text-sm font-bold tabular-nums",
                        (house?.available ?? 0) < 0 ? "text-destructive" : "text-foreground"
                      )}
                    >
                      {house?.available ?? 0} avail
                    </span>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="space-y-1 border-t border-border/60 bg-muted/20 px-3 py-2 pl-11">
                  {roomTypes.map((rt) => {
                    const row = rows.find((r) => r.roomTypeId === rt.id);
                    const cell = row?.cells[i];
                    if (!cell) return null;
                    return (
                      <button
                        key={rt.id}
                        type="button"
                        onClick={() => onOpenStopSale(rt.id, dateIso)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">{rt.code}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{rt.name}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          {cell.closed ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                              <Ban className="h-3 w-3" /> Closed
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "text-sm font-bold tabular-nums",
                                cell.available < 0 ? "text-destructive" : "text-foreground"
                              )}
                            >
                              {cell.available}
                            </span>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {cell.arrivals} in · {cell.departures} out
                          </div>
                        </div>
                      </button>
                    );
                  })}
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
