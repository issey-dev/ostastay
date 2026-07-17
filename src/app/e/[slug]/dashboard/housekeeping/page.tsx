"use client"

import { useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { RoomStatusCard } from "@/components/housekeeping/room-status-card"
import { ClipboardList, RefreshCw, Layers, CheckCircle2, Brush, X, AlertTriangle, Wrench, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toneMutedClasses } from "@/lib/status-tone"

export default function HousekeepingDashboard() {
  const { currentProperty } = useProperty()
  const [rooms, setRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRooms, setSelectedRooms] = useState<string[]>([])
  const [isUpdatingBulk, setIsUpdatingBulk] = useState(false)
  
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false)
  const [maintenanceDesc, setMaintenanceDesc] = useState("")
  const [maintenanceType, setMaintenanceType] = useState("HVAC")
  const [editingTicket, setEditingTicket] = useState<any>(null)

  const [housekeepers, setHousekeepers] = useState<any[]>([])
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [selectedAttendantId, setSelectedAttendantId] = useState<string>("UNASSIGNED")

  const fetchRooms = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/housekeeping?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = await res.json()
        setRooms(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
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
        fetchRooms() // Refresh the rooms to remove the task from the view
      }
    } catch (e) {
      console.error(e)
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

  const handleStatusChange = async (roomId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, status: newStatus })
      })
      if (res.ok) {
        // Optimistically update local state
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
      }
    } catch (e) {
      console.error(e)
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
        // Optimistically update local state
        setRooms(prev => prev.map(r => selectedRooms.includes(r.id) ? { ...r, status: newStatus } : r))
        setSelectedRooms([]) // Clear selection after successful update
      }
    } catch (e) {
      console.error(e)
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
        const res = await fetch(`/api/maintenance`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            ticketId: editingTicket.id, 
            issueType: maintenanceType, 
            description: maintenanceDesc 
          })
        })
        if (res.ok) {
          closeMaintenanceDialog()
          fetchRooms() // Re-fetch to get updated Wrench info
        }
      } catch (e) {
        console.error(e)
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
          description: maintenanceDesc 
        })
      })
      if (res.ok) {
        closeMaintenanceDialog()
        fetchRooms() // Re-fetch to get new Wrench icons
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const handleDeleteTicket = async () => {
    if (!editingTicket) return
    setIsUpdatingBulk(true)
    try {
      const res = await fetch(`/api/maintenance?ticketId=${editingTicket.id}`, {
        method: "DELETE"
      })
      if (res.ok) {
        closeMaintenanceDialog()
        fetchRooms()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsUpdatingBulk(false)
    }
  }

  const closeMaintenanceDialog = () => {
    setShowMaintenanceDialog(false)
    setEditingTicket(null)
    setMaintenanceDesc("")
    setSelectedRooms([])
  }

  const handleEditMaintenance = (ticket: any) => {
    setEditingTicket(ticket)
    setMaintenanceType(ticket.issueType)
    setMaintenanceDesc(ticket.description)
    setShowMaintenanceDialog(true)
  }

  // Group rooms by Floor
  const roomsByFloor = rooms.reduce((acc: any, room: any) => {
    const floorName = room.floor.name
    if (!acc[floorName]) acc[floorName] = []
    acc[floorName].push(room)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto pb-32">
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
    <div className="p-8 max-w-7xl mx-auto pb-32 relative">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <ClipboardList className="w-6 h-6 text-foreground" />
            </div>
            Housekeeping Dashboard
          </h1>
          <p className="text-muted-foreground mt-2">Manage room statuses, turnovers, and attendant tasks.</p>
        </div>
        <div className="flex items-center gap-3">
          {isBulkMode && (
            <Button variant="outline" onClick={() => setSelectedRooms(rooms.map(r => r.id))}>
              Select All
            </Button>
          )}
          <Button onClick={fetchRooms} variant="outline" className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {Object.keys(roomsByFloor).length === 0 && (
        <div className="text-center py-20 bg-muted rounded-xl border border-dashed">
          <Layers className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">No rooms found</h3>
          <p className="text-muted-foreground">Add rooms and floors in Settings to see them here.</p>
        </div>
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
              />
            ))}
          </div>
        </div>
      ))}

      {/* Floating Action Bar */}
      {isBulkMode && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-xl border border-border shadow-elevation-4 rounded-2xl p-4 flex items-center gap-6 z-[var(--z-modal)] animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="flex items-center gap-3 border-r pr-6 border-border">
            <div className="bg-primary text-primary-foreground w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
              {selectedRooms.length}
            </div>
            <span className="font-semibold text-foreground">Selected</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("CLEAN")}
              className={`shadow-sm border ${toneMutedClasses("success")}`}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark Clean
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("INSPECTED")}
              className={`shadow-sm border ${toneMutedClasses("info")}`}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Mark Inspected
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => handleBulkUpdate("DIRTY")}
              className={`shadow-sm border ${toneMutedClasses("danger")}`}
            >
              <Brush className="w-4 h-4 mr-2" />
              Mark Dirty
            </Button>
            <Button
              disabled={isUpdatingBulk}
              onClick={() => setShowAssignDialog(true)}
              variant="outline"
              className="shadow-sm"
            >
              <Users className="w-4 h-4 mr-2" />
              Assign
            </Button>
            <div className="w-px h-6 bg-border mx-2" />
            <Button
              disabled={isUpdatingBulk}
              onClick={() => setShowMaintenanceDialog(true)}
              className={`shadow-sm border font-semibold ${toneMutedClasses("warning")}`}
            >
              <Wrench className="w-4 h-4 mr-2" />
              Report Issue
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedRooms([])}
            className="ml-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
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
                <option value="HVAC">HVAC (A/C, Heating)</option>
                <option value="PLUMBING">Plumbing (Leaks, Toilets)</option>
                <option value="ELECTRICAL">Electrical (Lights, Power)</option>
                <option value="GENERAL">General (Furniture, Paint)</option>
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
    </div>
  )
}
