"use client";

import { useBusinessToday } from "@/hooks/use-business-today";
import { toDateKey, parseDateKey } from "@/lib/date-only"
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format, addDays, differenceInDays, parseISO, startOfDay, isBefore, isAfter, isEqual } from "date-fns";
import { Loader2, Calendar, User, DoorOpen, Star, Key, ExternalLink, ChevronLeft, ChevronRight } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FolioPanel } from "@/components/front-office/folio-panel";
import { CheckInWizard } from "@/components/front-office/check-in-wizard";
import { WalkInBookingDialog } from "@/components/front-office/walk-in-booking-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { statusSolidClasses, statusTone, type StatusTone } from "@/lib/status-tone";
import { DatePicker } from "@/components/ui/date-picker";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { useDeviceTier } from "@/hooks/use-mobile";
import { TapeChartMobileList } from "@/components/reservations/tape-chart-mobile-list";
import { useProperty } from "@/components/providers/property-provider";
import { toast } from "@/lib/toast";

export interface Room {
  id: string;
  roomNumber: string;
  roomTypeId: string;
  floor: { name: string };
  roomType: { code: string; name: string };
}

export interface Reservation {
  id: string;
  confirmationNo: string;
  reservationId: string;
  roomId: string | null;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  primaryGuest: { firstName: string; lastName: string; vipLevel?: string | null };
  roomType: { code: string; name: string };
}

// Desktop window choice (?days=7|14|30). Phones keep the fixed 14-day agenda.
const DAY_OPTIONS = ["7", "14", "30"] as const;
type DayOption = (typeof DAY_OPTIONS)[number];
// Minimum day-column width per window: 14 days fit a normal desktop without clipping the
// last day; 30 days scroll horizontally (the room column stays pinned).
const MIN_COL_PX: Record<DayOption, number> = { "7": 104, "14": 64, "30": 44 };

// Bars: a status-tinted fill with a solid 3px left edge and dark text — not a saturated
// full fill (DESKTOP_PLAN §2.2). Same tone map as every other status (status-tone.ts).
const BAR_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-muted border-l-success hover:bg-success-muted/70",
  warning: "bg-warning-muted border-l-warning hover:bg-warning-muted/70",
  danger: "bg-destructive-muted border-l-destructive hover:bg-destructive-muted/70",
  info: "bg-info-muted border-l-info hover:bg-info-muted/70",
  neutral: "bg-muted border-l-muted-foreground hover:bg-muted/70",
};
const barClasses = (status: string) => BAR_CLASSES[statusTone(status)];

const LEGEND: { label: string; status: string }[] = [
  { label: "Reserved", status: "RESERVED" },
  { label: "In-house", status: "IN_HOUSE" },
  { label: "Checked out", status: "CHECKED_OUT" },
  { label: "No-show", status: "NO_SHOW" },
];

export function TapeChartGrid() {
  const { slug } = useParams<{ slug: string }>();
  const { currentProperty } = useProperty();
  const deviceTier = useDeviceTier();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  // Start at the property's business date, not the device's: before the night audit runs
  // (or on a property whose date isn't the calendar's) the device date showed the wrong
  // window. Seeded once per property when it loads — render-time, not an effect.
  const business = useBusinessToday();
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (business.ready && seededFor !== business.propertyId) {
    setSeededFor(business.propertyId);
    setStartDate(business.today);
  }
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<string | null>(null);
  const [isFolioOpen, setIsFolioOpen] = useState(false);
  const [quickBook, setQuickBook] = useState<{ roomTypeId: string; roomId: string; checkInDate: string } | null>(null);
  // Check-in goes through the same wizard as the Front Desk (room, ID, registration card,
  // held nights) — the tape chart used to POST check-in directly and skip all of it.
  const [checkInId, setCheckInId] = useState<string | null>(null);
  const [daysParam, setDaysParam] = useUrlState<DayOption>("days", "14", DAY_OPTIONS);
  const daysToShow = deviceTier === "mobile" ? 14 : Number(daysParam);
  const colTemplate = `repeat(${daysToShow}, minmax(${MIN_COL_PX[deviceTier === "mobile" ? "14" : daysParam]}px, 1fr))`;
  const dense = daysToShow === 30;

  const refresh = () => fetchData(startDate);

  // Walk-in / check-in dialogs report back a { title, message } — shown as a toast.
  const showResult = (result: { title: string; message: string; isError?: boolean }) => {
    if (result.isError) toast.error(result.title, { description: result.message });
    else toast.success(result.title, { description: result.message });
  };

  const fetchData = async (start: Date) => {
    if (!currentProperty?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/reservations/tape-chart?propertyId=${currentProperty.id}&startDate=${toDateKey(start)}&days=${daysToShow}`
      );
      const json = await res.json();
      if (json.success) {
        setRooms(json.data.rooms);
        setReservations(json.data.reservations);
      }
    } catch (error) {
      console.error("Failed to load tape chart", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedAssignmentId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, roomId: string | null) => {
    e.preventDefault();
    const assignmentId = e.dataTransfer.getData("text/plain") || draggedAssignmentId;
    if (!assignmentId) return;

    try {
      setIsLoading(true);
      const res = await fetch(`/api/reservations/assignments/${assignmentId}/reassign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ roomId })
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to reassign room.");
      } else {
        await fetchData(startDate);
      }
    } catch (error) {
      console.error("Reassign error:", error);
      toast.error("An error occurred while reassigning the room.");
    } finally {
      setIsLoading(false);
      setDraggedAssignmentId(null);
    }
  };

  useEffect(() => {
    fetchData(startDate);
  }, [startDate, currentProperty?.id, daysToShow]);

  // Generate column dates
  const columns = Array.from({ length: daysToShow }).map((_, i) => addDays(startDate, i));

  // Helper to calculate position and width of a reservation block
  const getBlockStyle = (checkIn: string, checkOut: string) => {
    const inDate = startOfDay(parseISO(checkIn));
    const outDate = startOfDay(parseISO(checkOut));
    const viewEnd = addDays(startDate, daysToShow);

    // If check-in is before the view start, clamp it
    const effectiveIn = isBefore(inDate, startDate) ? startDate : inDate;
    // If check-out is after the view end, clamp it
    const effectiveOut = isAfter(outDate, viewEnd) ? viewEnd : outDate;

    // Calculate left offset (number of days from startDate)
    const leftOffsetDays = differenceInDays(effectiveIn, startDate);
    // Calculate width (number of days duration within view)
    const durationDays = differenceInDays(effectiveOut, effectiveIn);

    // Assuming each column is exactly 120px wide (w-30 equivalent in custom CSS if needed)
    // We will use percentages for fluidity if we assume the grid is a CSS grid
    // For CSS grid with 14 cols, left = leftOffsetDays + 1, span = durationDays
    return {
      gridColumnStart: leftOffsetDays + 1,
      gridColumnEnd: leftOffsetDays + 1 + durationDays
    };
  };

  const getStatusColor = statusSolidClasses;

  const detailsModal = (
    <>
      {/* Reservation Details Modal */}
      <Dialog open={!!selectedReservation} onOpenChange={(open) => !open && setSelectedReservation(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reservation details</DialogTitle>
            <DialogDescription>Overview of the selected booking.</DialogDescription>
          </DialogHeader>

          {selectedReservation && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-none ${getStatusColor(selectedReservation.status).split(' ')[0]}`} />
                  <span className="font-semibold">{selectedReservation.status.replace('_', ' ')}</span>
                </div>
                <Badge variant="outline" className="font-mono">{selectedReservation.confirmationNo}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-muted p-4 rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-muted-foreground"><User className="w-3 h-3 mr-1" /> Guest</div>
                  <div className="font-medium inline-flex items-center gap-1.5">
                    {selectedReservation.primaryGuest.firstName} {selectedReservation.primaryGuest.lastName}
                    {selectedReservation.primaryGuest.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-muted-foreground"><DoorOpen className="w-3 h-3 mr-1" /> Room</div>
                  <div className="font-medium">
                     {selectedReservation.roomId
                        ? rooms.find(r => r.id === selectedReservation.roomId)?.roomNumber || 'Unknown'
                        : 'Unassigned'
                     }
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-muted-foreground"><Calendar className="w-3 h-3 mr-1" /> Check in</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkInDate), "dd-MMM-yy")}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-muted-foreground"><Calendar className="w-3 h-3 mr-1" /> Check out</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkOutDate), "dd-MMM-yy")}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => setSelectedReservation(null)}>Close</Button>
                <Link href={`/e/${slug}/dashboard/reservations/${selectedReservation.reservationId}`}>
                  <Button variant="outline">
                    <ExternalLink className="w-4 h-4 mr-2" /> View details
                  </Button>
                </Link>
                {selectedReservation.status === "RESERVED" && (
                  <Button
                    variant="outline"
                    className="bg-success-muted text-success hover:bg-success-muted/70 border-success/30"
                    disabled={!selectedReservation.roomId}
                    title={selectedReservation.roomId ? undefined : "Assign a room first (drag the bar onto a room row)"}
                    onClick={() => {
                      setCheckInId(selectedReservation.reservationId);
                      setSelectedReservation(null);
                    }}
                  >
                    <Key className="w-4 h-4 mr-2" /> Check in
                  </Button>
                )}
                <Button onClick={() => setIsFolioOpen(true)}>
                  Open folio
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedReservation && currentProperty && (
        <FolioPanel
          reservationId={selectedReservation.reservationId}
          propertyId={currentProperty.id}
          isOpen={isFolioOpen}
          onClose={() => setIsFolioOpen(false)}
          onCheckedOut={refresh}
        />
      )}

      {currentProperty && (
        <CheckInWizard
          reservationId={checkInId}
          propertyId={currentProperty.id}
          isOpen={!!checkInId}
          onClose={() => setCheckInId(null)}
          onDone={(result) => {
            // A failed payment already raised its own toast.
            if (!result.paymentFailed) showResult(result);
            refresh();
          }}
        />
      )}

      {currentProperty && (
        <WalkInBookingDialog
          propertyId={currentProperty.id}
          isOpen={!!quickBook}
          onClose={() => setQuickBook(null)}
          mode="book"
          initial={quickBook ?? undefined}
          onDone={(result) => {
            showResult(result);
            refresh();
          }}
        />
      )}

    </>
  );

  if (deviceTier === "mobile") {
    return (
      <>
        <TapeChartMobileList
          rooms={rooms}
          reservations={reservations}
          startDate={startDate}
          daysToShow={daysToShow}
          isLoading={isLoading}
          onSelectReservation={setSelectedReservation}
          onNavigate={(direction) => setStartDate(d => addDays(d, direction * 7))}
          today={business.ready ? business.today : undefined}
          onJumpTo={(d) => setStartDate(startOfDay(d))}
        />
        {detailsModal}
      </>
    );
  }

  if (isLoading && rooms.length === 0) {
    return (
      <div className="w-full">
        <div className="flex border-b border-border bg-muted p-2 gap-2">
          <Skeleton className="w-32 h-8 shrink-0" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="flex-1 h-8" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex border-b border-border p-2 gap-2">
            <Skeleton className="w-32 h-14 shrink-0" />
            <Skeleton className="flex-1 h-14" />
          </div>
        ))}
      </div>
    );
  }

  // Group rooms by floor
  const groupedRooms = rooms.reduce((acc, room) => {
    const floor = room.floor.name;
    if (!acc[floor]) acc[floor] = [];
    acc[floor].push(room);
    return acc;
  }, {} as Record<string, Room[]>);

  const unassignedReservations = reservations.filter(r => !r.roomId);

  const viewEnd = addDays(startDate, daysToShow - 1);
  const showingToday = isEqual(startDate, business.today);

  return (
    <>
    {/* Toolbar: Today · prev/next · jump to a date · window · legend */}
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <Button variant="outline" size="sm" disabled={showingToday} onClick={() => setStartDate(business.today)}>
        Today
      </Button>
      <div className="flex items-center">
        <Button variant="ghost" size="icon-sm" onClick={() => setStartDate(d => addDays(d, -7))} aria-label="Previous week" title="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setStartDate(d => addDays(d, 7))} aria-label="Next week" title="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <DatePicker
        className="h-7 w-40"
        value={toDateKey(startDate)}
        placeholder="Jump to date"
        onChange={(key) => {
          const d = parseDateKey(key);
          if (d) setStartDate(startOfDay(d));
        }}
      />
      <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline">
        {format(startDate, "d MMM")} – {format(viewEnd, "d MMM yyyy")}
      </span>
      <div role="group" aria-label="Days shown" className="flex border border-border">
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
      <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {LEGEND.map((item) => (
          <li key={item.status} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("h-3 w-3 border border-border/60 border-l-[3px]", barClasses(item.status))} />
            {item.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 border border-warning/40 bg-warning-muted" />
          Unassigned
        </li>
      </ul>
    </div>

    <div className="w-full overflow-x-auto relative bg-card">
    {/* w-max + min-w-full: every row shares one width, so the last day is never clipped and
        wide windows scroll cleanly with the room column pinned. */}
    <div className="w-max min-w-full">
      {/* Date Header Row */}
      <div className="flex border-b border-border bg-muted sticky top-0 z-20">
        <div className="w-32 shrink-0 border-r border-border p-2 flex items-center font-semibold text-foreground bg-muted z-30 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm">
          Rooms
        </div>
        <div className="flex-1 grid" style={{ gridTemplateColumns: colTemplate }}>
          {columns.map(date => (
            <div key={date.toISOString()} className="border-r border-border p-1 text-center">
              <div className={cn("font-semibold text-muted-foreground uppercase", dense ? "text-[10px]" : "text-[11px] tracking-wider")}>
                {format(date, dense ? "EEEEE" : "EEE")}
              </div>
              <div className={cn("font-bold tabular-nums", dense ? "text-sm" : "text-base", isEqual(date, business.today) ? "text-primary" : "text-foreground")}>
                {format(date, "d")}
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-medium">{format(date, "MMM")}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Unassigned Reservations Row (Only show if there are any) */}
      {unassignedReservations.length > 0 && (
        <div className="flex border-b border-warning/30 bg-warning-muted/60">
          <div className="w-32 shrink-0 border-r border-border p-2 bg-warning-muted z-10 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span className="font-bold text-warning text-xs">Unassigned</span>
            <span className="text-[10px] text-warning/80">{unassignedReservations.length} Bookings</span>
          </div>
          <div 
            className="flex-1 grid relative p-1" 
            style={{ gridTemplateColumns: colTemplate }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, null)}
          >
            {/* Grid Lines */}
            {columns.map((_, i) => (
              <div key={`unassigned-grid-${i}`} className="border-r border-dashed border-border h-14" style={{ gridColumn: i + 1 }} />
            ))}
            
            {/* Unassigned Blocks */}
            {unassignedReservations.map(res => {
              const style = getBlockStyle(res.checkInDate, res.checkOutDate);
              if (style.gridColumnEnd <= 1 || style.gridColumnStart > daysToShow) return null;
              
              return (
                <div 
                  key={res.id} 
                  onClick={() => setSelectedReservation(res)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, res.id)}
                  title={`${res.primaryGuest.firstName} ${res.primaryGuest.lastName} · ${res.status.replace('_', ' ')} · ${res.confirmationNo}`}
                  className={`absolute left-0 right-0 top-1 bottom-1 mx-1 px-2 py-1 overflow-hidden flex flex-col justify-between cursor-pointer border border-border/60 border-l-[3px] text-foreground transition-colors hover:shadow-sm z-10 ${barClasses(res.status)}`}
                  style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                >
                  <span className="font-bold text-xs leading-tight truncate">{res.primaryGuest.lastName}</span>
                  <span className="text-[10px] font-medium text-muted-foreground truncate">{res.roomType.code}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Room Rows Grouped by Floor */}
      {Object.entries(groupedRooms).map(([floor, floorRooms]) => (
        <div key={floor}>
          <div className="bg-muted text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-0.5 sticky left-0 z-10 border-b border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-32">
            Floor {floor}
          </div>

          {floorRooms.map(room => {
            const roomReservations = reservations.filter(r => r.roomId === room.id);

            return (
              <div key={room.id} className="flex border-b border-border group hover:bg-muted/50 transition-colors">
                <div className="w-32 shrink-0 border-r border-border p-2 bg-card group-hover:bg-muted/50 z-10 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  <span className="font-bold text-foreground text-sm leading-tight">{room.roomNumber}</span>
                  <span className="text-[10px] text-muted-foreground font-medium truncate">{room.roomType.name}</span>
                </div>

                {/* Data Grid for this room */}
                <div
                  className="flex-1 grid relative p-1"
                  style={{ gridTemplateColumns: colTemplate }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, room.id)}
                >
                  {/* Background Grid Lines — clicking an empty cell opens a booking
                      prefilled with this room and that date */}
                  {columns.map((date, i) => (
                    <div
                      key={`${room.id}-grid-${i}`}
                      className="border-r border-border h-14 cursor-crosshair hover:bg-muted/50 transition-colors"
                      style={{ gridColumn: i + 1 }}
                      title={`Book room ${room.roomNumber} from ${format(date, "dd-MMM")}`}
                      onClick={() =>
                        setQuickBook({ roomTypeId: room.roomTypeId, roomId: room.id, checkInDate: format(date, "yyyy-MM-dd") })
                      }
                    />
                  ))}

                  {/* Reservation Blocks */}
                  {roomReservations.map(res => {
                    const style = getBlockStyle(res.checkInDate, res.checkOutDate);
                    if (style.gridColumnEnd <= 1 || style.gridColumnStart > daysToShow) return null;
                    
                    return (
                      <div 
                        key={res.id} 
                        onClick={() => setSelectedReservation(res)}
                        draggable
                        onDragStart={(e) => handleDragStart(e, res.id)}
                        title={`${res.primaryGuest.firstName} ${res.primaryGuest.lastName} · ${res.status.replace('_', ' ')} · ${res.confirmationNo}`}
                        className={`absolute left-0 right-0 top-1 bottom-1 mx-0.5 px-1.5 py-1 overflow-hidden flex flex-col justify-between cursor-pointer border border-border/60 border-l-[3px] text-foreground transition-colors hover:shadow-sm z-10 ${barClasses(res.status)}`}
                        style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                      >
                        <span className="font-bold text-xs leading-tight truncate">{res.primaryGuest.lastName}</span>
                        <div className="flex justify-between items-end gap-1 mt-1 text-muted-foreground">
                           <span className="text-[10px] font-semibold truncate hidden md:inline">{res.status.replace('_', ' ')}</span>
                           <span className="text-[10px] font-mono shrink-0">#{res.confirmationNo.slice(0,4)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      
    </div>
      {isLoading && (
         <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-[var(--z-modal)] flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
         </div>
      )}
    </div>

    {detailsModal}
    </>
  );
}
