"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format, addDays, differenceInDays, parseISO, startOfDay, isBefore, isAfter, isEqual } from "date-fns";
import { Loader2, Calendar, User, Hash, DoorOpen, Star, Key, ExternalLink } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { FolioPanel } from "@/components/front-office/folio-panel";
import { WalkInBookingDialog } from "@/components/front-office/walk-in-booking-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { statusSolidClasses } from "@/lib/status-tone";
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

export function TapeChartGrid() {
  const { slug } = useParams<{ slug: string }>();
  const { currentProperty } = useProperty();
  const deviceTier = useDeviceTier();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<string | null>(null);
  const [isFolioOpen, setIsFolioOpen] = useState(false);
  const [quickBook, setQuickBook] = useState<{ roomTypeId: string; roomId: string; checkInDate: string } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean } | null>(null);
  const daysToShow = 14;

  const handleQuickCheckIn = async (res: Reservation) => {
    setCheckingIn(true);
    try {
      const resp = await fetch(`/api/reservations/${res.reservationId}/check-in`, { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        setSelectedReservation(null);
        setNotification({
          title: "Check-in Complete",
          message: data.roomWarning ? `Guest checked in. Warning: ${data.roomWarning}` : "Guest has been successfully checked in.",
        });
        fetchData(startDate);
      } else {
        setNotification({ title: "Check-in Failed", message: data.error || "Unknown error", isError: true });
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred during check-in.", isError: true });
    } finally {
      setCheckingIn(false);
    }
  };

  const fetchData = async (start: Date) => {
    if (!currentProperty?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/reservations/tape-chart?propertyId=${currentProperty.id}&startDate=${start.toISOString()}&days=${daysToShow}`
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
  }, [startDate, currentProperty?.id]);

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
            <DialogTitle>Reservation Details</DialogTitle>
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
                  <div className="flex items-center text-xs text-muted-foreground"><Calendar className="w-3 h-3 mr-1" /> Check In</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkInDate), "dd-MMM-yy")}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-muted-foreground"><Calendar className="w-3 h-3 mr-1" /> Check Out</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkOutDate), "dd-MMM-yy")}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => setSelectedReservation(null)}>Close</Button>
                <Link href={`/e/${slug}/dashboard/reservations/${selectedReservation.reservationId}`}>
                  <Button variant="outline">
                    <ExternalLink className="w-4 h-4 mr-2" /> View Details
                  </Button>
                </Link>
                {selectedReservation.status === "RESERVED" && (
                  <Button
                    variant="outline"
                    className="bg-success-muted text-success hover:bg-success-muted/70 border-success/30"
                    disabled={checkingIn || !selectedReservation.roomId}
                    title={selectedReservation.roomId ? undefined : "Assign a room first (drag the bar onto a room row)"}
                    onClick={() => handleQuickCheckIn(selectedReservation)}
                  >
                    <Key className="w-4 h-4 mr-2" /> {checkingIn ? "Checking in..." : "Check In"}
                  </Button>
                )}
                <Button onClick={() => setIsFolioOpen(true)}>
                  Open Folio
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
            setNotification(result);
            fetchData(startDate);
          }}
        />
      )}

      <Dialog open={!!notification} onOpenChange={(open) => !open && setNotification(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : undefined}>{notification?.title}</DialogTitle>
            <DialogDescription>{notification?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  return (
    <>
    <div className="w-full overflow-x-auto relative bg-card">
      {/* Date Header Row */}
      <div className="flex border-b border-border bg-muted sticky top-0 z-20">
        <div className="w-32 shrink-0 border-r border-border p-2 flex items-center justify-between font-semibold text-foreground bg-muted z-30 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm">
          Rooms
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => setStartDate(d => addDays(d, -7))}>&lt;</Button>
            <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => setStartDate(d => addDays(d, 7))}>&gt;</Button>
          </div>
        </div>
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}>
          {columns.map(date => (
            <div key={date.toISOString()} className="border-r border-border p-1 text-center">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{format(date, "EEE")}</div>
              <div className={`text-base font-bold ${isEqual(date, startOfDay(new Date())) ? 'text-primary' : 'text-foreground'}`}>
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
            style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}
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
                  className={`absolute left-0 right-0 top-1 bottom-1 mx-1 rounded shadow-sm px-2 py-1 overflow-hidden flex flex-col justify-between cursor-pointer border border-black/10 transition-transform hover:scale-[1.02] z-10 ${getStatusColor(res.status)}`}
                  style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                >
                  <span className="font-bold text-xs leading-tight truncate">{res.primaryGuest.lastName}</span>
                  <span className="text-[10px] font-medium opacity-90 truncate">{res.roomType.code}</span>
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
                  style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}
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
                      title={`Book Room ${room.roomNumber} from ${format(date, "dd-MMM")}`}
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
                        className={`absolute left-0 right-0 top-1 bottom-1 mx-0.5 rounded shadow-sm px-2 py-1 overflow-hidden flex flex-col justify-between cursor-pointer border border-black/10 transition-transform hover:scale-[1.02] z-10 ${getStatusColor(res.status)}`}
                        style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                      >
                        <span className="font-bold text-xs leading-tight truncate">{res.primaryGuest.lastName}</span>
                        <div className="flex justify-between items-end mt-1">
                           <span className="text-[9px] font-semibold opacity-90 truncate hidden md:inline">{res.status.replace('_', ' ')}</span>
                           <span className="text-[9px] font-mono opacity-80">#{res.confirmationNo.slice(0,4)}</span>
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
      
      {isLoading && (
         <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
         </div>
      )}
    </div>

    {detailsModal}
    </>
  );
}
