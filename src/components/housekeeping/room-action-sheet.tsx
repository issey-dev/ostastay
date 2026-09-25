"use client"

import { useState } from "react"
import { AlertTriangle, Bell, Brush, CheckCircle2, ChevronRight, Users, Wrench } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"
import { statusMutedClasses, toneMutedClasses } from "@/lib/status-tone"

// Phone-only pieces of the housekeeping board (.agents/docs/MOBILE_PLAN.md §2.3): a compact
// room row instead of the ~170px card, and a bottom sheet with big status buttons. Both call
// the page's existing handlers — the same API requests the desktop controls make.

/** Occupancy / priority flags derived exactly like RoomStatusCard does. */
export function roomFlags(room: any, businessDate?: string | null) {
  const assignments: any[] = room.RoomAssignment ?? []
  const active = assignments.find((a) => a.reservation?.status === "IN_HOUSE")
  const arriving = assignments.find((a) => a.reservation?.status === "RESERVED")
  const todayIso = (businessDate ?? new Date().toISOString()).slice(0, 10)
  const isOccupied = !!active
  const isDueOut = isOccupied && active.reservation?.checkOutDate?.slice(0, 10) === todayIso
  const hasArrivalToday = !!arriving && arriving.reservation?.checkInDate?.slice(0, 10) === todayIso
  const openTasks: any[] = (room.housekeepingTasks ?? []).filter((t: any) => t.status !== "COMPLETED")
  const activeTicket = room.maintenance?.length > 0 ? room.maintenance[0] : null
  const guest = active?.reservation?.primaryGuest
  const guestName = guest ? `${guest.firstName ?? ""} ${guest.lastName ?? ""}`.trim() : ""
  return { isOccupied, isDueOut, hasArrivalToday, openTasks, activeTicket, guestName }
}

const statusLabel = (status: string) => status.replace(/_/g, " ").toLowerCase()

export function HousekeepingRoomRow({
  room,
  businessDate,
  selectMode,
  isSelected,
  onOpen,
  onToggleSelect,
}: {
  room: any
  businessDate?: string | null
  selectMode: boolean
  isSelected: boolean
  onOpen: (roomId: string) => void
  onToggleSelect: (roomId: string) => void
}) {
  const f = roomFlags(room, businessDate)
  return (
    <button
      type="button"
      onClick={() => (selectMode ? onToggleSelect(room.id) : onOpen(room.id))}
      aria-pressed={selectMode ? isSelected : undefined}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors active:bg-muted",
        isSelected && "border-primary ring-2 ring-primary/40"
      )}
    >
      {selectMode && (
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
          )}
        >
          {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
      )}
      <div className="w-12 shrink-0">
        <p className="text-lg font-bold leading-tight tabular-nums">{room.roomNumber}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{room.roomType?.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className={cn("rounded border px-1.5 py-0.5 text-[11px] font-semibold capitalize", statusMutedClasses(room.status))}>
            {statusLabel(room.status)}
          </span>
          {f.isOccupied ? (
            f.isDueOut ? (
              <span className="rounded bg-warning-muted px-1.5 py-0.5 text-[11px] font-bold text-warning">Due out</span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Occupied</span>
            )
          ) : (
            <span className="text-[11px] text-muted-foreground">Vacant</span>
          )}
          {f.hasArrivalToday && (
            <span className="rounded bg-info-muted px-1.5 py-0.5 text-[11px] font-bold text-info">Arrival</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {f.activeTicket && <Wrench className="h-4 w-4 text-destructive" aria-label="Open maintenance issue" />}
        {f.openTasks.length > 0 && (
          <span className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-bold text-warning">
            {f.openTasks.length} task{f.openTasks.length === 1 ? "" : "s"}
          </span>
        )}
        {!selectMode && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    </button>
  )
}

export function RoomActionSheet({
  room,
  businessDate,
  onClose,
  onStatusChange,
  onCompleteTask,
  onMarkOutOfOrder,
  onReportIssue,
  onEditMaintenance,
}: {
  room: any | null
  businessDate?: string | null
  onClose: () => void
  onStatusChange: (roomId: string, status: string) => Promise<void> | void
  onCompleteTask: (taskId: string) => Promise<void> | void
  onMarkOutOfOrder: (roomId: string) => void
  onReportIssue: (roomId: string) => void
  onEditMaintenance: (ticket: any) => void
}) {
  const [busy, setBusy] = useState(false)
  const f = room ? roomFlags(room, businessDate) : null

  const setStatus = async (status: string) => {
    if (!room || busy) return
    setBusy(true)
    try {
      await onStatusChange(room.id, status)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const completeTask = async (taskId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await onCompleteTask(taskId)
    } finally {
      setBusy(false)
    }
  }

  const big = "h-14 justify-start gap-3 text-base font-semibold"

  return (
    <Drawer open={!!room} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        {room && f && (
          <>
            <DrawerHeader>
              <DrawerTitle className="flex items-center gap-2">
                Room {room.roomNumber}
                <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold capitalize", statusMutedClasses(room.status))}>
                  {statusLabel(room.status)}
                </span>
              </DrawerTitle>
              <DrawerDescription>
                {room.roomType?.name}
                {" · "}
                {f.isOccupied ? `${f.isDueOut ? "Due out" : "Occupied"}${f.guestName ? ` — ${f.guestName}` : ""}` : "Vacant"}
                {f.hasArrivalToday && " · Arrival today"}
              </DrawerDescription>
              {room.assignedAttendant && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {room.assignedAttendant.firstName} {room.assignedAttendant.lastName}
                </p>
              )}
            </DrawerHeader>
            <DrawerBody className="space-y-4">
              {f.openTasks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open tasks</p>
                  {f.openTasks.map((task: any) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-warning/20 bg-warning-muted px-3 py-2 text-sm text-warning"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 leading-snug">
                        {task.taskType === "SPECIAL_REQUEST" && <Bell className="h-4 w-4 shrink-0" />}
                        <span className="min-w-0 break-words">
                          {task.taskType === "SPECIAL_REQUEST" ? task.notes : task.taskType.replace(/_/g, " ")}
                        </span>
                      </span>
                      <Button size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={busy} onClick={() => completeTask(task.id)}>
                        <CheckCircle2 className="h-4 w-4" />
                        Complete
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {f.activeTicket && (
                <button
                  type="button"
                  onClick={() => onEditMaintenance(f.activeTicket)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-muted px-3 py-2 text-left text-sm text-destructive"
                >
                  <Wrench className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{f.activeTicket.description}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </button>
              )}

              {room.status === "OUT_OF_ORDER" && room.oooReason && (
                <p className="rounded-lg border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
                  {room.oooReason}
                </p>
              )}

              <div className="grid grid-cols-1 gap-2">
                <Button disabled={busy || room.status === "CLEAN"} onClick={() => setStatus("CLEAN")} className={cn(big, "border", toneMutedClasses("success"))}>
                  <CheckCircle2 className="h-5 w-5" /> Mark clean
                </Button>
                <Button disabled={busy || room.status === "INSPECTED"} onClick={() => setStatus("INSPECTED")} className={cn(big, "border", toneMutedClasses("info"))}>
                  <CheckCircle2 className="h-5 w-5" /> Mark inspected
                </Button>
                <Button disabled={busy || room.status === "DIRTY"} onClick={() => setStatus("DIRTY")} className={cn(big, "border", toneMutedClasses("danger"))}>
                  <Brush className="h-5 w-5" /> {room.status === "OUT_OF_ORDER" ? "Return to service (dirty)" : "Mark dirty"}
                </Button>
                <Button disabled={busy} onClick={() => onReportIssue(room.id)} className={cn(big, "border", toneMutedClasses("warning"))}>
                  <Wrench className="h-5 w-5" /> Report issue
                </Button>
                {room.status !== "OUT_OF_ORDER" && (
                  <Button disabled={busy} variant="outline" onClick={() => onMarkOutOfOrder(room.id)} className={big}>
                    <AlertTriangle className="h-5 w-5" /> Out of order…
                  </Button>
                )}
              </div>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
