"use client"

import { useState, useEffect, useRef } from "react"
import { Plus, Building2, Map, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ControlsSectionHeader, ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { DoorOpen } from "lucide-react"
import { RoomFeaturePicker, ROOM_FEATURE_CATEGORY_LABELS, groupFeaturesByCategory, useRoomFeatureOptions, type RoomFeature } from "@/components/inventory/room-feature-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"

// addSignal/hideAddButton: when embedded in FacilitiesManager the Add button lives in
// the shared tab row. This manager hides its own per-view Add button and opens the
// dialog for the currently-shown `view` when the parent bumps addSignal.
export function RoomManager({
  propertyId,
  view,
  addSignal,
  hideAddButton = false,
}: {
  propertyId: string
  view: "buildings" | "floors" | "rooms"
  addSignal?: number
  hideAddButton?: boolean
}) {
  const [buildings, setBuildings] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  const [isBuildingDialogOpen, setIsBuildingDialogOpen] = useState(false)
  const [isFloorDialogOpen, setIsFloorDialogOpen] = useState(false)
  const [isRoomDialogOpen, setIsRoomDialogOpen] = useState(false)

  // Building Edit/Delete State
  const [isBuildingEditMode, setIsBuildingEditMode] = useState(false)
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null)
  const [isBuildingDeleteDialogOpen, setIsBuildingDeleteDialogOpen] = useState(false)
  const [deletingBuildingId, setDeletingBuildingId] = useState<string | null>(null)

  // Floor Edit/Delete State
  const [isFloorEditMode, setIsFloorEditMode] = useState(false)
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null)
  const [isFloorDeleteDialogOpen, setIsFloorDeleteDialogOpen] = useState(false)
  const [deletingFloorId, setDeletingFloorId] = useState<string | null>(null)


  // Form states
  const [buildingName, setBuildingName] = useState("")
  const [floorData, setFloorData] = useState({ name: "", buildingId: "" })
  const [roomData, setRoomData] = useState({ roomNumber: "", buildingId: "", floorId: "", roomTypeId: "", features: [] as RoomFeature[] })

  const [isRoomEditMode, setIsRoomEditMode] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)

  const [isRoomDeleteDialogOpen, setIsRoomDeleteDialogOpen] = useState(false)
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [buildingsRes, roomTypesRes, roomsRes] = await Promise.all([
        fetch(`/api/buildings?propertyId=${propertyId}`),
        fetch(`/api/room-types?propertyId=${propertyId}`),
        fetch(`/api/rooms?propertyId=${propertyId}`)
      ])
      
      const bData = await buildingsRes.json()
      const rtData = await roomTypesRes.json()
      const rData = await roomsRes.json()
      
      if (Array.isArray(bData)) setBuildings(bData)
      if (Array.isArray(rtData)) setRoomTypes(rtData)
      if (Array.isArray(rData)) setRooms(rData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateBuilding = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const url = isBuildingEditMode ? `/api/buildings/${editingBuildingId}` : "/api/buildings"
    const method = isBuildingEditMode ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, name: buildingName })
    })
    if (res.ok) {
      resetBuildingForm()
      setIsBuildingDialogOpen(false)
      fetchData()
    }
  }

  const handleDeleteBuilding = async () => {
    if (!deletingBuildingId) return
    const res = await fetch(`/api/buildings/${deletingBuildingId}`, { method: "DELETE" })
    if (res.ok) {
      setIsBuildingDeleteDialogOpen(false)
      setDeletingBuildingId(null)
      fetchData()
    }
  }

  const resetBuildingForm = () => {
    setBuildingName("")
    setIsBuildingEditMode(false)
    setEditingBuildingId(null)
  }

  const openBuildingEdit = (building: any) => {
    setBuildingName(building.name)
    setIsBuildingEditMode(true)
    setEditingBuildingId(building.id)
    setIsBuildingDialogOpen(true)
  }

  const openBuildingDelete = (id: string) => {
    setDeletingBuildingId(id)
    setIsBuildingDeleteDialogOpen(true)
  }

  const handleCreateFloor = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const url = isFloorEditMode ? `/api/floors/${editingFloorId}` : "/api/floors"
    const method = isFloorEditMode ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...floorData, propertyId })
    })
    if (res.ok) {
      resetFloorForm()
      setIsFloorDialogOpen(false)
      fetchData()
    }
  }

  const handleDeleteFloor = async () => {
    if (!deletingFloorId) return
    const res = await fetch(`/api/floors/${deletingFloorId}`, { method: "DELETE" })
    if (res.ok) {
      setIsFloorDeleteDialogOpen(false)
      setDeletingFloorId(null)
      fetchData()
    }
  }

  const resetFloorForm = () => {
    setFloorData({ name: "", buildingId: "" })
    setIsFloorEditMode(false)
    setEditingFloorId(null)
  }

  const openFloorEdit = (floor: any) => {
    setFloorData({ name: floor.name, buildingId: floor.buildingId })
    setIsFloorEditMode(true)
    setEditingFloorId(floor.id)
    setIsFloorDialogOpen(true)
  }

  const openFloorDelete = (id: string) => {
    setDeletingFloorId(id)
    setIsFloorDeleteDialogOpen(true)
  }

  const selectedRoomRoomType = roomTypes.find(rt => rt.id === roomData.roomTypeId)
  const isPseudoRoom = !!selectedRoomRoomType?.isPseudo
  const inheritedFeatures: RoomFeature[] = selectedRoomRoomType?.features || []

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()

    const url = isRoomEditMode ? `/api/rooms/${editingRoomId}` : "/api/rooms"
    const method = isRoomEditMode ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        roomNumber: roomData.roomNumber,
        roomTypeId: roomData.roomTypeId,
        floorId: isPseudoRoom ? null : roomData.floorId,
        features: isPseudoRoom ? [] : roomData.features,
      })
    })
    if (res.ok) {
      resetRoomForm()
      setIsRoomDialogOpen(false)
      fetchData()
    }
  }

  const handleDeleteRoom = async () => {
    if (!deletingRoomId) return
    const res = await fetch(`/api/rooms/${deletingRoomId}`, { method: "DELETE" })
    if (res.ok) {
      setIsRoomDeleteDialogOpen(false)
      setDeletingRoomId(null)
      fetchData()
    }
  }

  const resetRoomForm = () => {
    setRoomData({ roomNumber: "", buildingId: "", floorId: "", roomTypeId: "", features: [] })
    setIsRoomEditMode(false)
    setEditingRoomId(null)
  }

  const openRoomEdit = (room: any) => {
    const floor = allFloors.find(f => f.id === room.floorId)
    setRoomData({
      roomNumber: room.roomNumber,
      buildingId: floor?.buildingId || "",
      floorId: room.floorId || "",
      roomTypeId: room.roomTypeId || "",
      features: (room.features || []).map((f: any) => ({ category: f.category, code: f.code })),
    })
    setIsRoomEditMode(true)
    setEditingRoomId(room.id)
    setIsRoomDialogOpen(true)
  }

  const openRoomDelete = (id: string) => {
    setDeletingRoomId(id)
    setIsRoomDeleteDialogOpen(true)
  }

  // Get all floors across all buildings for the room edit form (looking up a room's
  // existing floor by id, regardless of which building it belongs to)
  const allFloors = buildings.flatMap(b => b.floors || [])
  // The Floor select is dependent on which Building is selected — only that building's own floors
  const floorsForSelectedBuilding: any[] = buildings.find(b => b.id === roomData.buildingId)?.floors || []
  const { options: featureOptions } = useRoomFeatureOptions()
  const featureLabel = (f: RoomFeature) => featureOptions.find(o => o.category === f.category && o.code === f.code)?.value || f.code

  // Open this view's Add dialog when FacilitiesManager's shared Add button fires. Compare
  // the signal's VALUE against the last-seen one rather than a "first run" flag — a flag
  // is consumed by React StrictMode's double-invoke of mount effects and then opens the
  // dialog on the second invoke (the bug this replaces). Value comparison is idempotent,
  // so mount and tab-switch never open anything; only an actual Add click does.
  const lastAddSignal = useRef(addSignal)
  useEffect(() => {
    if (addSignal === lastAddSignal.current) return
    lastAddSignal.current = addSignal
    if (view === "buildings") { resetBuildingForm(); setIsBuildingDialogOpen(true) }
    else if (view === "floors") { resetFloorForm(); setIsFloorDialogOpen(true) }
    else { resetRoomForm(); setIsRoomDialogOpen(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal])

  // First-column sorting per view (asc<->desc): buildings/floors by name, rooms by number.
  const { sorted: sortedBuildings, sort: buildingSort } = useTableSort(buildings, { name: (b) => b.name }, "name")
  const { sorted: sortedFloors, sort: floorSort } = useTableSort(allFloors, { name: (f) => f.name }, "name")
  const { sorted: sortedRooms, sort: roomSort } = useTableSort(rooms, { roomNumber: (r) => r.roomNumber }, "roomNumber")

  return (
    <div className="mt-6">
    {view === "buildings" && (
      <>
      {/* Buildings Table */}
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => setIsBuildingDialogOpen(true)} className="shadow-sm">
              <Building2 className="mr-2 h-4 w-4" /> Add Building
            </Button>
          }
        />
      )}
      <Dialog open={isBuildingDialogOpen} onOpenChange={(open) => {
          setIsBuildingDialogOpen(open)
          if (!open) resetBuildingForm()
        }}>
            <DialogContent>
              <form onSubmit={handleCreateBuilding}>
                <DialogHeader><DialogTitle>{isBuildingEditMode ? "Edit Building" : "Add Building"}</DialogTitle></DialogHeader>
                <div className="py-4">
                  <Label>Building Name</Label>
                  <Input value={buildingName} onChange={e => setBuildingName(e.target.value)} placeholder="e.g. Main Tower" required />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsBuildingDialogOpen(false)}>Cancel</Button>
                  <Button type="submit">Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

      {/* Delete Building Dialog */}
      <Dialog open={isBuildingDeleteDialogOpen} onOpenChange={setIsBuildingDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Building</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this building? This will permanently delete all floors and rooms inside this building.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsBuildingDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteBuilding}>Delete Permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ControlsSectionBody>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="name" sort={buildingSort} className="px-6 py-4">Building Name</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={2}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : buildings.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="py-0">
                  <EmptyState icon={Building2} title="No buildings configured" />
                </TableCell></TableRow>
              ) : (
                sortedBuildings.map((building) => (
                  <TableRow key={building.id} className="group hover:bg-muted/40">
                    <TableCell className="px-6 py-3 font-semibold text-foreground">{building.name}</TableCell>
                    <TableCell className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button variant="ghost" size="sm" className="text-primary" onClick={() => openBuildingEdit(building)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => openBuildingDelete(building.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </ControlsSectionBody>
      </>
    )}

    {view === "floors" && (
      <>
      {/* Floors Table */}
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => setIsFloorDialogOpen(true)} className="shadow-sm">
              <Map className="mr-2 h-4 w-4" /> Add Floor
            </Button>
          }
        />
      )}
      <Dialog open={isFloorDialogOpen} onOpenChange={(open) => {
          setIsFloorDialogOpen(open)
          if (!open) resetFloorForm()
        }}>
            <DialogContent>
              <form onSubmit={handleCreateFloor}>
                <DialogHeader><DialogTitle>{isFloorEditMode ? "Edit Floor" : "Add Floor"}</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Select Building</Label>
                    <Select value={floorData.buildingId} onValueChange={(v) => setFloorData({...floorData, buildingId: v ?? ""})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Building">
                          {floorData.buildingId ? buildings.find(b => b.id === floorData.buildingId)?.name : "Select Building"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Floor Name/Number</Label>
                    <Input value={floorData.name} onChange={e => setFloorData({...floorData, name: e.target.value})} placeholder="e.g. 1st Floor" required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsFloorDialogOpen(false)}>Cancel</Button>
                  <Button type="submit">Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

      {/* Delete Floor Dialog */}
      <Dialog open={isFloorDeleteDialogOpen} onOpenChange={setIsFloorDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Floor</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this floor? This will permanently delete all rooms on this floor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsFloorDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteFloor}>Delete Permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ControlsSectionBody>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="name" sort={floorSort} className="px-6 py-4">Floor Name</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Building</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : allFloors.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-0">
                  <EmptyState icon={Map} title="No floors configured" />
                </TableCell></TableRow>
              ) : (
                sortedFloors.map((floor) => (
                  <TableRow key={floor.id} className="group hover:bg-muted/40">
                    <TableCell className="px-6 py-3 font-semibold text-foreground">{floor.name}</TableCell>
                    <TableCell className="px-6 py-3 text-muted-foreground">
                      {buildings.find(b => b.id === floor.buildingId)?.name || "Unknown Building"}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button variant="ghost" size="sm" className="text-primary" onClick={() => openFloorEdit(floor)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => openFloorDelete(floor.id)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </ControlsSectionBody>
      </>
    )}

    {view === "rooms" && (
      <>
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => setIsRoomDialogOpen(true)} className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> Add Room
            </Button>
          }
        />
      )}
      <Dialog open={isRoomDialogOpen} onOpenChange={(open) => {
          setIsRoomDialogOpen(open)
          if (!open) resetRoomForm()
        }}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
              <form onSubmit={handleCreateRoom}>
                <DialogHeader><DialogTitle>{isRoomEditMode ? "Edit Room" : "Create Room"}</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Room Number / Name</Label>
                    <Input value={roomData.roomNumber} onChange={e => setRoomData({...roomData, roomNumber: e.target.value})} placeholder="e.g. 101" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Room Type</Label>
                    <Select
                      value={roomData.roomTypeId}
                      onValueChange={(v) => setRoomData({...roomData, roomTypeId: v ?? "", buildingId: "", floorId: "", features: []})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Type">
                          {roomData.roomTypeId ? roomTypes.find(rt => rt.id === roomData.roomTypeId)?.name : "Select Type"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {roomTypes.map(rt => <SelectItem key={rt.id} value={rt.id}>{rt.name}{rt.isPseudo ? " (Pseudo)" : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {isPseudoRoom ? (
                    <p className="text-xs text-muted-foreground rounded-md border border-border p-3">
                      This is a Pseudo room type — it has no physical location, so Building, Floor, and Room Features aren't applicable.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Building</Label>
                          <Select
                            value={roomData.buildingId}
                            onValueChange={(v) => setRoomData({...roomData, buildingId: v ?? "", floorId: ""})}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select Building">
                                {roomData.buildingId ? buildings.find(b => b.id === roomData.buildingId)?.name : "Select Building"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Floor</Label>
                          <Select
                            value={roomData.floorId}
                            onValueChange={(v) => setRoomData({...roomData, floorId: v ?? ""})}
                            disabled={!roomData.buildingId}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={roomData.buildingId ? "Select Floor" : "Select a building first"}>
                                {roomData.floorId ? floorsForSelectedBuilding.find(f => f.id === roomData.floorId)?.name : undefined}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {floorsForSelectedBuilding.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="border-t border-border pt-4">
                        <h4 className="text-sm font-semibold text-foreground mb-2">Room Features</h4>
                        {inheritedFeatures.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-muted-foreground mb-1">Inherited from Room Type (fixed here):</p>
                            <div className="flex flex-wrap gap-1.5">
                              {inheritedFeatures.map((f) => (
                                <span key={`${f.category}:${f.code}`} className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">
                                  {ROOM_FEATURE_CATEGORY_LABELS[f.category]}: {featureLabel(f)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mb-2">Additional features specific to this room:</p>
                        <RoomFeaturePicker
                          selected={roomData.features}
                          onChange={(next) => setRoomData({ ...roomData, features: next })}
                          excluded={inheritedFeatures}
                        />
                      </div>
                    </>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsRoomDialogOpen(false)}>Cancel</Button>
                  <Button type="submit">Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

      {/* Delete Room Dialog */}
      <Dialog open={isRoomDeleteDialogOpen} onOpenChange={setIsRoomDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this room? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsRoomDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteRoom}>Delete Permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ControlsSectionBody>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="roomNumber" sort={roomSort} className="px-6 py-4">Room</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Floor</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Room Type</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Status</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : rooms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-0">
                    <EmptyState
                      icon={DoorOpen}
                      title="No rooms configured"
                      description="Add a building, a floor, and then create rooms."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sortedRooms.map((room) => (
                  <TableRow key={room.id} className="group hover:bg-muted/40">
                    <TableCell className="px-6 py-4 font-bold text-foreground">{room.roomNumber}</TableCell>
                    <TableCell className="px-6 py-4 text-muted-foreground">{room.floor?.name || "—"}</TableCell>
                    <TableCell className="px-6 py-4 text-muted-foreground">
                      {room.roomType?.name}
                      {room.roomType?.isPseudo && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">Pseudo</span>
                      )}
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <StatusBadge label={room.status.replace(/_/g, ' ')} status={room.status} />
                    </TableCell>
                    <TableCell className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary"
                          onClick={() => openRoomEdit(room)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-destructive"
                          onClick={() => openRoomDelete(room.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </ControlsSectionBody>
      </>
    )}
    </div>
  )
}
