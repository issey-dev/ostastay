"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, isEqual, parseISO, startOfDay } from "date-fns";
import { Loader2, Ban, ChevronDown, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useProperty } from "@/components/providers/property-provider";
import { useDeviceTier } from "@/hooks/use-mobile";
import { StopSaleDialog, type StopSaleInitial } from "@/components/availability/stop-sale-dialog";
import { AvailabilityMobileList } from "@/components/availability/availability-mobile-list";

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

type ApiData = {
  startDate: string;
  days: number;
  dates: string[];
  roomTypes: { id: string; code: string; name: string; capacity: number }[];
  house: { capacity: number; cells: Cell[] };
  rows: { roomTypeId: string; cells: Cell[] }[];
};

const DAY_OPTIONS = [7, 14, 30];

// The expandable metric sub-rows, in the order the reference shows them.
const METRICS: { key: keyof Cell; label: string }[] = [
  { key: "arrivals", label: "Arrivals" },
  { key: "occupancy", label: "Occupancy" },
  { key: "departures", label: "Departures" },
  { key: "groupBlocks", label: "Group Blocks" },
  { key: "adults", label: "Adults" },
  { key: "children", label: "Children" },
  { key: "infants", label: "Infants" },
];

const HOUSE_KEY = "__HOUSE__";

export function AvailabilityGrid() {
  const { currentProperty } = useProperty();
  const deviceTier = useDeviceTier();
  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [days, setDays] = useState(14);
  const [data, setData] = useState<ApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [stopSale, setStopSale] = useState<{ open: boolean; initial?: StopSaleInitial }>({ open: false });

  const fetchData = useCallback(async () => {
    if (!currentProperty?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/availability?propertyId=${currentProperty.id}&startDate=${format(startDate, "yyyy-MM-dd")}&days=${days}`
      );
      const json = await res.json();
      if (res.ok) setData(json);
    } catch (error) {
      console.error("Failed to load availability", error);
    } finally {
      setIsLoading(false);
    }
  }, [currentProperty?.id, startDate, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Local calendar dates for display (API sends UTC midnights; slice avoids tz drift).
  const columns = useMemo(() => (data?.dates ?? []).map((d) => parseISO(d.slice(0, 10))), [data]);

  const allRowKeys = useMemo(
    () => [HOUSE_KEY, ...(data?.roomTypes ?? []).map((t) => t.id)],
    [data]
  );
  const allExpanded = allRowKeys.length > 0 && allRowKeys.every((k) => expanded.has(k));

  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleExpandAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(allRowKeys));

  const gridStyle = { gridTemplateColumns: `repeat(${days}, minmax(64px, 1fr))` } as const;

  const openStopSale = (roomTypeId: string | null, date?: string) =>
    setStopSale({ open: true, initial: { roomTypeId, date } });

  // ---- cell renderers -------------------------------------------------------

  const availabilityCell = (cell: Cell, roomTypeId: string | null, dateIso: string, key: string) => {
    const tone = cell.closed
      ? "bg-destructive-muted text-destructive"
      : cell.available < 0
        ? "text-destructive font-bold"
        : cell.available === 0
          ? "text-muted-foreground"
          : "text-foreground";
    return (
      <button
        key={key}
        type="button"
        onClick={() => openStopSale(roomTypeId, dateIso)}
        title={
          cell.closed
            ? "Closed (Stop Sale) — click to manage"
            : cell.available < 0
              ? `Oversold by ${-cell.available} — click to set Stop Sale`
              : "Open to sell — click to set Stop Sale"
        }
        className={cn(
          "relative h-full w-full border-r border-border p-1 text-center text-sm font-semibold transition-colors hover:bg-muted/60",
          tone
        )}
      >
        {cell.closed && <Ban className="absolute left-1 top-1 h-3 w-3 opacity-70" />}
        <span className={cell.closed ? "line-through decoration-destructive/60" : undefined}>
          {cell.available}
        </span>
      </button>
    );
  };

  const metricCell = (value: number, closed: boolean, key: string) => (
    <div
      key={key}
      className={cn(
        "h-full w-full border-r border-border p-1 text-center text-xs",
        value === 0 ? "text-muted-foreground/40" : "text-muted-foreground",
        closed && "bg-destructive-muted/40"
      )}
    >
      {value}
    </div>
  );

  // A full row group: a bold "Max. Available Rooms" summary row + (when expanded) the
  // six metric sub-rows. `isHouse` styles the House total distinctly.
  const renderGroup = (opts: {
    rowKey: string;
    roomTypeId: string | null;
    label: string;
    sublabel: string;
    capacity: number;
    cells: Cell[];
    isHouse: boolean;
  }) => {
    const { rowKey, roomTypeId, label, sublabel, capacity, cells, isHouse } = opts;
    const isExpanded = expanded.has(rowKey);
    return (
      <div key={rowKey} className={cn("border-b border-border", isHouse && "bg-muted/40")}>
        {/* Summary row */}
        <div className={cn("flex", isHouse ? "bg-muted/40" : "bg-card")}>
          <div
            className={cn(
              "w-52 shrink-0 border-r border-border px-2 py-2 sticky left-0 z-10 flex items-center gap-1.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]",
              isHouse ? "bg-muted" : "bg-card"
            )}
          >
            <button
              type="button"
              onClick={() => toggleRow(rowKey)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <div className={cn("truncate font-bold leading-tight", isHouse ? "text-sm" : "text-sm text-foreground")}>
                {label}
              </div>
              <div className="text-[10px] font-medium text-muted-foreground truncate">
                {sublabel} · {capacity} rooms
              </div>
            </div>
          </div>
          <div className="flex-1 grid" style={gridStyle}>
            {cells.map((cell, i) => availabilityCell(cell, roomTypeId, data!.dates[i], `${rowKey}-a-${i}`))}
          </div>
        </div>

        {/* Metric sub-rows */}
        {isExpanded &&
          METRICS.map((m) => (
            <div key={`${rowKey}-${m.key}`} className="flex border-t border-border/60">
              <div
                className={cn(
                  "w-52 shrink-0 border-r border-border py-1 pl-9 pr-2 sticky left-0 z-10 flex items-center text-[11px] font-medium text-muted-foreground shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]",
                  isHouse ? "bg-muted/60" : "bg-card"
                )}
              >
                {m.label}
              </div>
              <div className="flex-1 grid" style={gridStyle}>
                {cells.map((cell, i) =>
                  metricCell(cell[m.key] as number, cell.closed, `${rowKey}-${m.key}-${i}`)
                )}
              </div>
            </div>
          ))}
      </div>
    );
  };

  // ---- loading --------------------------------------------------------------

  const today = startOfDay(new Date());

  if (!currentProperty) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Select a property to view availability.
      </div>
    );
  }

  // Mobile: a horizontal-scroll Date x Room Type grid doesn't work at phone width — swap
  // in a day-by-day agenda instead (see availability-mobile-list.tsx). Checked before the
  // desktop loading-skeleton branch, same pattern as TapeChartGrid, so the mobile list
  // owns its own loading/empty states rather than briefly flashing the desktop skeleton.
  if (deviceTier === "mobile") {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setStartDate((d) => addDays(d, -days))}>
              &lt; Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStartDate(today)}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStartDate((d) => addDays(d, days))}>
              Next &gt;
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>Days</span>
              {DAY_OPTIONS.map((d) => (
                <Button
                  key={d}
                  variant={days === d ? "default" : "outline"}
                  size="sm"
                  className="h-7 w-9 px-0"
                  onClick={() => setDays(d)}
                >
                  {d}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => openStopSale(null)}
            >
              <Ban className="mr-2 h-4 w-4" /> Stop Sale
            </Button>
          </div>
        </div>

        <AvailabilityMobileList
          dates={columns}
          roomTypes={data?.roomTypes ?? []}
          houseCapacity={data?.house.capacity ?? 0}
          houseCells={data?.house.cells ?? []}
          rows={data?.rows ?? []}
          isLoading={isLoading}
          onOpenStopSale={openStopSale}
        />

        {currentProperty && (
          <StopSaleDialog
            open={stopSale.open}
            onClose={() => setStopSale({ open: false })}
            propertyId={currentProperty.id}
            roomTypes={data?.roomTypes ?? []}
            initial={stopSale.initial}
            onDone={fetchData}
          />
        )}
      </>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="w-full">
        <div className="flex border-b border-border bg-muted p-2 gap-2">
          <Skeleton className="w-52 h-8 shrink-0" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="flex-1 h-8" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex border-b border-border p-2 gap-2">
            <Skeleton className="w-52 h-10 shrink-0" />
            <Skeleton className="flex-1 h-10" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setStartDate((d) => addDays(d, -days))}>
            &lt; Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStartDate(today)}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStartDate((d) => addDays(d, days))}>
            Next &gt;
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={toggleExpandAll}>
            {allExpanded ? "Collapse All" : "Expand All"}
          </Button>
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span>Days</span>
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d}
                variant={days === d ? "default" : "outline"}
                size="sm"
                className="h-7 w-9 px-0"
                onClick={() => setDays(d)}
              >
                {d}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => openStopSale(null)}
          >
            <Ban className="mr-2 h-4 w-4" /> Stop Sale
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="w-full overflow-x-auto relative bg-card">
        {/* Date header */}
        <div className="flex border-b border-border bg-muted sticky top-0 z-20">
          <div className="w-52 shrink-0 border-r border-border p-2 flex items-center font-semibold text-foreground bg-muted z-30 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm">
            Room Type
          </div>
          <div className="flex-1 grid" style={gridStyle}>
            {columns.map((date) => {
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <div
                  key={date.toISOString()}
                  className={cn("border-r border-border p-1 text-center", weekend && "bg-muted-foreground/5")}
                >
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {format(date, "EEE")}
                  </div>
                  <div
                    className={cn(
                      "text-base font-bold",
                      isEqual(date, today) ? "text-primary" : "text-foreground"
                    )}
                  >
                    {format(date, "d")}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 font-medium">{format(date, "MMM")}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* House total */}
        {data &&
          renderGroup({
            rowKey: HOUSE_KEY,
            roomTypeId: null,
            label: "House",
            sublabel: "All room types",
            capacity: data.house.capacity,
            cells: data.house.cells,
            isHouse: true,
          })}

        {/* Room type rows */}
        {data?.roomTypes.map((type) => {
          const row = data.rows.find((r) => r.roomTypeId === type.id);
          if (!row) return null;
          return renderGroup({
            rowKey: type.id,
            roomTypeId: type.id,
            label: type.code,
            sublabel: type.name,
            capacity: type.capacity,
            cells: row.cells,
            isHouse: false,
          });
        })}

        {data && data.roomTypes.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No sellable room types configured for this property.
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-[var(--z-modal)] flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
          </div>
        )}
      </div>

      {currentProperty && (
        <StopSaleDialog
          open={stopSale.open}
          onClose={() => setStopSale({ open: false })}
          propertyId={currentProperty.id}
          roomTypes={data?.roomTypes ?? []}
          initial={stopSale.initial}
          onDone={fetchData}
        />
      )}
    </>
  );
}
