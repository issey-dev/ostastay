"use client"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus, Building2, Map, Pencil, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { ControlsSectionHeader, ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { DoorOpen } from "@/components/icons"
import { RoomFeaturePicker, ROOM_FEATURE_CATEGORY_LABELS, useRoomFeatureOptions, type RoomFeature } from "@/components/inventory/room-feature-picker"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"
import { useConfirm } from "@/components/providers/confirm-provider"
import { SubmitButton } from "@/components/ui/submit-button"
import {
  buildingFormSchema,
  emptyRoomForm,
  floorFormSchema,
  readApiError,
  roomFormSchema,
  type BuildingFormValues,
  type FloorFormValues,
  type RoomFormValues,
} from "@/lib/inventory-form-schemas"
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

/** Inline server-error line shown above a dialog's buttons. */
function ServerError({ message }: { message: string | null }) {
  if (!message) return null
  return <p role="alert" className="rounded-md bg-destructive-muted p-3 text-sm text-destructive">{message}</p>
}

// addSignal/hideAddButton: when embedded in FacilitiesManager the Add button lives in
// the shared tab row. This manager hides its own per-view Add button and opens the
// dialog for the currently-shown `view` when the parent bumps addSignal.
//
// Forms: APP STANDARD 001 (Zod + React Hook Form, inline validation) — schemas in
// src/lib/inventory-form-schemas.ts. A server refusal on save (duplicate room number,
// licence cap, inactive room type, ...) is shown inside the dialog; a refused delete (the
// building/floor/room has reservation or maintenance history) as a toast.
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
  const confirm = useConfirm()
  const [buildings, setBuildings] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [isBuildingDialogOpen, setIsBuildingDialogOpen] = useState(false)
  const [isFloorDialogOpen, setIsFloorDialogOpen] = useState(false)
  const [isRoomDialogOpen, setIsRoomDialogOpen] = useState(false)

  // Building Edit/Delete State
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null)
  const isBuildingEditMode = editingBuildingId !== null
  const [buildingError, setBuildingError] = useState<string | null>(null)

  // Floor Edit/Delete State
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null)
  const isFloorEditMode = editingFloorId !== null
  const [floorError, setFloorError] = useState<string | null>(null)

  // Room Edit/Delete State
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const isRoomEditMode = editingRoomId !== null
  const [roomError, setRoomError] = useState<string | null>(null)

  const buildingForm = useForm<BuildingFormValues>({
    resolver: zodResolver(buildingFormSchema),
    mode: "onChange",
    defaultValues: { name: "" },
  })
  const floorForm = useForm<FloorFormValues>({
    resolver: zodResolver(floorFormSchema),
    mode: "onChange",
    defaultValues: { name: "", buildingId: "" },
  })
  const roomForm = useForm<RoomFormValues>({
    resolver: zodResolver(roomFormSchema),
    mode: "onChange",
    defaultValues: emptyRoomForm,
  })

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
    } catch {
      toast.error("Could not load rooms and buildings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** POST/PUT a form; returns the error message, or null on success. */
  const save = async (url: string, method: "POST" | "PUT", body: unknown, fallback: string): Promise<string | null> => {
    setSaving(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) return null
      return await readApiError(res, fallback)
    } catch {
      return "Could not reach the server — please try again."
    } finally {
      setSaving(false)
    }
  }

  /** DELETE; a refusal (e.g. history exists → 409) is shown as a toast. */
  const remove = async (url: string, what: string): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await fetch(url, { method: "DELETE" })
      if (res.ok) {
        toast.success(`${what} deleted`)
        fetchData()
        return true
      }
      toast.error(await readApiError(res, `Could not delete the ${what.toLowerCase()}`))
      return false
    } catch {
      toast.error("Could not reach the server — please try again.")
      return false
    } finally {
      setSaving(false)
    }
  }

  // ---- Buildings ----
  const onSubmitBuilding = async (values: BuildingFormValues) => {
    setBuildingError(null)
    const error = await save(
      isBuildingEditMode ? `/api/buildings/${editingBuildingId}` : "/api/buildings",
      isBuildingEditMode ? "PUT" : "POST",
      { propertyId, name: values.name },
      "Could not save the building"
    )
    if (error) return setBuildingError(error)
    toast.success(isBuildingEditMode ? "Building saved" : "Building added")
    resetBuildingForm()
    setIsBuildingDialogOpen(false)
    fetchData()
  }

  const resetBuildingForm = () => {
    buildingForm.reset({ name: "" })
    setEditingBuildingId(null)
    setBuildingError(null)
  }

  const openBuildingEdit = (building: any) => {
    buildingForm.reset({ name: building.name })
    setBuildingError(null)
    setEditingBuildingId(building.id)
    setIsBuildingDialogOpen(true)
  }

  const openBuildingDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete building?",
      description: "Are you sure you want to delete this building? This will permanently delete all floors and rooms inside this building. If any of those rooms has reservation or maintenance history, the delete is refused.",
      confirmLabel: "Delete permanently",
      destructive: true,
    })
    if (ok) await remove(`/api/buildings/${id}`, "Building")
  }

  // ---- Floors ----
  const onSubmitFloor = async (values: FloorFormValues) => {
    setFloorError(null)
    const error = await save(
      isFloorEditMode ? `/api/floors/${editingFloorId}` : "/api/floors",
      isFloorEditMode ? "PUT" : "POST",
      { ...values, propertyId },
      "Could not save the floor"
    )
    if (error) return setFloorError(error)
    toast.success(isFloorEditMode ? "Floor saved" : "Floor added")
    resetFloorForm()
    setIsFloorDialogOpen(false)
    fetchData()
  }

  const resetFloorForm = () => {
    floorForm.reset({ name: "", buildingId: "" })
    setEditingFloorId(null)
    setFloorError(null)
  }

  const openFloorEdit = (floor: any) => {
    floorForm.reset({ name: floor.name, buildingId: floor.buildingId })
    setFloorError(null)
    setEditingFloorId(floor.id)
    setIsFloorDialogOpen(true)
  }

  const openFloorDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete floor?",
      description: "Are you sure you want to delete this floor? This will permanently delete all rooms on this floor. If any of them has reservation or maintenance history, the delete is refused.",
      confirmLabel: "Delete permanently",
      destructive: true,
    })
    if (ok) await remove(`/api/floors/${id}`, "Floor")
  }

  // ---- Rooms ----
  const roomTypeId = roomForm.watch("roomTypeId")
  const roomBuildingId = roomForm.watch("buildingId")
  const selectedRoomRoomType = roomTypes.find(rt => rt.id === roomTypeId)
  const isPseudoRoom = !!selectedRoomRoomType?.isPseudo
  const inheritedFeatures: RoomFeature[] = selectedRoomRoomType?.features || []

  const onSubmitRoom = async (values: RoomFormValues) => {
    setRoomError(null)
    const error = await save(
      isRoomEditMode ? `/api/rooms/${editingRoomId}` : "/api/rooms",
      isRoomEditMode ? "PUT" : "POST",
      {
        propertyId,
        roomNumber: values.roomNumber,
        roomTypeId: values.roomTypeId,
        floorId: values.isPseudo ? null : values.floorId,
        features: values.isPseudo ? [] : values.features,
      },
      "Could not save the room"
    )
    if (error) {
      // A duplicate number belongs next to the Room Number field.
      if (/already exists/i.test(error)) roomForm.setError("roomNumber", { type: "server", message: error })
      else setRoomError(error)
      return
    }
    toast.success(isRoomEditMode ? "Room saved" : "Room added")
    resetRoomForm()
    setIsRoomDialogOpen(false)
    fetchData()
  }

  const resetRoomForm = () => {
    roomForm.reset(emptyRoomForm)
    setEditingRoomId(null)
    setRoomError(null)
  }

  const openRoomEdit = (room: any) => {
    const floor = allFloors.find(f => f.id === room.floorId)
    const type = roomTypes.find(rt => rt.id === room.roomTypeId)
    roomForm.reset({
      roomNumber: room.roomNumber,
      roomTypeId: room.roomTypeId || "",
      isPseudo: !!type?.isPseudo,
      buildingId: floor?.buildingId || "",
      floorId: room.floorId || "",
      features: (room.features || []).map((f: any) => ({ category: f.category, code: f.code })),
    })
    setRoomError(null)
    setEditingRoomId(room.id)
    setIsRoomDialogOpen(true)
  }

  const openRoomDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete room?",
      description: "Are you sure you want to delete this room? This action cannot be undone. A room with reservation or maintenance history can't be deleted — set it Out of Service instead.",
      confirmLabel: "Delete permanently",
      destructive: true,
    })
    if (ok) await remove(`/api/rooms/${id}`, "Room")
  }

  // Get all floors across all buildings for the room edit form (looking up a room's
  // existing floor by id, regardless of which building it belongs to)
  const allFloors = buildings.flatMap(b => b.floors || [])
  // The Floor select is dependent on which Building is selected — only that building's own floors
  const floorsForSelectedBuilding: any[] = buildings.find(b => b.id === roomBuildingId)?.floors || []
  const { options: featureOptions } = useRoomFeatureOptions(propertyId)
  const featureLabel = (f: RoomFeature) => featureOptions.find(o => o.category === f.category && o.code === f.code)?.value || f.code

  // A new room can't go on an inactive room type (the API refuses it too); an existing
  // room keeps its current type in the list even if that type has since been deactivated.
  const currentRoomTypeId = isRoomEditMode ? rooms.find(r => r.id === editingRoomId)?.roomTypeId : undefined
  const selectableRoomTypes = roomTypes.filter(rt => rt.isActive || rt.id === currentRoomTypeId)

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
            <Button onClick={() => { resetBuildingForm(); setIsBuildingDialogOpen(true) }} className="shadow-sm">
              <Building2 className="mr-2 h-4 w-4" /> Add building
            </Button>
          }
        />
      )}
      <Dialog open={isBuildingDialogOpen} onOpenChange={(open) => {
          setIsBuildingDialogOpen(open)
          if (!open) resetBuildingForm()
        }}>
            <DialogContent size="sm">
              <Form {...buildingForm}>
              <form onSubmit={buildingForm.handleSubmit(onSubmitBuilding)} noValidate>
                <DialogHeader><DialogTitle>{isBuildingEditMode ? "Edit building" : "Add building"}</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <FormField control={buildingForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Building name *</FormLabel>
                      <FormControl><Input placeholder="e.g. Main Tower" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <ServerError message={buildingError} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsBuildingDialogOpen(false)}>Cancel</Button>
                  <SubmitButton pending={saving}>{isBuildingEditMode ? "Save" : "Create"}</SubmitButton>
                </DialogFooter>
              </form>
              </Form>
            </DialogContent>
          </Dialog>

      <ControlsSectionBody>
          {/* Phone — card stack. Table below takes over at md. */}
          <MobileCardList className="p-4" empty={<EmptyState icon={Building2} title="No buildings configured" />}>
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)
              : sortedBuildings.map((building) => (
                  <MobileCard
                    key={building.id}
                    title={building.name}
                    onClick={() => openBuildingEdit(building)}
                    actions={
                      <>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-primary" onClick={() => openBuildingEdit(building)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive" onClick={() => openBuildingDelete(building.id)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    }
                  />
                ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="name" sort={buildingSort} className="px-6 py-4">Building name</SortableTableHead>
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
          </div>
      </ControlsSectionBody>
      </>
    )}

    {view === "floors" && (
      <>
      {/* Floors Table */}
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => { resetFloorForm(); setIsFloorDialogOpen(true) }} className="shadow-sm">
              <Map className="mr-2 h-4 w-4" /> Add floor
            </Button>
          }
        />
      )}
      <Dialog open={isFloorDialogOpen} onOpenChange={(open) => {
          setIsFloorDialogOpen(open)
          if (!open) resetFloorForm()
        }}>
            <DialogContent size="sm">
              <Form {...floorForm}>
              <form onSubmit={floorForm.handleSubmit(onSubmitFloor)} noValidate>
                <DialogHeader><DialogTitle>{isFloorEditMode ? "Edit floor" : "Add floor"}</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <FormField control={floorForm.control} name="buildingId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Building *</FormLabel>
                      <Select value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select building">
                              {field.value ? buildings.find(b => b.id === field.value)?.name : "Select building"}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {buildings.length === 0 && (
                        <p className="text-xs text-muted-foreground">Add a building first (Buildings tab).</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={floorForm.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Floor name/number *</FormLabel>
                      <FormControl><Input placeholder="e.g. 1st Floor" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <ServerError message={floorError} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsFloorDialogOpen(false)}>Cancel</Button>
                  <SubmitButton pending={saving}>{isFloorEditMode ? "Save" : "Create"}</SubmitButton>
                </DialogFooter>
              </form>
              </Form>
            </DialogContent>
          </Dialog>

      <ControlsSectionBody>
          {/* Phone — card stack. Table below takes over at md. */}
          <MobileCardList className="p-4" empty={<EmptyState icon={Map} title="No floors configured" />}>
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
              : sortedFloors.map((floor) => (
                  <MobileCard
                    key={floor.id}
                    title={floor.name}
                    subtitle={buildings.find(b => b.id === floor.buildingId)?.name || "Unknown building"}
                    onClick={() => openFloorEdit(floor)}
                    actions={
                      <>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-primary" onClick={() => openFloorEdit(floor)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive" onClick={() => openFloorDelete(floor.id)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    }
                  />
                ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="name" sort={floorSort} className="px-6 py-4">Floor name</SortableTableHead>
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
                      {buildings.find(b => b.id === floor.buildingId)?.name || "Unknown building"}
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
          </div>
      </ControlsSectionBody>
      </>
    )}

    {view === "rooms" && (
      <>
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => { resetRoomForm(); setIsRoomDialogOpen(true) }} className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> Add room
            </Button>
          }
        />
      )}
      <Dialog open={isRoomDialogOpen} onOpenChange={(open) => {
          setIsRoomDialogOpen(open)
          if (!open) resetRoomForm()
        }}>
            <DialogContent size="md">
              <Form {...roomForm}>
              <form onSubmit={roomForm.handleSubmit(onSubmitRoom)} noValidate>
                <DialogHeader><DialogTitle>{isRoomEditMode ? "Edit room" : "Add room"}</DialogTitle></DialogHeader>
                <div className="py-4 space-y-4">
                  <FormField control={roomForm.control} name="roomNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Room number / name *</FormLabel>
                      <FormControl><Input placeholder="e.g. 101" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={roomForm.control} name="roomTypeId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Room type *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          const next = roomTypes.find(rt => rt.id === v)
                          field.onChange(v ?? "")
                          // Changing the type clears the location/features picked for the old one.
                          roomForm.setValue("isPseudo", !!next?.isPseudo)
                          roomForm.setValue("buildingId", "")
                          roomForm.setValue("floorId", "")
                          roomForm.setValue("features", [])
                          roomForm.clearErrors(["buildingId", "floorId"])
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type">
                              {field.value ? roomTypes.find(rt => rt.id === field.value)?.name : "Select type"}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {selectableRoomTypes.map(rt => (
                            <SelectItem key={rt.id} value={rt.id}>
                              {rt.name}{rt.isPseudo ? " (Pseudo)" : ""}{!rt.isActive ? " (Inactive)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {isPseudoRoom ? (
                    <p className="text-xs text-muted-foreground rounded-md border border-border p-3">
                      This is a Pseudo room type — it has no physical location, so Building, Floor, and Room Features aren&apos;t applicable.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <FormField control={roomForm.control} name="buildingId" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Building *</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(v) => {
                                field.onChange(v ?? "")
                                roomForm.setValue("floorId", "", { shouldValidate: roomForm.formState.isSubmitted })
                              }}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select building">
                                    {field.value ? buildings.find(b => b.id === field.value)?.name : "Select building"}
                                  </SelectValue>
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={roomForm.control} name="floorId" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Floor *</FormLabel>
                            <Select
                              value={field.value}
                              onValueChange={(v) => field.onChange(v ?? "")}
                              disabled={!roomBuildingId}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={roomBuildingId ? "Select floor" : "Select a building first"}>
                                    {field.value ? floorsForSelectedBuilding.find(f => f.id === field.value)?.name : undefined}
                                  </SelectValue>
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {floorsForSelectedBuilding.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="border-t border-border pt-4">
                        <h4 className="text-sm font-semibold text-foreground mb-2">Room features</h4>
                        {inheritedFeatures.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-muted-foreground mb-1">Inherited from room type (fixed here):</p>
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
                        <FormField control={roomForm.control} name="features" render={({ field }) => (
                          <RoomFeaturePicker
                            propertyId={propertyId}
                            selected={field.value}
                            onChange={(next) => field.onChange(next)}
                            excluded={inheritedFeatures}
                          />
                        )} />
                      </div>
                    </>
                  )}
                  <ServerError message={roomError} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsRoomDialogOpen(false)}>Cancel</Button>
                  <SubmitButton pending={saving}>{isRoomEditMode ? "Save" : "Create"}</SubmitButton>
                </DialogFooter>
              </form>
              </Form>
            </DialogContent>
          </Dialog>

      <ControlsSectionBody>
          {/* Phone — card stack. Table below takes over at md. */}
          <MobileCardList
            className="p-4"
            empty={
              <EmptyState
                icon={DoorOpen}
                title="No rooms configured"
                description="Add a building, a floor, and then create rooms."
              />
            }
          >
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
              : sortedRooms.map((room) => (
                  <MobileCard
                    key={room.id}
                    title={room.roomNumber}
                    subtitle={room.roomType?.name}
                    badge={
                      <>
                        {room.roomType?.isPseudo && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">Pseudo</span>
                        )}
                        <StatusBadge label={room.status.replace(/_/g, ' ')} status={room.status} />
                      </>
                    }
                    meta={[{ label: "Floor", value: room.floor?.name || "—" }]}
                    onClick={() => openRoomEdit(room)}
                    actions={
                      <>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-primary" onClick={() => openRoomEdit(room)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive" onClick={() => openRoomDelete(room.id)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                        </Button>
                      </>
                    }
                  />
                ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border">
                <SortableTableHead columnKey="roomNumber" sort={roomSort} className="px-6 py-4">Room</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Floor</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Room type</TableHead>
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
          </div>
      </ControlsSectionBody>
      </>
    )}
    </div>
  )
}
