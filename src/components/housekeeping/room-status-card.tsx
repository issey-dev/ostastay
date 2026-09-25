"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, Bell, Brush, CheckCircle2, Users, Wrench } from "@/components/icons"
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

// Desktop/tablet housekeeping tile (the phone board uses HousekeepingRoomRow + RoomActionSheet).
// DESKTOP_PLAN §2.3 / DECISIONS 2026-09-25 "Housekeeping board": a neutral card with a 3px
// status stripe + a labelled dot — no fully tinted tiles. A click opens the room's status
// menu (same handlers as the phone action sheet); in Select mode a click toggles the room
// for the bulk bar instead.

const STRIPE: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
}

const statusLabel = (status: string) => {
  const s = status.replace(/_/g, " ").toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const taskLabel = (taskType: string) => statusLabel(taskType)

type RoomStatusCardProps = {
  room: any
  slug: string
  onStatusChange: (roomId: string, newStatus: string) => Promise<void> | void
  /** Select mode: a click toggles the room for the bulk bar instead of opening its menu. */
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (roomId: string) => void
  onEditMaintenance?: (ticket: any) => void
  onCompleteTask?: (taskId: string) => Promise<void> | void
  onMarkOutOfOrder?: (roomId: string) => void
  onReportIssue?: (roomId: string) => void
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
  onEditMaintenance,
  onCompleteTask,
  onMarkOutOfOrder,
  onReportIssue,
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
  // shown on touch (tablets see this card too).
  const tickClass =
    "relative z-10 inline-flex shrink-0 items-center justify-center p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-success focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:opacity-100"

  const overlayClass =
    "absolute inset-0 z-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-1 border border-border bg-card py-2.5 pr-3 pl-4 text-xs transition-colors hover:border-foreground/25",
        loading && "opacity-60",
        isSelected && "border-primary ring-2 ring-primary/40"
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", STRIPE[tone])} />

      {/* The whole card is the click target; links/buttons inside sit above it (z-10). */}
      {selectMode ? (
        <button
          type="button"
          aria-pressed={!!isSelected}
          aria-label={`Select room ${room.roomNumber}`}
          className={overlayClass}
          onClick={() => onToggleSelect?.(room.id)}
        />
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {selectMode && (
            <span
              aria-hidden
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center border",
                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
              )}
            >
              {isSelected && <CheckCircle2 className="h-3 w-3" />}
            </span>
          )}
          <span className="text-lg font-bold leading-tight tabular-nums text-foreground">{room.roomNumber}</span>
          {activeTicket && (
            <button
              type="button"
              onClick={() => onEditMaintenance?.(activeTicket)}
              title={`${activeTicket.status}: ${activeTicket.description}${activeTicket.assignedTo ? `\nAssigned to: ${activeTicket.assignedTo.firstName} ${activeTicket.assignedTo.lastName}` : ""}`}
              aria-label="Open maintenance issue"
              className={cn(
                "relative z-10 inline-flex items-center justify-center p-0.5 transition-colors hover:bg-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                activeTicket.status === "IN_PROGRESS" ? "text-warning" : "text-destructive"
              )}
            >
              <Wrench className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
          <span aria-hidden className={cn("h-1.5 w-1.5", STRIPE[tone])} />
          {statusLabel(room.status)}
        </span>
      </div>
      <p className="-mt-1 truncate text-muted-foreground">{room.roomType?.name}</p>

      {/* Occupancy */}
      {occ ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-foreground">
          <span className={cn(f.isDueOut ? "font-semibold text-warning" : "text-muted-foreground")}>
            {f.isDueOut ? "Due out" : "Occupied"}
          </span>
          <span aria-hidden className="text-muted-foreground">·</span>
          <Link
            href={`/e/${slug}/dashboard/reservations/${occ.id}`}
            className="relative z-10 min-w-0 max-w-full truncate font-medium hover:underline"
          >
            {f.guestName || "Guest"}
          </Link>
          <span aria-hidden className="text-muted-foreground">·</span>
          <span className="tabular-nums text-muted-foreground" title={paxTitle}>{pax}</span>
          {hasSharer && <span className="text-muted-foreground">· Sharer</span>}
        </p>
      ) : (
        <p className="text-muted-foreground">Vacant</p>
      )}

      {f.hasArrivalToday && (
        <p className="inline-flex items-center gap-1.5 font-semibold text-info">
          <span aria-hidden className="h-1.5 w-1.5 bg-info" />
          Arrival today
        </p>
      )}

      {room.status === "OUT_OF_ORDER" && (room.oooReason || room.oooExpectedReturn) && (
        <p className="truncate text-muted-foreground" title={room.oooReason || undefined}>
          {room.oooReason}
          {room.oooReason && room.oooExpectedReturn && " · "}
          {room.oooExpectedReturn &&
            `back ${new Date(room.oooExpectedReturn).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`}
        </p>
      )}

      {/* Tasks — one compact line */}
      {regularTasks.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-foreground">
          {regularTasks.map((task: any, i: number) => (
            <span key={task.id} className="inline-flex items-center gap-0.5" title={task.notes || undefined}>
              {i > 0 && <span aria-hidden className="mr-0.5 text-muted-foreground">·</span>}
              {taskLabel(task.taskType)}
              {onCompleteTask && (
                <button
                  type="button"
                  className={tickClass}
                  title="Mark as completed"
                  aria-label={`Complete ${taskLabel(task.taskType)}`}
                  disabled={loading}
                  onClick={() => completeTask(task.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {specialRequests.map((req: any) => (
        <div key={req.id} className="flex min-w-0 items-center gap-1 text-foreground">
          <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Special request" />
          <span className="min-w-0 flex-1 truncate" title={req.notes || undefined}>{req.notes || "Special request"}</span>
          {onCompleteTask && (
            <button
              type="button"
              className={tickClass}
              title="Mark as completed"
              aria-label="Complete special request"
              disabled={loading}
              onClick={() => completeTask(req.id)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {(room.assignedAttendant || activeTicket?.assignedTo) && (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-muted-foreground">
          {room.assignedAttendant && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Users className="h-3 w-3 shrink-0" />
              {room.assignedAttendant.firstName} {room.assignedAttendant.lastName}
            </span>
          )}
          {activeTicket?.assignedTo && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate" title="Maintenance technician">
              <Wrench className="h-3 w-3 shrink-0" />
              {activeTicket.assignedTo.firstName} {activeTicket.assignedTo.lastName}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
