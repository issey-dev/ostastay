"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { RoomStatusCard } from "@/components/housekeeping/room-status-card"
import { RefreshCw, Layers, CheckCircle2, Brush, X, AlertTriangle, Wrench, Users, ClipboardList } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { InfoHint } from "@/components/ui/info-hint"
import { toneMutedClasses } from "@/lib/status-tone"
import { MAINTENANCE_ISSUE_TYPES } from "@/lib/maintenance"

export default function HousekeepingDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const [rooms, setRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const [isUpdatingBulk, setIsUpdatingBulk] = useState(false)
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  // Board filters — client-side over the already-fetched board
  const [filterStatus, setFilterStatus] = useState<string>("")
  const [filterAttendantId, setFilterAttendantId] = useState<string>("")
  
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false)
  const [maintenanceDesc, setMaintenanceDesc] = useState("")
  const [maintenanceType, setMaintenanceType] = useState("HVAC")
  const [maintenancePriority, setMaintenancePriority] = useState("MEDIUM")
  const [maintenanceTakeOOO, setMaintenanceTakeOOO] = useState(false)
  const [maintenanceReturnDate, setMaintenanceReturnDate] = useState("")

  // Mark Out-of-Order dialog (bulk action)
  const [showOOODialog, setShowOOODialog] = useState(false)
  const [oooReason, setOooReason] = useState("")
  const [oooReturnDate, setOooReturnDate] = useState("")
  const [editingTicket, setEditingTicket] = useState<any>(null)

  const [housekeepers, setHousekeepers] = useState<any[]>([])
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [selectedAttendantId, setSelectedAttendantId] = useState<string>("UNASSIGNED")

  const fetchRooms = async (silent = false) => {
    if (!currentProperty) return
    if (!silent) setLoading(true)
    try {
      const res = await fetch(`/api/housekeeping?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = await res.json()
        setRooms(data)
      } else if (!silent) {
        setNotification({ title: "Error", message: "Failed to load the housekeeping board.", isError: true })
      }
    } catch (e) {
      console.error(e)
      if (!silent) setNotification({ title: "Error", message: "Failed to load the housekeeping board.", isError: true })
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const handleCompleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/housekeeping/tasks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status: "COMPLETED" })
      })
      if (res.ok) {
        fetchRooms(true) // Refresh — the room may also have flipped to CLEAN server-side
      } else {
        const data = await res.json()
        setNotification({ title: "Task Update Failed", message: data.error || "Failed to complete the task.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred completing the task.", isError: true })
    }
  }

  const fetchHousekeepers = async () => {
    if (!currentProperty) return
    try {
      const res = await fetch(`/api/settings/users?enterpriseId=${currentProperty.enterpriseId}`)
      if (res.ok) {
        const data = await res.json()
        setHousekeepers(data.filter((u: any) => u.role?.name === "Housekeeping" && u.isActive))
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchRooms()
    fetchHousekeepers()
  }, [currentProperty])

  // Multiple people work this board at once — silently refresh whenever the tab
  // regains focus so a stale board doesn't sit open all shift.
  useEffect(() => {
    const onFocus = () => fetchRooms(true)
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [currentProperty])

  const handleStatusChange = async (roomId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, status: newStatus })
      })
      if (res.ok) {
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
        // Marking clean/inspected may have auto-completed tasks server-side.
        if (newStatus === "CLEAN" || newStatus === "INSPECTED") fetchRooms(true)
      } else {
        const data = await res.json()
        setNotification({ title: "Update Failed", message: data.error || "Failed to update the room status.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred updating the room.", isError: true })
    }
  }

  const handleToggleSelect = (roomId: string) => {
    setSelectedRooms(prev => 
      prev.includes(roomId) 
        ? prev.filter(id => id !== roomId)
        : [...prev, roomId]
    )
  }

  const handleBulkUpdate = async (newStatus: string) => {
    if (selectedRooms.length === 0) return
    setIsUpdatingBulk(true)
    try {
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomIds: selectedRooms, status: newStatus })
      })
      if (res.ok) {
        setRooms(prev => prev.map(r => selectedRooms.includes(r.id) ? { ...r, status: newStatus } : r))
        setSelectedRooms([]) // Clear selection after successful update
        if (newStatus === "CLEAN" || newStatus === "INSPECTED") fetchRooms(true)
      } else {
        const data = await res.json()
        setNotification({ title: "Bulk Update Failed", message: data.error || "Failed to update the selected rooms.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred during the bulk update.", isError: true })
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const handleAssignSubmit = async () => {
    if (selectedRooms.length === 0) return
    setIsUpdatingBulk(true)
    try {
      const assignedAttendantId = selectedAttendantId === "UNASSIGNED" ? null : selectedAttendantId
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomIds: selectedRooms, assignedAttendantId })
      })
      if (res.ok) {
        setShowAssignDialog(false)
        setSelectedRooms([])
        fetchRooms() // Re-fetch to get attendant data
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const handleMaintenanceSubmit = async () => {
    // If we are editing a specific ticket
    if (editingTicket) {
      if (!maintenanceDesc) return
      setIsUpdatingBulk(true)
      try {
        const res = await fetch(`/api/maintenance/${editingTicket.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueType: maintenanceType,
            description: maintenanceDesc,
            priority: maintenancePriority
          })
        })
        if (res.ok) {
          closeMaintenanceDialog()
          fetchRooms() // Re-fetch to get updated Wrench info
        } else {
          const data = await res.json()
          setNotification({ title: "Update Failed", message: data.error || "Failed to update the ticket.", isError: true })
        }
      } catch {
        setNotification({ title: "Error", message: "An error occurred updating the ticket.", isError: true })
      } finally {
        setIsUpdatingBulk(false)
      }
      return
    }

    // Otherwise, creating a new bulk ticket
    if (selectedRooms.length === 0 || !maintenanceDesc) return
    setIsUpdatingBulk(true)
    try {
      const res = await fetch(`/api/housekeeping/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomIds: selectedRooms,
          issueType: maintenanceType,
          description: maintenanceDesc,
          priority: maintenancePriority,
          takeOutOfOrder: maintenanceTakeOOO,
          expectedReturn: maintenanceTakeOOO && maintenanceReturnDate ? maintenanceReturnDate : null
        })
      })
      if (res.ok) {
        closeMaintenanceDialog()
        fetchRooms() // Re-fetch to get new Wrench icons
      } else {
        const data = await res.json()
        setNotification({ title: "Report Failed", message: data.error || "Failed to create the ticket.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred creating the ticket.", isError: true })
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const handleDeleteTicket = async () => {
    if (!editingTicket) return
    setIsUpdatingBulk(true)
    try {
      const res = await fetch(`/api/maintenance/${editingTicket.id}`, {
        method: "DELETE"
      })
      if (res.ok) {
        closeMaintenanceDialog()
        fetchRooms()
      } else {
        const data = await res.json()
        setNotification({ title: "Delete Failed", message: data.error || "Failed to delete the ticket.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred deleting the ticket.", isError: true })
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const closeMaintenanceDialog = () => {
    setShowMaintenanceDialog(false)
    setEditingTicket(null)
    setMaintenanceDesc("")
    setMaintenanceTakeOOO(false)
    setMaintenanceReturnDate("")
    setSelectedRooms([])
  }

  const handleMarkOOO = async () => {
    if (selectedRooms.length === 0) return
    setIsUpdatingBulk(true)
    try {
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomIds: selectedRooms,
          status: "OUT_OF_ORDER",
          oooReason: oooReason || null,
          oooExpectedReturn: oooReturnDate || null,
        })
      })
      if (res.ok) {
        setShowOOODialog(false)
        setOooReason("")
        setOooReturnDate("")
        setSelectedRooms([])
        fetchRooms(true)
      } else {
        const data = await res.json()
        setNotification({ title: "Update Failed", message: data.error || "Failed to mark rooms out of order.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred marking rooms out of order.", isError: true })
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const handleEditMaintenance = (ticket: any) => {
    setEditingTicket(ticket)
    setMaintenanceType(ticket.issueType)
    setMaintenanceDesc(ticket.description)
    setMaintenancePriority(ticket.priority || "MEDIUM")
    setShowMaintenanceDialog(true)
  }

  // Apply board filters, then group by Floor
  const filteredRooms = rooms.filter((room: any) => {
    if (filterStatus && room.status !== filterStatus) return false
    if (filterAttendantId && room.assignedAttendantId !== filterAttendantId) return false
    return true
  })
  const roomsByFloor = filteredRooms.reduce((acc: any, room: any) => {
    const floorName = room.floor.name
    if (!acc[floorName]) acc[floorName] = []
    acc[floorName].push(room)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="pb-32">
        <div className="flex justify-between items-center mb-8">
          <div>
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const isBulkMode = selectedRooms.length > 0;

  return (
    <div className="pb-32 relative">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            Housekeeping Dashboard
            <InfoHint label="Housekeeping Dashboard">Manage room statuses, turnovers, and attendant tasks.</InfoHint>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {isBulkMode && (
            <Button variant="outline" onClick={() => setSelectedRooms(rooms.map(r => r.id))}>
              Select All
            </Button>
          )}
          <Link href={`/e/${slug}/dashboard/housekeeping/task-sheet`}>
            <Button variant="outline" className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />
              Task Sheets
            </Button>
          </Link>
          <Button onClick={() => fetchRooms()} variant="outline" className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {[
          { label: "All", value: "" },
          { label: "Dirty", value: "DIRTY" },
          { label: "Clean", value: "CLEAN" },
          { label: "Inspected", value: "INSPECTED" },
          { label: "Out of Order", value: "OUT_OF_ORDER" },
          { label: "Out of Service", value: "OUT_OF_SERVICE" },
        ].map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={filterStatus === opt.value ? "default" : "outline"}
            onClick={() => setFilterStatus(opt.value)}
          >
            {opt.label}
            {opt.value !== "" && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {rooms.filter((r: any) => r.status === opt.value).length}
              </span>
            )}
          </Button>
        ))}
        {housekeepers.length > 0 && (
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm ml-auto"
            value={filterAttendantId}
            onChange={(e) => setFilterAttendantId(e.target.value)}
          >
            <option value="">All attendants</option>
            {housekeepers.map((hk: any) => (
              <option key={hk.id} value={hk.id}>{hk.firstName} {hk.lastName}</option>
            ))}
          </select>
        )}
      </div>

      {Object.keys(roomsByFloor).length === 0 && (
        <EmptyState
          icon={Layers}
          title="No rooms found"
          description="Add rooms and floors in Settings to see them here."
          className="rounded-xl border border-dashed bg-muted"
        />
      )}

      {Object.keys(roomsByFloor).map((floorName) => (
        <div key={floorName} className="mb-10">
          <div className="flex justify-between items-center border-b pb-2 mb-4">
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Layers className="w-5 h-5 text-muted-foreground" />
              {floorName}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const floorRoomIds = roomsByFloor[floorName].map((r: any) => r.id)
                setSelectedRooms(floorRoomIds)
                setShowAssignDialog(true)
              }}
            >
              <Users className="w-4 h-4 mr-2" />
              Assign Floor
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {roomsByFloor[floorName].map((room: any) => (
              <RoomStatusCard
                key={room.id}
                room={room}
                onStatusChange={handleStatusChange}
                isSelected={selectedRooms.includes(room.id)}
                onToggleSelect={handleToggleSelect}
                onCompleteTask={handleCompleteTask}
                onEditMaintenance={handleEditMaintenance}
                businessDate={currentProperty?.businessDate}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Floating Action Bar */}
      {isBulkMode && (
        <div className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-8 max-w-full overflow-x-auto bg-card/90 backdrop-blur-xl border border-border shadow-elevation-4 rounded-2xl p-3 md:p-4 flex items-center gap-3 md:gap-6 z-[var(--z-modal)] animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="flex items-center gap-3 border-r pr-3 md:pr-6 border-border shrink-0">
            <div className="bg-primary text-primary-foreground w-8 h-8 rounded-none flex items-center justify-center font-bold text-sm">
              {selectedRooms.length}
            </div>
            <span className="font-semibold text-foreground">Selected</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("CLEAN")}
              className={`shadow-sm border shrink-0 ${toneMutedClasses("success")}`}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark Clean
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("INSPECTED")}
              className={`shadow-sm border shrink-0 ${toneMutedClasses("info")}`}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark Inspected
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("DIRTY")}
              className={`shadow-sm border shrink-0 ${toneMutedClasses("danger")}`}
            >
              <Brush className="w-4 h-4 mr-2" />
              Mark Dirty
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => setShowOOODialog(true)}
              variant="outline"
              className="shadow-sm shrink-0"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Mark OOO
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => setShowAssignDialog(true)}
              variant="outline"
              className="shadow-sm shrink-0"
            >
              <Users className="w-4 h-4 mr-2" />
              Assign
            </Button>
            <div className="w-px h-6 bg-border mx-2 shrink-0" />
            <Button
              disabled={isUpdatingBulk}
              onClick={() => setShowMaintenanceDialog(true)}
              className={`shadow-sm border font-semibold shrink-0 ${toneMutedClasses("warning")}`}
            >
              <Wrench className="w-4 h-4 mr-2" />
              Report Issue
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedRooms([])}
            className="ml-2 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded-none"
            aria-label="Clear selection"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      )}

      {/* Maintenance Dialog */}
      <Dialog open={showMaintenanceDialog} onOpenChange={closeMaintenanceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTicket ? "Edit Maintenance Issue" : "Report Maintenance Issue"}</DialogTitle>
            <DialogDescription>
              {editingTicket 
                ? "Update or delete this reported issue." 
                : `This will create a maintenance ticket for ${selectedRooms.length} selected room(s).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Issue Type</label>
              <select
                className="w-full border-border rounded-md shadow-sm h-10 px-3 border bg-background focus:ring-ring focus:border-ring"
                value={maintenanceType}
                onChange={e => setMaintenanceType(e.target.value)}
              >
                {MAINTENANCE_ISSUE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Priority</label>
              <select
                className="w-full border-border rounded-md shadow-sm h-10 px-3 border bg-background focus:ring-ring focus:border-ring"
                value={maintenancePriority}
                onChange={e => setMaintenancePriority(e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea
                className="w-full border-border rounded-md shadow-sm p-3 border bg-background focus:ring-ring focus:border-ring"
                rows={3}
                placeholder="E.g. AC unit is leaking water..."
                value={maintenanceDesc}
                onChange={e => setMaintenanceDesc(e.target.value)}
              />
            </div>
            {!editingTicket && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={maintenanceTakeOOO}
                    onChange={e => setMaintenanceTakeOOO(e.target.checked)}
                  />
                  Take room(s) out of order
                </label>
                <p className="text-xs text-muted-foreground">
                  Removes the room(s) from sale until this ticket is resolved (they return as Dirty).
                </p>
                {maintenanceTakeOOO && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">Expected return date (optional)</label>
                    <DatePicker
                      value={maintenanceReturnDate}
                      onChange={setMaintenanceReturnDate}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex sm:justify-between w-full gap-2 sm:gap-0">
            {editingTicket ? (
              <Button 
                variant="destructive" 
                onClick={handleDeleteTicket} 
                disabled={isUpdatingBulk}
              >
                Delete Ticket
              </Button>
            ) : <div></div>}
            
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeMaintenanceDialog}>Cancel</Button>
              <Button onClick={handleMaintenanceSubmit} disabled={isUpdatingBulk || !maintenanceDesc.trim()}>
                {isUpdatingBulk ? "Saving..." : (editingTicket ? "Update Ticket" : "Submit Ticket")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Attendant Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => {
        setShowAssignDialog(open)
        if (!open) {
          setSelectedRooms([])
          setSelectedAttendantId("UNASSIGNED")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Housekeeping Attendant</DialogTitle>
            <DialogDescription>
              Assign an attendant to {selectedRooms.length} selected room(s). They will see these rooms assigned to them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select Attendant</label>
              <select
                className="w-full border-border rounded-md shadow-sm h-10 px-3 border bg-background focus:ring-ring focus:border-ring"
                value={selectedAttendantId}
                onChange={e => setSelectedAttendantId(e.target.value)}
              >
                <option value="UNASSIGNED">Unassigned (Clear Assignment)</option>
                {housekeepers.map(h => (
                  <option key={h.id} value={h.id}>{h.firstName} {h.lastName}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={handleAssignSubmit} disabled={isUpdatingBulk}>
              {isUpdatingBulk ? "Saving..." : "Save Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Out-of-Order Dialog */}
      <Dialog open={showOOODialog} onOpenChange={(open) => !open && setShowOOODialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Out of Order</DialogTitle>
            <DialogDescription>
              Removes {selectedRooms.length} selected room(s) from sale — they won&apos;t be offered for new bookings or
              check-ins until returned to service.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Reason</label>
              <Input
                placeholder="E.g. Water damage — awaiting repairs"
                value={oooReason}
                onChange={e => setOooReason(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Expected return date (optional)</label>
              <DatePicker
                value={oooReturnDate}
                onChange={setOooReturnDate}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOOODialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleMarkOOO} disabled={isUpdatingBulk}>
              {isUpdatingBulk ? "Saving..." : "Mark Out of Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification Dialog */}
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
