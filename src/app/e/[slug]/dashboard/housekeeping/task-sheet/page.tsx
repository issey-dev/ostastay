"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { ArrowLeft, CheckCircle2, Brush, RefreshCw, ClipboardList, Users, Bell, Wrench } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InfoHint } from "@/components/ui/info-hint"
import { housekeepingStaff } from "@/lib/job-functions"

// Priority buckets, in the order an attendant should work them: rooms needed for
// an arrival first, departure cleans next, other dirty rooms, then stayover
// touch-ups. Clean/inspected rooms trail the list as confirmation.
type Bucket = { key: string; label: string; hint: string }
const BUCKETS: Bucket[] = [
  { key: "arrival", label: "Arrival today", hint: "Guest arriving — make ready first" },
  { key: "dueout", label: "Due out", hint: "Departing today — clean after checkout" },
  { key: "dirty", label: "Dirty", hint: "Vacant rooms needing a clean" },
  { key: "stayover", label: "Stayover", hint: "Occupied — service visit" },
  { key: "done", label: "Ready / other", hint: "" },
]

const todayIso = () => new Date().toISOString().slice(0, 10)

const bucketForRoom = (room: any): string => {
  const assignments: any[] = room.RoomAssignment ?? []
  const inHouse = assignments.find((a) => a.reservation?.status === "IN_HOUSE")
  const arriving = assignments.find(
    (a) => a.reservation?.status === "RESERVED" && a.reservation?.checkInDate?.slice(0, 10) === todayIso()
  )
  const needsWork = room.status === "DIRTY"
  if (arriving && room.status !== "INSPECTED" && room.status !== "CLEAN") return "arrival"
  if (arriving && needsWork) return "arrival"
  if (inHouse && inHouse.reservation?.checkOutDate?.slice(0, 10) === todayIso()) return "dueout"
  if (!inHouse && needsWork) return "dirty"
  if (inHouse) return "stayover"
  return "done"
}

// A housekeeper's working view: their assigned rooms only, ordered by what to
// clean first, with one-tap complete/mark-clean — built for a phone in a corridor,
// unlike the supervisor board's all-rooms grid.
export default function TaskSheetPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const [rooms, setRooms] = useState<any[]>([])
  const [housekeepers, setHousekeepers] = useState<any[]>([])
  const [attendantId, setAttendantId] = useState<string>("")
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean } | null>(null)

  const fetchRooms = async (silent = false) => {
    if (!currentProperty) return
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/housekeeping?propertyId=${currentProperty.id}`)
      if (res.ok) setRooms(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    if (!currentProperty) return
    fetchRooms()
    fetch(`/api/settings/users?enterpriseId=${currentProperty.enterpriseId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setHousekeepers(housekeepingStaff(data))
      })
      .catch(console.error)
    fetch(`/api/session/current-property`)
      .then((r) => r.json())
      .then((data) => { if (data?.userId) setMyUserId(data.userId) })
      .catch(console.error)
  }, [currentProperty])

  // Default the selector to "me" when the logged-in user is a housekeeper.
  useEffect(() => {
    if (!attendantId && myUserId && housekeepers.some((h) => h.id === myUserId)) {
      setAttendantId(myUserId)
    }
  }, [myUserId, housekeepers])

  useEffect(() => {
    const onFocus = () => fetchRooms(true)
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [currentProperty])

  const setRoomStatus = async (roomId: string, status: string) => {
    setBusyRoomId(roomId)
    try {
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, status }),
      })
      if (res.ok) {
        fetchRooms(true)
      } else {
        const data = await res.json()
        setNotification({ title: "Update Failed", message: data.error || "Failed to update the room.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred updating the room.", isError: true })
    } finally {
      setBusyRoomId(null)
    }
  }

  const completeTask = async (roomId: string, taskId: string) => {
    setBusyRoomId(roomId)
    try {
      const res = await fetch(`/api/housekeeping/tasks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status: "COMPLETED" }),
      })
      if (res.ok) {
        fetchRooms(true)
      } else {
        const data = await res.json()
        setNotification({ title: "Task Failed", message: data.error || "Failed to complete the task.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred completing the task.", isError: true })
    } finally {
      setBusyRoomId(null)
    }
  }

  const myRooms = useMemo(
    () => (attendantId ? rooms.filter((r) => r.assignedAttendantId === attendantId) : []),
    [rooms, attendantId]
  )
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>(BUCKETS.map((b) => [b.key, []]))
    myRooms.forEach((room) => map.get(bucketForRoom(room))!.push(room))
    map.forEach((list) => list.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)))
    return map
  }, [myRooms])

  const attendantName = (id: string) => {
    const hk = housekeepers.find((h) => h.id === id)
    return hk ? `${hk.firstName} ${hk.lastName}` : ""
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <Link href={`/e/${slug}/dashboard/housekeeping`}>
          <Button variant="outline" size="icon" className="shrink-0" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-muted-foreground" /> Task Sheet
            <InfoHint>Assigned rooms in cleaning order.</InfoHint>
          </h2>
        </div>
        <Button variant="outline" size="icon" onClick={() => fetchRooms()} title="Refresh" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground shrink-0" />
        <select
          className="flex-1 h-10 rounded-md border border-border bg-card px-3 text-sm"
          value={attendantId}
          onChange={(e) => setAttendantId(e.target.value)}
        >
          <option value="">Select attendant...</option>
          {housekeepers.map((hk) => (
            <option key={hk.id} value={hk.id}>
              {hk.firstName} {hk.lastName}{hk.id === myUserId ? " (me)" : ""}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : !attendantId ? (
        <EmptyState
          icon={Users}
          title="Pick an attendant"
          description="Choose whose task sheet to view. Rooms are assigned from the Housekeeping board."
          className="rounded-xl border border-dashed bg-muted"
        />
      ) : myRooms.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={`No rooms assigned to ${attendantName(attendantId) || "this attendant"}`}
          description='Use "Assign" or "Assign Floor" on the Housekeeping board to hand out rooms.'
          className="rounded-xl border border-dashed bg-muted"
        />
      ) : (
        BUCKETS.map((bucket) => {
          const list = grouped.get(bucket.key) ?? []
          if (list.length === 0) return null
          return (
            <div key={bucket.key} className="space-y-2">
              <div className="flex items-baseline justify-between border-b border-border pb-1">
                <h3 className="font-bold text-foreground">{bucket.label} ({list.length})</h3>
                {bucket.hint && <span className="text-xs text-muted-foreground">{bucket.hint}</span>}
              </div>
              {list.map((room) => {
                const openTasks = (room.housekeepingTasks ?? []).filter((t: any) => t.status !== "COMPLETED")
                const busy = busyRoomId === room.id
                return (
                  <div key={room.id} className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xl font-bold text-foreground flex items-center gap-2">
                          {room.roomNumber}
                          {(room.maintenance?.length ?? 0) > 0 && (
                            <Wrench className="w-4 h-4 text-warning" aria-label="Open maintenance ticket" />
                          )}
                        </span>
                        <p className="text-xs text-muted-foreground">{room.roomType?.name}</p>
                      </div>
                      <StatusBadge label={room.status.replace(/_/g, " ")} status={room.status} />
                    </div>

                    {openTasks.map((task: any) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-2 text-sm bg-warning-muted text-warning rounded-md px-2.5 py-1.5 border border-warning/20"
                      >
                        <span className="flex items-center gap-1.5 leading-snug">
                          {task.taskType === "SPECIAL_REQUEST" && <Bell className="w-3.5 h-3.5 shrink-0" />}
                          {task.taskType === "SPECIAL_REQUEST" ? task.notes : task.taskType.replace(/_/g, " ")}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 shrink-0"
                          disabled={busy}
                          onClick={() => completeTask(room.id, task.id)}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}

                    {(room.status === "DIRTY" || room.status === "CLEAN") && (
                      <div className="flex gap-2">
                        {room.status === "DIRTY" && (
                          <Button
                            size="sm"
                            className="flex-1"
                            disabled={busy}
                            onClick={() => setRoomStatus(room.id, "CLEAN")}
                          >
                            <Brush className="w-4 h-4 mr-2" /> Mark Clean
                          </Button>
                        )}
                        {room.status === "CLEAN" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            disabled={busy}
                            onClick={() => setRoomStatus(room.id, "INSPECTED")}
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Inspected
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })
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
    </div>
  )
}
