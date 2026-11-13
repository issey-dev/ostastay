"use client";

import { GoldStar } from "@/components/ui/gold-star";
import { useBusinessToday } from "@/hooks/use-business-today";
import { toDateKey, parseDateKey } from "@/lib/date-only"
import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, addDays, differenceInDays, parseISO, startOfDay, isBefore, isAfter, isEqual } from "date-fns";
import { Loader2, Calendar, User, DoorOpen, Key, ExternalLink, ChevronLeft, ChevronRight, AlertTriangle, Check } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FolioPanel } from "@/components/front-office/folio-panel";
import { CheckInWizard } from "@/components/front-office/check-in-wizard";
import { WalkInBookingDialog } from "@/components/front-office/walk-in-booking-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { statusSolidClasses } from "@/lib/status-tone";
import { DatePicker } from "@/components/ui/date-picker";
import { useUrlState } from "@/lib/use-url-state";
import { DEFAULT_MARKER_RULES, MARKER_COLORS, resolveMarker, type MarkerFacts, type MarkerRule, type ResolvedMarker } from "@/lib/booking-markers";
import { MarkerIconView, bookingBarFill } from "@/components/reservations/booking-marker";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useDeviceTier } from "@/hooks/use-mobile";
import { TapeChartMobileList } from "@/components/reservations/tape-chart-mobile-list";
import { useProperty } from "@/components/providers/property-provider";
import { toast } from "@/lib/toast";
import { TapeChartTypeChangeDialog, type TypeChangeMove } from "@/components/reservations/tape-chart-type-change-dialog";

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
  /** Booking markers (Agent Portal plan A-22): what the marker rules read. */
  markerFacts?: MarkerFacts;
  optionDate?: string | null;
}

// Desktop window choice (?days=7|14|30). Phones keep the fixed 14-day agenda.
const DAY_OPTIONS = ["7", "14", "30"] as const;
type DayOption = (typeof DAY_OPTIONS)[number];
// Minimum day-column width per window: 14 days fit a normal desktop without clipping the
// last day; 30 days scroll horizontally (the room column stays pinned).
const MIN_COL_PX: Record<DayOption, number> = { "7": 104, "14": 64, "30": 44 };

export function TapeChartGrid() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { currentProperty } = useProperty();
  const deviceTier = useDeviceTier();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // Booking markers and the source/status filter (Agent Portal plan Phase 3).
  const [markerRules, setMarkerRules] = useState<MarkerRule[]>(DEFAULT_MARKER_RULES);
  const [markerFilter, setMarkerFilter] = useState<string>("all");
  const filterOptions = useMemo(() => {
    const sources = new Map<string, string>();
    for (const r of reservations) if (r.markerFacts?.source) sources.set(r.markerFacts.source.upid, r.markerFacts.source.name);
    return [
      { label: "All bookings", value: "all" },
      { label: "Tentative", value: "status:TENTATIVE" },
      { label: "Overflow", value: "overflow" },
      { label: "Any source", value: "source:any" },
      ...[...sources.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([upid, name]) => ({ label: name, value: `source:${upid}` })),
    ];
  }, [reservations]);
  const matchesFilter = (r: Reservation) => {
    if (markerFilter === "all") return true;
    const f = r.markerFacts;
    if (markerFilter === "status:TENTATIVE") return r.status === "TENTATIVE";
    if (markerFilter === "overflow") return !!f?.isOverflow;
    if (markerFilter === "source:any") return !!f?.source;
    if (markerFilter.startsWith("source:")) return f?.source?.upid === markerFilter.slice(7);
    return true;
  };
  // A bar says WHO it is by icon and colour, and HOW FIRM it is by its fill:
  //   individual  user icon, the brand colour
  //   group       group icon, the Group marker's colour
  //   source      the Source's own icon and colour
  // Confirmed = solid; tentative = glassy (translucent); no-show with a room = greyed out.
  // Bars outside the filter fade (rooms stay readable).
  const barExtras = (res: Reservation) => {
    const f = res.markerFacts;
    const kind: "individual" | "group" | "source" = f?.source ? "source" : f?.groupBlockId ? "group" : "individual";
    // The identity marker ignores tentative/overflow state, which the fill already shows.
    const identity: ResolvedMarker | null =
      kind === "individual" || !f
        ? null
        : resolveMarker({ ...f, status: "RESERVED", isOverflow: false, confirmationRequestedAt: null }, markerRules) ??
          (kind === "group" ? { icon: "Users", color: "teal", label: "Group" } : null);
    const tentative = res.status === "TENTATIVE";
    const noShow = res.status === "NO_SHOW";
    const checkedOut = res.status === "CHECKED_OUT";
    // Groups are always slate (one look everywhere); sources use their own colour.
    const color = kind === "group" ? "slate" : identity ? identity.color : null;
    const fill = bookingBarFill(res.status, color);
    return {
      kind,
      identity,
      tentative,
      noShow,
      checkedOut,
      fill,
      dim: !matchesFilter(res),
    };
  };
  const barIcon = (ex: ReturnType<typeof barExtras>) =>
    ex.checkedOut ? <Check aria-hidden className="size-3.5 shrink-0" /> : ex.identity ? <MarkerIconView name={ex.identity.icon} className="size-3.5 shrink-0" /> : <User aria-hidden className="size-3.5 shrink-0" />;
  const barTitle = (res: Reservation, ex: ReturnType<typeof barExtras>) =>
    `${res.primaryGuest.firstName} ${res.primaryGuest.lastName} · ${res.status.replace("_", " ")} · ${res.confirmationNo}${ex.identity ? ` · ${ex.identity.label}` : ""}${res.status === "TENTATIVE" && res.optionDate ? ` · option until ${format(new Date(res.optionDate), "d MMM")}` : ""}`;
  const BAR_BASE = "absolute left-0 right-0 top-1 bottom-1 mx-0.5 px-1.5 py-1 overflow-hidden flex flex-col justify-between cursor-pointer border transition-colors hover:brightness-110 hover:shadow-sm z-10";

  // Bookings with no room assigned stay off the chart until asked for; the toolbar toggle carries
  // the count and a warning so a hidden one is never silent.
  const [showUnassignedParam, setShowUnassignedParam] = useUrlState<"0" | "1">("unassigned", "0", ["0", "1"]);
  const showUnassigned = showUnassignedParam === "1";
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
  // Which row the pointer is over while dragging (null = the Unassigned row), to tint it
  // green when the booking fits there and red when it doesn't.
  const [dragOverRoom, setDragOverRoom] = useState<string | null | undefined>(undefined);
  // A move that cannot happen, with why and the way out (adjust the stay's dates).
  const [blocked, setBlocked] = useState<{ title: string; message: string; reservationId: string; canEditDates: boolean } | null>(null);
  // A drop onto a room of a different type waits here for the rate choice and reason.
  const [typeChange, setTypeChange] = useState<TypeChangeMove | null>(null);
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
        // A no-show with no room is never drawn (the server drops it too; this keeps a stale
        // response honest).
        setReservations(json.data.reservations.filter((r: Reservation) => !(r.status === "NO_SHOW" && !r.roomId)));
        if (Array.isArray(json.data.markerRules)) setMarkerRules(json.data.markerRules);
      }
    } catch (error) {
      console.error("Failed to load tape chart", error);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Can this booking move to that room? ──────────────────────────────────────────
  // Checked against what is on the chart (and again by the server on drop). A booking
  // moves with its own dates, so the target room has to be free for ALL its nights; an
  // in-house guest moves from the business date onward (earlier nights stay in the old room).
  const holding = (status: string) => status === "RESERVED" || status === "IN_HOUSE";
  const dayKey = (iso: string) => iso.slice(0, 10);
  const todayKey = business.ready ? toDateKey(business.today) : null;
  const pretty = (key: string) => format(parseISO(key), "dd MMM");
  const nightsIn = (from: string, to: string) => Math.max(0, differenceInDays(parseISO(to), parseISO(from)));

  const moveWindow = (res: Reservation) => {
    const checkIn = dayKey(res.checkInDate);
    const start = res.status === "IN_HOUSE" && todayKey && todayKey > checkIn ? todayKey : checkIn;
    return { start, end: dayKey(res.checkOutDate) };
  };

  // Only bookings that still hold a room can be moved, and an in-house guest only on the
  // segment they are in now.
  const canDrag = (res: Reservation) => {
    if (!holding(res.status)) return false;
    if (res.status === "IN_HOUSE") {
      if (!todayKey) return false;
      return dayKey(res.checkInDate) <= todayKey && todayKey < dayKey(res.checkOutDate);
    }
    return true;
  };

  type Verdict = { ok: true } | { ok: false; title: string; message: string; canEditDates: boolean };
  const verdictFor = (dragged: Reservation, room: Room | null): Verdict => {
    if (!room) {
      return dragged.status === "IN_HOUSE"
        ? { ok: false, title: "Guest is in the house", message: "An in-house guest can't be left without a room. Drop the booking on another room instead.", canEditDates: false }
        : { ok: true };
    }
    if (dragged.roomId === room.id) return { ok: true };
    const { start, end } = moveWindow(dragged);
    if (end <= start) {
      return { ok: false, title: "Nothing left to move", message: "This guest is due out today, so there are no nights left to move to another room.", canEditDates: false };
    }
    const clash = reservations
      .filter((r) => r.roomId === room.id && r.id !== dragged.id && r.reservationId !== dragged.reservationId && holding(r.status) && dayKey(r.checkInDate) < end && dayKey(r.checkOutDate) > start)
      .sort((x, y) => dayKey(x.checkInDate).localeCompare(dayKey(y.checkInDate)))[0];
    if (!clash) return { ok: true };
    const nights = nightsIn(start, end);
    const guest = `${clash.primaryGuest.firstName} ${clash.primaryGuest.lastName}`.trim();
    return {
      ok: false,
      title: "It doesn't fit in that room",
      message: `Room ${room.roomNumber} is booked by ${guest} from ${pretty(dayKey(clash.checkInDate))} to ${pretty(dayKey(clash.checkOutDate))}, but this stay needs it for ${nights} night${nights === 1 ? "" : "s"} (${pretty(start)} - ${pretty(end)}). Adjust the stay's dates first, or choose a room that is free for all ${nights} night${nights === 1 ? "" : "s"}.`,
      canEditDates: true,
    };
  };

  const draggedRes = draggedAssignmentId ? reservations.find((r) => r.id === draggedAssignmentId) ?? null : null;
  const rowTint = (roomId: string | null) => {
    if (!draggedRes || dragOverRoom === undefined || dragOverRoom !== roomId) return "";
    const v = verdictFor(draggedRes, roomId ? rooms.find((r) => r.id === roomId) ?? null : null);
    return v.ok ? "bg-success-muted/60 ring-2 ring-inset ring-success/50" : "bg-destructive-muted/60 ring-2 ring-inset ring-destructive/50 cursor-not-allowed";
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedAssignmentId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  // After a successful move the booking pulses once in its new slot, so the eye finds where
  // it went. Deliberately not a layout animation: bars are HTML5-draggable grid items, and
  // sliding every bar on every scroll or window change would be noise on the busiest screen.
  const [landedId, setLandedId] = useState<string | null>(null);
  const markLanded = (id: string) => {
    setLandedId(id);
    setTimeout(() => setLandedId((cur) => (cur === id ? null : cur)), 1800);
  };

  const handleDragEnd = () => {
    setDraggedAssignmentId(null);
    setDragOverRoom(undefined);
  };

  const handleDragOver = (e: React.DragEvent, roomId: string | null) => {
    e.preventDefault();
    if (dragOverRoom !== roomId) setDragOverRoom(roomId);
    if (draggedRes) {
      const v = verdictFor(draggedRes, roomId ? rooms.find((r) => r.id === roomId) ?? null : null);
      e.dataTransfer.dropEffect = v.ok ? "move" : "none";
    }
  };

  const handleDrop = async (e: React.DragEvent, roomId: string | null) => {
    e.preventDefault();
    setDragOverRoom(undefined);
    const assignmentId = e.dataTransfer.getData("text/plain") || draggedAssignmentId;
    if (!assignmentId) return;

    const dragged = reservations.find((r) => r.id === assignmentId);
    const target = roomId ? rooms.find((r) => r.id === roomId) : null;
    if (dragged) {
      if (target && dragged.roomId === target.id) {
        setDraggedAssignmentId(null);
        return; // dropped back where it was
      }
      const verdict = verdictFor(dragged, target ?? null);
      if (!verdict.ok) {
        setBlocked({ title: verdict.title, message: verdict.message, reservationId: dragged.reservationId, canEditDates: verdict.canEditDates });
        setDraggedAssignmentId(null);
        return;
      }
    }
    if (dragged && target && dragged.roomId !== target.id) {
      // A room of the SAME type is just a move. A different type changes the rate, so it
      // asks which rate to bill and why first (same questions as the Front Desk room move).
      if (dragged.roomType.code !== target.roomType.code) {
        const from = dragged.roomId ? rooms.find((r) => r.id === dragged.roomId) : null;
        setTypeChange({
          assignmentId,
          reservationId: dragged.reservationId,
          status: dragged.status,
          guestName: `${dragged.primaryGuest.firstName} ${dragged.primaryGuest.lastName}`.trim(),
          fromRoomLabel: from ? `Room ${from.roomNumber}` : "Unassigned",
          fromTypeLabel: dragged.roomType.name,
          toRoomId: target.id,
          toRoomNumber: target.roomNumber,
          toTypeId: target.roomTypeId,
          toTypeLabel: target.roomType.name,
        });
        setDraggedAssignmentId(null);
        return;
      }
      // An in-house guest moves through the room move (old room to dirty, new segment from
      // today), as on the Front Desk; the reason is implicit for a same-type move.
      if (dragged.status === "IN_HOUSE") {
        try {
          setIsLoading(true);
          const res = await fetch(`/api/reservations/${dragged.reservationId}/room-move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newRoomId: target.id, newRoomTypeId: target.roomTypeId, reason: "Moved on the tape chart" }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (/occupied|booked|fit/i.test(json.error ?? "") && dragged) {
              setBlocked({ title: "It doesn't fit in that room", message: json.error, reservationId: dragged.reservationId, canEditDates: true });
            } else toast.error(json.error || "Failed to move the guest.");
          } else {
            await fetchData(startDate);
            markLanded(assignmentId);
          }
        } catch {
          toast.error("An error occurred while moving the guest.");
        } finally {
          setIsLoading(false);
          setDraggedAssignmentId(null);
        }
        return;
      }
    }

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
        if (/occupied|booked|fit/i.test(json.error ?? "") && dragged) {
          setBlocked({ title: "It doesn't fit in that room", message: json.error, reservationId: dragged.reservationId, canEditDates: true });
        } else toast.error(json.error || "Failed to reassign room.");
      } else {
        await fetchData(startDate);
        markLanded(assignmentId);
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
                    {selectedReservation.primaryGuest.vipLevel && <GoldStar className="h-3.5 w-3.5 shrink-0" />}
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

  // Overflow bookings (partner hotel) get their own row beside Unassigned (A-8).
  const unassignedReservations = reservations.filter(r => !r.roomId && !r.markerFacts?.isOverflow);
  const overflowReservations = reservations.filter(r => !!r.markerFacts?.isOverflow);
  // Distinct bookings (a split stay has several bars), not bars.
  const unassignedCount = new Set(unassignedReservations.map(r => r.reservationId)).size;

  // Legend: the kinds actually on screen, plus the two states.
  const legendKinds = new Map<string, { label: string; icon: React.ReactNode; swatch: string }>();
  for (const r of reservations) {
    const ex = barExtras(r);
    const key = ex.kind === "group" ? "group" : ex.identity ? `${ex.identity.label}|${ex.identity.color}` : "individual";
    if (legendKinds.has(key)) continue;
    legendKinds.set(key, {
      label: ex.kind === "group" ? "Group" : ex.identity ? ex.identity.label : "Individual",
      icon: barIcon(ex),
      swatch: ex.kind === "group" ? MARKER_COLORS.slate.solid : ex.identity ? MARKER_COLORS[ex.identity.color].solid : "bg-primary border-primary text-primary-foreground",
    });
  }

  // Weekend columns (Sat/Sun, as on Availability) get a visible tint and the business date a
  // primary one, so the eye can find "today" and the weekend without reading the numbers.
  const dayTint = (date: Date, header = false) => {
    if (business.ready && isEqual(date, business.today)) return header ? "bg-primary/15 border-b-2 border-b-primary" : "bg-primary/[0.07]";
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    return weekend ? (header ? "bg-muted-foreground/15" : "bg-muted-foreground/[0.08]") : "";
  };

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
      <button
        type="button"
        aria-pressed={showUnassigned}
        onClick={() => setShowUnassignedParam(showUnassigned ? "0" : "1")}
        title={showUnassigned ? "Hide bookings with no room" : "Show bookings with no room"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11",
          showUnassigned ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {unassignedCount > 0 && <AlertTriangle aria-hidden className={cn("h-3.5 w-3.5", showUnassigned ? "" : "text-warning")} />}
        Unassigned
        {unassignedCount > 0 && <span className="tabular-nums">({unassignedCount})</span>}
      </button>
      <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {[...legendKinds.values()].map((k) => (
          <li key={k.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("inline-flex h-4 w-4 items-center justify-center border", k.swatch)}>{k.icon}</span>
            {k.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 border border-dashed border-primary bg-primary/[0.07]" />
          Tentative
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 border-[1.5px] border-primary" />
          Checked out
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 border border-border bg-muted opacity-60" />
          No-show
        </li>
      </ul>
      <div className="w-44">
        <SearchableSelect value={markerFilter} onChange={setMarkerFilter} placeholder="All bookings" options={filterOptions} />
      </div>
    </div>

    {/* Scrolls both ways inside the card so the date row and the room column stay pinned.
        Fades in on load (motion branch); reduced-motion users get no animation. */}
    <div className="w-full overflow-auto relative bg-card max-h-[calc(100dvh-15rem)] min-h-80 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
    {/* w-max + min-w-full: every row shares one width, so the last day is never clipped and
        wide windows scroll cleanly with the room column pinned. */}
    <div className="w-max min-w-full">
      {/* Date Header Row */}
      <div className="flex border-b border-border bg-muted sticky top-0 z-30">
        <div className="w-32 shrink-0 border-r border-border p-2 flex items-center font-semibold text-foreground bg-muted z-30 sticky left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] text-sm">
          Rooms
        </div>
        <div className="flex-1 grid" style={{ gridTemplateColumns: colTemplate }}>
          {columns.map(date => (
            <div key={date.toISOString()} className={cn("border-r border-border p-1 text-center", dayTint(date, true))}>
              <div className={cn("font-semibold text-muted-foreground uppercase", dense ? "text-[10px]" : "text-[11px] tracking-wider")}>
                {format(date, dense ? "EEEEE" : "EEE")}
              </div>
              <div className={cn("font-bold tabular-nums", dense ? "text-sm" : "text-base", isEqual(date, business.today) ? "text-primary" : "text-foreground")}>
                {format(date, "d")}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">{format(date, "MMM")}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Unassigned Reservations Row (Only show if there are any) */}
      {showUnassigned && unassignedReservations.length > 0 && (
        <div className="flex border-b border-warning/30 bg-warning-muted/60">
          <div className="w-32 shrink-0 border-r border-border p-2 bg-warning-muted z-20 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span className="font-bold text-warning text-xs">Unassigned</span>
            <span className="text-[10px] text-warning/80">{unassignedReservations.length} Bookings</span>
          </div>
          <div
            className="flex-1 grid relative p-1"
            style={{ gridTemplateColumns: colTemplate }}
            onDragOver={(e) => handleDragOver(e, null)}
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

              const ex = barExtras(res);
              return (
                <div
                  key={res.id}
                  onClick={() => setSelectedReservation(res)}
                  draggable={canDrag(res)}
                  onDragStart={(e) => handleDragStart(e, res.id)}
                  onDragEnd={handleDragEnd}
                  title={barTitle(res, ex)}
                  className={cn(BAR_BASE, ex.fill, landedId === res.id && "tape-landed", ex.dim && "opacity-30")}
                  style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                >
                  <span className="flex min-w-0 items-center gap-1 font-bold text-xs leading-tight">
                    {barIcon(ex)}
                    <span className="truncate">{res.primaryGuest.lastName}</span>
                  </span>
                  <span className="text-[10px] font-medium opacity-80 truncate">{res.roomType.code}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {overflowReservations.length > 0 && (
        <div className="flex border-b border-border bg-muted/40">
          <div className="w-32 shrink-0 border-r border-border p-2 bg-muted z-20 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span className="font-bold text-foreground text-xs">Overflow</span>
            <span className="text-[10px] text-muted-foreground">{overflowReservations.length} at partner hotels</span>
          </div>
          <div className="flex-1 grid relative p-1" style={{ gridTemplateColumns: colTemplate }}>
            {columns.map((_, i) => (
              <div key={`overflow-grid-${i}`} className="border-r border-dashed border-border h-14" style={{ gridColumn: i + 1 }} />
            ))}
            {overflowReservations.map(res => {
              const style = getBlockStyle(res.checkInDate, res.checkOutDate);
              if (style.gridColumnEnd <= 1 || style.gridColumnStart > daysToShow) return null;
              const ex = barExtras(res);
              return (
                <div
                  key={res.id}
                  onClick={() => setSelectedReservation(res)}
                  title={`${barTitle(res, ex)} · Overflow`}
                  className={cn(BAR_BASE, ex.fill, ex.dim && "opacity-30")}
                  style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                >
                  <span className="flex min-w-0 items-center gap-1 font-bold text-xs leading-tight">
                    {barIcon(ex)}
                    <span className="truncate">{res.primaryGuest.lastName}</span>
                  </span>
                  <span className="text-[10px] font-mono opacity-80 truncate">#{res.confirmationNo}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Room Rows Grouped by Floor */}
      {Object.entries(groupedRooms).map(([floor, floorRooms]) => (
        <div key={floor}>
          <div className="bg-muted text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-0.5 sticky left-0 z-20 border-b border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-32">
            Floor {floor}
          </div>

          {floorRooms.map(room => {
            const roomReservations = reservations.filter(r => r.roomId === room.id);

            return (
              <div key={room.id} className="flex border-b border-border group hover:bg-muted/50 transition-colors">
                <div className="w-32 shrink-0 border-r border-border p-2 bg-card group-hover:bg-muted/50 z-20 sticky left-0 flex flex-col justify-center shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                  <span className="font-bold text-foreground text-sm leading-tight">{room.roomNumber}</span>
                  <span className="text-[11px] text-muted-foreground font-medium truncate">{room.roomType.name}</span>
                </div>

                {/* Data Grid for this room */}
                <div
                  className={cn("flex-1 grid relative p-1 transition-colors", rowTint(room.id))}
                  style={{ gridTemplateColumns: colTemplate }}
                  onDragOver={(e) => handleDragOver(e, room.id)}
                  onDrop={(e) => handleDrop(e, room.id)}
                >
                  {/* Background Grid Lines — clicking an empty cell opens a booking
                      prefilled with this room and that date */}
                  {columns.map((date, i) => (
                    <div
                      key={`${room.id}-grid-${i}`}
                      className={cn("border-r border-border h-14 cursor-crosshair hover:bg-muted/50 transition-colors", dayTint(date))}
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

                    const ex = barExtras(res);
                    return (
                      <div
                        key={res.id}
                        onClick={() => setSelectedReservation(res)}
                        draggable={canDrag(res)}
                        onDragStart={(e) => handleDragStart(e, res.id)}
                        onDragEnd={handleDragEnd}
                        title={barTitle(res, ex)}
                        className={cn(BAR_BASE, ex.fill, landedId === res.id && "tape-landed", ex.dim && "opacity-30")}
                        style={{ gridColumn: `${style.gridColumnStart} / ${style.gridColumnEnd}` }}
                      >
                        <span className="flex min-w-0 items-center gap-1 font-bold text-xs leading-tight">
                          {barIcon(ex)}
                          <span className="truncate">{res.primaryGuest.lastName}</span>
                        </span>
                        <span className="mt-1 text-[10px] font-mono opacity-80 truncate">#{res.confirmationNo}{ex.noShow ? " · No-show" : ""}</span>
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
    <Dialog open={!!blocked} onOpenChange={(open) => !open && setBlocked(null)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{blocked?.title}</DialogTitle>
          <DialogDescription>{blocked?.message}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => setBlocked(null)}>Close</Button>
          {blocked?.canEditDates && (
            <Button onClick={() => { const id = blocked.reservationId; setBlocked(null); router.push(`/e/${slug}/dashboard/reservations/${id}/edit`); }}>
              Adjust the dates
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <TapeChartTypeChangeDialog move={typeChange} onClose={() => setTypeChange(null)} onDone={() => fetchData(startDate)} />
    </>
  );
}
