"use client";

import { useState, useEffect } from "react";
import { format, addDays, differenceInDays, parseISO, startOfDay, isBefore, isAfter, isEqual } from "date-fns";
import { Loader2, Calendar, User, Hash, DoorOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FolioPanel } from "@/components/front-office/folio-panel";

interface Room {
  id: string;
  roomNumber: string;
  floor: { name: string };
  roomType: { code: string; name: string };
}

interface Reservation {
  id: string;
  confirmationNo: string;
  reservationId: string;
  roomId: string | null;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  primaryGuest: { firstName: string; lastName: string };
  roomType: { code: string; name: string };
}

export function TapeChartGrid() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [startDate, setStartDate] = useState(startOfDay(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [draggedAssignmentId, setDraggedAssignmentId] = useState<string | null>(null);
  const [isFolioOpen, setIsFolioOpen] = useState(false);
  const daysToShow = 14;

  const fetchData = async (start: Date) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reservations/tape-chart?startDate=${start.toISOString()}&days=${daysToShow}`);
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
        alert(json.error || "Failed to reassign room.");
      } else {
        await fetchData(startDate);
      }
    } catch (error) {
      console.error("Reassign error:", error);
      alert("An error occurred while reassigning the room.");
    } finally {
      setIsLoading(false);
      setDraggedAssignmentId(null);
    }
  };

  useEffect(() => {
    fetchData(startDate);
  }, [startDate]);

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_HOUSE': return 'bg-emerald-500 hover:bg-emerald-600 text-white';
      case 'RESERVED': return 'bg-blue-500 hover:bg-blue-600 text-white';
      case 'CHECKED_OUT': return 'bg-slate-400 hover:bg-slate-500 text-white';
      default: return 'bg-indigo-500 text-white';
    }
  };

  if (isLoading && rooms.length === 0) {
    return (
      <div className="flex justify-center items-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
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
    <div className="w-full overflow-x-auto relative bg-white">
      {/* Date Header Row */}
      <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-20">
        <div className="w-32 shrink-0 border-r border-slate-200 p-2 flex items-center justify-between font-semibold text-slate-700 bg-slate-100 z-30 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm">
          Rooms
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => setStartDate(d => addDays(d, -7))}>&lt;</Button>
            <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => setStartDate(d => addDays(d, 7))}>&gt;</Button>
          </div>
        </div>
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}>
          {columns.map(date => (
            <div key={date.toISOString()} className="border-r border-slate-200 p-1 text-center">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{format(date, "EEE")}</div>
              <div className={`text-base font-bold ${isEqual(date, startOfDay(new Date())) ? 'text-indigo-600' : 'text-slate-800'}`}>
                {format(date, "d")}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">{format(date, "MMM")}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Unassigned Reservations Row (Only show if there are any) */}
      {unassignedReservations.length > 0 && (
        <div className="flex border-b border-amber-200 bg-amber-50/30">
          <div className="w-32 shrink-0 border-r border-slate-200 p-2 bg-amber-50 z-10 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span className="font-bold text-amber-700 text-xs">Unassigned</span>
            <span className="text-[10px] text-amber-600">{unassignedReservations.length} Bookings</span>
          </div>
          <div 
            className="flex-1 grid relative p-1" 
            style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, null)}
          >
            {/* Grid Lines */}
            {columns.map((_, i) => (
              <div key={`unassigned-grid-${i}`} className="border-r border-dashed border-slate-200 h-14" style={{ gridColumn: i + 1 }} />
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
          <div className="bg-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 py-0.5 sticky left-0 z-10 border-b border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-32">
            Floor {floor}
          </div>
          
          {floorRooms.map(room => {
            const roomReservations = reservations.filter(r => r.roomId === room.id);
            
            return (
              <div key={room.id} className="flex border-b border-slate-100 group hover:bg-slate-50 transition-colors">
                <div className="w-32 shrink-0 border-r border-slate-200 p-2 bg-white group-hover:bg-slate-50 z-10 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  <span className="font-bold text-slate-800 text-sm leading-tight">{room.roomNumber}</span>
                  <span className="text-[10px] text-slate-500 font-medium truncate">{room.roomType.name}</span>
                </div>
                
                {/* Data Grid for this room */}
                <div 
                  className="flex-1 grid relative p-1" 
                  style={{ gridTemplateColumns: `repeat(${daysToShow}, minmax(80px, 1fr))` }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, room.id)}
                >
                  {/* Background Grid Lines (Empty clickable cells) */}
                  {columns.map((_, i) => (
                    <div 
                      key={`${room.id}-grid-${i}`} 
                      className="border-r border-slate-100 h-14 cursor-crosshair hover:bg-indigo-50/50 transition-colors" 
                      style={{ gridColumn: i + 1 }} 
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
         <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-50 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
         </div>
      )}

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
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(selectedReservation.status).split(' ')[0]}`} />
                  <span className="font-semibold">{selectedReservation.status.replace('_', ' ')}</span>
                </div>
                <Badge variant="outline" className="font-mono">{selectedReservation.confirmationNo}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-slate-500"><User className="w-3 h-3 mr-1" /> Guest</div>
                  <div className="font-medium">{selectedReservation.primaryGuest.firstName} {selectedReservation.primaryGuest.lastName}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-slate-500"><DoorOpen className="w-3 h-3 mr-1" /> Room</div>
                  <div className="font-medium">
                     {selectedReservation.roomId 
                        ? rooms.find(r => r.id === selectedReservation.roomId)?.roomNumber || 'Unknown'
                        : 'Unassigned'
                     }
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-slate-500"><Calendar className="w-3 h-3 mr-1" /> Check In</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkInDate), "dd-MMM-yy")}</div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center text-xs text-slate-500"><Calendar className="w-3 h-3 mr-1" /> Check Out</div>
                  <div className="font-medium">{format(parseISO(selectedReservation.checkOutDate), "dd-MMM-yy")}</div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => setSelectedReservation(null)}>Close</Button>
                <Button 
                  className="bg-indigo-600 hover:bg-indigo-700"
                  onClick={() => setIsFolioOpen(true)}
                >
                  Open Folio
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedReservation && (
        <FolioPanel 
          reservationId={selectedReservation.reservationId}
          propertyId="00000000-0000-0000-0000-000000000000"
          isOpen={isFolioOpen}
          onClose={() => setIsFolioOpen(false)}
        />
      )}
    </div>
  );
}
