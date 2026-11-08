"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Brush, CheckCircle2, Users, Wrench } from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { statusTone, type StatusTone } from "@/lib/status-tone"
import { roomFlags } from "@/components/housekeeping/room-action-sheet"

// The housekeeping "ledger" card, used on every screen size (phones get one column of them,
// tablets two, desktops three). A big room number and a coloured status word, then a small
// Type / Stay / Task list. Type, Stay and Task are always present so rows line up across a
// grid; Request, Staff and Tech appear only when there is something to show. Flags are words
// (bold amber "Due out", bold blue "Arrival today"), never pills or fills. Square corners come
// from the theme (--radius: 0). A click opens the room's status menu (desktop/tablet) or its
// action sheet (phones, via `onOpen`); in Select mode a click toggles the room for the bulk bar.

const DOT: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
}

const WORD: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  neutral: "text-muted-foreground",
}

const statusLabel = (status: string) => {
  const s = status.replace(/_/g, " ").toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const taskLabel = (taskType: string) => statusLabel(taskType)

/** One label + value pair of the card's list. */
function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <>
      <dt className={cn("text-xs text-muted-foreground", className)}>{label}</dt>
      <dd className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1", className)}>{children}</dd>
    </>
  )
}

type RoomStatusCardProps = {
  room: any
  slug: string
  onStatusChange: (roomId: string, newStatus: string) => Promise<void> | void
  /** Select mode: a click toggles the room for the bulk bar instead of opening its menu. */
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (roomId: string) => void
  /** Phones: a click opens this room's action sheet instead of the dropdown menu. */
  onOpen?: (roomId: string) => void
  onEditMaintenance?: (ticket: any) => void
  onCompleteTask?: (taskId: string) => Promise<void> | void
  onMarkOutOfOrder?: (roomId: string) => void
  onReportIssue?: (roomId: string) => void
  onAssign?: (roomId: string) => void
  /** The property's business date (YYYY-MM-DD) — the operational "today" that
   *  drives due-out / arrival-today flags. Falls back to the wall clock. */
  businessDate?: string | null
}

export function RoomStatusCard({
  room,
  slug,
  onStatusChange,
  selectMode,
  isSelected,
  onToggleSelect,
  onOpen,
  onEditMaintenance,
  onCompleteTask,
  onMarkOutOfOrder,
  onReportIssue,
  onAssign,
  businessDate,
}: RoomStatusCardProps) {
  const [loading, setLoading] = useState(false)

  const f = roomFlags(room, businessDate)
  // The board's assignments include both the current IN_HOUSE stay and any RESERVED stay
  // arriving today — occupancy comes from the former only.
  const occ = (room.RoomAssignment ?? []).find((a: any) => a.reservation?.status === "IN_HOUSE")?.reservation ?? null
  const hasSharer = (occ?.accompanyingGuests?.length ?? 0) > 0
  const adults = occ?.adults ?? 0
  const children = occ?.children ?? 0
  const infants = occ?.infants ?? 0
  const pax = [
    `${adults}A`,
    children > 0 ? `${children}C` : null,
    infants > 0 ? `${infants}I` : null,
  ].filter(Boolean).join(" ")
  const paxTitle = [
    `${adults} adult${adults === 1 ? "" : "s"}`,
    children > 0 ? `${children} child${children === 1 ? "" : "ren"}` : null,
    infants > 0 ? `${infants} infant${infants === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(", ")

  const specialRequests = f.openTasks.filter((t: any) => t.taskType === "SPECIAL_REQUEST")
  const regularTasks = f.openTasks.filter((t: any) => t.taskType !== "SPECIAL_REQUEST")
  const activeTicket = f.activeTicket
  const tone = statusTone(room.status)
  const isOutOfOrder = room.status === "OUT_OF_ORDER"
  const oooLine = [
    room.oooReason,
    room.oooExpectedReturn &&
      `back ${new Date(room.oooExpectedReturn).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`,
  ].filter(Boolean).join(" · ")

  const setStatus = async (status: string) => {
    if (loading) return
    setLoading(true)
    try {
      await onStatusChange(room.id, status)
    } finally {
      setLoading(false)
    }
  }

  const completeTask = async (taskId: string) => {
    if (loading || !onCompleteTask) return
    setLoading(true)
    try {
      await onCompleteTask(taskId)
    } finally {
      setLoading(false)
    }
  }

  // Small ✓ beside a task: hidden until the card is hovered/focused on a mouse; always
  // shown on touch (phones and tablets get a 44px target).
  const tickClass =
    "relative z-10 inline-flex shrink-0 items-center justify-center self-center p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-success focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:border pointer-coarse:border-border pointer-coarse:opacity-100"

  const overlayClass =
    "absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

  return (
    <div
      className={cn(
        // Phones: tighter padding (the card is full width there and a floor can hold 20 rooms).
        "group relative flex h-full min-w-0 flex-col border border-border bg-card px-5 py-4 text-sm transition-colors hover:border-foreground/25 max-md:px-4 max-md:py-3",
        loading && "opacity-60",
        isSelected && "border-primary ring-2 ring-primary/40"
      )}
    >
      {/* The whole card is the click target; links/buttons inside sit above it (z-10). */}
      {selectMode ? (
        <button
          type="button"
          aria-pressed={!!isSelected}
          aria-label={`Select room ${room.roomNumber}`}
          className={overlayClass}
          onClick={() => onToggleSelect?.(room.id)}
        />
      ) : onOpen ? (
        <button type="button" aria-label={`Room ${room.roomNumber} actions`} className={overlayClass} onClick={() => onOpen(room.id)} />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Room ${room.roomNumber} actions`} className={overlayClass} />
          <DropdownMenuContent className="w-auto min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Room {room.roomNumber} · {statusLabel(room.status)}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem disabled={loading || room.status === "CLEAN"} onClick={() => setStatus("CLEAN")}>
              <CheckCircle2 /> Mark clean
            </DropdownMenuItem>
            <DropdownMenuItem disabled={loading || room.status === "INSPECTED"} onClick={() => setStatus("INSPECTED")}>
              <CheckCircle2 /> Mark inspected
            </DropdownMenuItem>
            <DropdownMenuItem disabled={loading || room.status === "DIRTY"} onClick={() => setStatus("DIRTY")}>
              <Brush /> {room.status === "OUT_OF_ORDER" ? "Return to service (dirty)" : "Mark dirty"}
            </DropdownMenuItem>
            {f.openTasks.length > 0 && <DropdownMenuSeparator />}
            {f.openTasks.map((task: any) => (
              <DropdownMenuItem key={task.id} disabled={loading} onClick={() => completeTask(task.id)}>
                <CheckCircle2 />
                <span className="max-w-56 truncate">
                  Complete: {task.taskType === "SPECIAL_REQUEST" ? task.notes || "Special request" : taskLabel(task.taskType)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {onAssign && (
              <DropdownMenuItem onClick={() => onAssign(room.id)}>
                <Users /> {room.assignedAttendant ? "Reassign attendant…" : "Assign attendant…"}
              </DropdownMenuItem>
            )}
            {onReportIssue && (
              <DropdownMenuItem onClick={() => onReportIssue(room.id)}>
                <Wrench /> Report issue…
              </DropdownMenuItem>
            )}
            {activeTicket && onEditMaintenance && (
              <DropdownMenuItem onClick={() => onEditMaintenance(activeTicket)}>
                <Wrench /> <span className="max-w-56 truncate">Open issue: {activeTicket.description}</span>
              </DropdownMenuItem>
            )}
            {room.status !== "OUT_OF_ORDER" && onMarkOutOfOrder && (
              <DropdownMenuItem variant="destructive" onClick={() => onMarkOutOfOrder(room.id)}>
                <AlertTriangle /> Out of order…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Room number · status */}
      <div className="pointer-events-none flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {selectMode && (
            <span
              aria-hidden
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center border",
                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground bg-card"
              )}
            >
              {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
            </span>
          )}
          <span className="text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums max-md:text-2xl">{room.roomNumber}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeTicket && (
            <button
              type="button"
              onClick={() => onEditMaintenance?.(activeTicket)}
              title={`${activeTicket.status}: ${activeTicket.description}${activeTicket.assignedTo ? `\nAssigned to: ${activeTicket.assignedTo.firstName} ${activeTicket.assignedTo.lastName}` : ""}`}
              aria-label="Open maintenance issue"
              className={cn(
                "pointer-events-auto relative z-10 inline-flex items-center justify-center p-0.5 transition-colors hover:bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                activeTicket.status === "IN_PROGRESS" ? "text-warning" : "text-destructive"
              )}
            >
              <Wrench className="h-4 w-4" />
            </button>
          )}
          <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", WORD[tone])}>
            <span aria-hidden className={cn("h-2 w-2", DOT[tone])} />
            {statusLabel(room.status)}
          </span>
        </div>
      </div>

      <div aria-hidden className="my-3.5 h-px bg-border max-md:my-2.5" />

      <dl className="pointer-events-none grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5">
        <Row label="Type">
          <span className="truncate">{room.roomType?.name ?? "—"}</span>
        </Row>

        <Row label="Stay">
          {isOutOfOrder ? (
            <span className="truncate" title={room.oooReason || undefined}>{oooLine || "Out of order"}</span>
          ) : occ ? (
            <>
              <Link
                href={`/e/${slug}/dashboard/reservations/${occ.id}`}
                className="pointer-events-auto relative z-10 min-w-0 max-w-full truncate font-medium hover:underline"
              >
                {f.guestName || "Guest"}
              </Link>
              <span className="font-mono text-xs text-muted-foreground tabular-nums" title={paxTitle}>{pax}</span>
              {hasSharer && <span className="text-xs text-muted-foreground">Sharer</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Vacant</span>
          )}
          {f.isDueOut && <span className="font-bold text-warning">Due out</span>}
          {f.hasArrivalToday && <span className="font-bold text-info">Arrival today</span>}
        </Row>

        {/* Phones drop the row when there is no task: one less line per room. */}
        <Row label="Task" className={regularTasks.length === 0 ? "max-md:hidden" : undefined}>
          {regularTasks.length === 0 ? (
            <span className="text-muted-foreground/70">—</span>
          ) : (
            regularTasks.map((task: any) => (
              <span key={task.id} className="inline-flex items-center gap-1.5" title={task.notes || undefined}>
                {taskLabel(task.taskType)}
                {onCompleteTask && (
                  <button
                    type="button"
                    className={cn(tickClass, "pointer-events-auto")}
                    title="Mark as completed"
                    aria-label={`Complete ${taskLabel(task.taskType)}`}
                    disabled={loading}
                    onClick={() => completeTask(task.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))
          )}
        </Row>

        {specialRequests.map((req: any) => (
          <Row key={req.id} label="Request">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="truncate" title={req.notes || undefined}>{req.notes || "Special request"}</span>
              {onCompleteTask && (
                <button
                  type="button"
                  className={cn(tickClass, "pointer-events-auto")}
                  title="Mark as completed"
                  aria-label="Complete special request"
                  disabled={loading}
                  onClick={() => completeTask(req.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </Row>
        ))}

        {room.assignedAttendant && (
          <Row label="Staff">
            <span className="truncate">{room.assignedAttendant.firstName} {room.assignedAttendant.lastName}</span>
          </Row>
        )}
        {activeTicket?.assignedTo && (
          <Row label="Tech">
            <span className="truncate" title="Maintenance technician">
              {activeTicket.assignedTo.firstName} {activeTicket.assignedTo.lastName}
            </span>
          </Row>
        )}
      </dl>
    </div>
  )
}
