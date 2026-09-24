"use client"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus, Pencil, Trash2, BedDouble } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ControlsSectionHeader, ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { RoomFeaturePicker, type RoomFeature } from "@/components/inventory/room-feature-picker"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"
import {
  emptyRoomTypeForm,
  readApiError,
  roomTypeFormSchema,
  roomTypePayload,
  type RoomTypeFormValues,
} from "@/lib/inventory-form-schemas"
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
  DialogFooter,
} from "@/components/ui/dialog"

type RoomType = {
  id: string
  name: string
  code: string
  maxOccupancy: number
  baseOccupancy: number
  description?: string
  isActive: boolean
  isPseudo: boolean
  housekeepingEnabled: boolean
  features: RoomFeature[]
}

// addSignal/hideAddButton: when embedded in FacilitiesManager, the Add button lives in
// the shared tab row (see facilities-manager.tsx). This manager then hides its own
// header button and opens its Add dialog when the parent bumps addSignal.
//
// Form: APP STANDARD 001 (Zod + React Hook Form, inline validation) — schema in
// src/lib/inventory-form-schemas.ts. A server refusal (duplicate code, licence cap, ...)
// is shown inside the dialog; a refused delete (history exists) as a toast.
export function RoomTypeManager({
  propertyId,
  addSignal,
  hideAddButton = false,
}: {
  propertyId: string
  addSignal?: number
  hideAddButton?: boolean
}) {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const isEditMode = editingId !== null
  const [serverError, setServerError] = useState<string | null>(null)

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const form = useForm<RoomTypeFormValues>({
    resolver: zodResolver(roomTypeFormSchema),
    mode: "onChange",
    defaultValues: emptyRoomTypeForm,
  })

  const fetchRoomTypes = () => {
    setLoading(true)
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setRoomTypes(data)
      })
      .catch(() => toast.error("Could not load room types"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRoomTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = async (values: RoomTypeFormValues) => {
    setIsSubmitting(true)
    setServerError(null)
    try {
      const response = await fetch(isEditMode ? `/api/room-types/${editingId}` : "/api/room-types", {
        method: isEditMode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomTypePayload(values, propertyId)),
      })

      if (response.ok) {
        const saved = await response.json().catch(() => null)
        setIsDialogOpen(false)
        resetForm()
        fetchRoomTypes()
        if (saved?.restoredRooms > 0) {
          toast.success(`Room type re-activated — ${saved.restoredRooms} room(s) set to Dirty for inspection`)
        } else {
          toast.success(isEditMode ? "Room type saved" : "Room type created")
        }
      } else {
        const message = await readApiError(response, "Could not save the room type")
        // A duplicate code belongs next to the Code field; anything else (licence cap,
        // permission, ...) is shown above the buttons.
        if (response.status === 409 && /code/i.test(message)) {
          form.setError("code", { type: "server", message })
        } else {
          setServerError(message)
        }
      }
    } catch {
      setServerError("Could not reach the server — please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/room-types/${deletingId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        toast.success("Room type deleted")
        fetchRoomTypes()
      } else {
        toast.error(await readApiError(response, "Could not delete the room type"))
      }
    } catch {
      toast.error("Could not reach the server — please try again.")
    } finally {
      setIsDeleteDialogOpen(false)
      setDeletingId(null)
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    form.reset(emptyRoomTypeForm)
    setEditingId(null)
    setServerError(null)
  }

  const openEdit = (rt: RoomType) => {
    form.reset({
      name: rt.name,
      code: rt.code,
      maxOccupancy: rt.maxOccupancy.toString(),
      baseOccupancy: rt.baseOccupancy.toString(),
      description: rt.description || "",
      isInactive: !rt.isActive,
      isPseudo: rt.isPseudo,
      housekeepingEnabled: rt.housekeepingEnabled,
      features: (rt.features || []).map((f) => ({ category: f.category, code: f.code })),
    })
    setServerError(null)
    setEditingId(rt.id)
    setIsDialogOpen(true)
  }

  const openDelete = (id: string) => {
    setDeletingId(id)
    setIsDeleteDialogOpen(true)
  }

  // Open the Add dialog when FacilitiesManager's shared Add button is clicked. We compare
  // the signal's VALUE against the last-seen one rather than using a "first run" flag: a
  // flag gets consumed by React StrictMode's double-invoke of effects on mount, which
  // then opens the dialog on the second invoke (the bug this replaces). Comparing values
  // is idempotent — the signal doesn't change between the double-invokes, so mount and
  // tab-switch never open anything; only an actual Add click (which increments it) does.
  const lastAddSignal = useRef(addSignal)
  useEffect(() => {
    if (addSignal === lastAddSignal.current) return
    lastAddSignal.current = addSignal
    resetForm()
    setIsDialogOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSignal])

  // First-column (Code) sorting, asc<->desc.
  const { sorted: sortedRoomTypes, sort } = useTableSort(roomTypes, { code: (rt) => rt.code }, "code")
  const deletingRoomType = roomTypes.find((rt) => rt.id === deletingId)

  return (
    <div className="mt-6">
      {!hideAddButton && (
        <ControlsSectionHeader
          action={
            <Button onClick={() => { resetForm(); setIsDialogOpen(true) }} className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" /> Add Room Type
            </Button>
          }
        />
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) resetForm()
      }}>
          <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
            <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Room Type" : "Create Room Type"}</DialogTitle>
                <DialogDescription>
                  {isEditMode ? "Update the details for this room category." : "Define a new category of rooms for this property."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Deluxe Ocean View" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField control={form.control} name="code" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code *</FormLabel>
                      <FormControl><Input placeholder="e.g. DLX" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="maxOccupancy" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Occupancy *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e)
                            // Base ≤ max is a cross-field rule — re-check Base when Max moves.
                            if (form.getFieldState("baseOccupancy").isDirty || form.formState.errors.baseOccupancy) {
                              void form.trigger("baseOccupancy")
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="baseOccupancy" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base Occupancy (Adults) *</FormLabel>
                    <FormControl><Input type="number" min="1" {...field} /></FormControl>
                    <FormDescription>Adults included before Extra Adult Price (set on Revenue &gt; Rate Seasons) applies. Cannot exceed Max Occupancy.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <p className="text-xs text-muted-foreground -mt-2">
                  Default nightly price is set per room type on the locked <span className="font-medium">Base Rate</span> plan (Revenue &gt; Rate Plans &gt; Calendar) — it applies whenever no other rate plan has a price for the date.
                </p>
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl><Input placeholder="Brief description of the room amenities" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="isInactive" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <div>
                      <FormLabel>Inactive</FormLabel>
                      <FormDescription>
                        No new reservations can be made for this room type. All of its rooms are taken out of service (history is preserved); making it active again sets those rooms to Dirty for inspection.
                      </FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="isPseudo" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <div>
                      <FormLabel>Pseudo Room Type</FormLabel>
                      <FormDescription>Dummy category with no physical room attached (e.g. day-use, overbooking buffer).</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="housekeepingEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <div>
                      <FormLabel>Housekeeping Enabled</FormLabel>
                      <FormDescription>Off hides Housekeeping/Maintenance options for rooms of this type.</FormDescription>
                    </div>
                    <FormControl><Switch checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /></FormControl>
                  </FormItem>
                )} />

                <div className="border-t border-border pt-4 mt-2">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Room Features</h4>
                  <FormField control={form.control} name="features" render={({ field }) => (
                    <RoomFeaturePicker
                      propertyId={propertyId}
                      selected={field.value}
                      onChange={(next) => field.onChange(next)}
                    />
                  )} />
                </div>

                {serverError && (
                  <p role="alert" className="rounded-md bg-destructive-muted p-3 text-sm text-destructive">{serverError}</p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Room Type"}
                </Button>
              </DialogFooter>
            </form>
            </Form>
          </DialogContent>
        </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Room Type</DialogTitle>
            <DialogDescription>
              Delete {deletingRoomType ? <>&quot;{deletingRoomType.name}&quot;</> : "this room type"} and all of its rooms? This cannot be undone. If it or any of its rooms has reservations, group blocks or maintenance history, the delete is refused — make it inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
              {isSubmitting ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ControlsSectionBody>
        {loading ? (
          <div className="space-y-3 p-4 md:p-0">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : roomTypes.length === 0 ? (
          <EmptyState icon={BedDouble} title="No room types found" description="Create one to get started." />
        ) : (
          <>
            {/* Mobile card view — the table below takes over at md. */}
            <div className="md:hidden space-y-3 p-4">
              {sortedRoomTypes.map((rt) => (
                <div key={rt.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{rt.code}</p>
                      <p className="text-sm text-muted-foreground">{rt.name}</p>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0">{rt.maxOccupancy} Persons</span>
                  </div>
                  {(!rt.isActive || rt.isPseudo || !rt.housekeepingEnabled) && (
                    <div className="flex flex-wrap gap-1.5">
                      {!rt.isActive && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-destructive/10 text-destructive border-destructive/20">Inactive</span>
                      )}
                      {rt.isPseudo && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">Pseudo</span>
                      )}
                      {!rt.housekeepingEnabled && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">No Housekeeping</span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openEdit(rt)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive" onClick={() => openDelete(rt.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-border">
                    <SortableTableHead columnKey="code" sort={sort} className="px-6 py-4">Code</SortableTableHead>
                    <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Name</TableHead>
                    <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Max Occupancy</TableHead>
                    <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Flags</TableHead>
                    <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRoomTypes.map((rt) => (
                    <TableRow key={rt.id} className="group hover:bg-muted/40">
                      <TableCell className="px-6 py-4 font-semibold text-foreground">{rt.code}</TableCell>
                      <TableCell className="px-6 py-4 font-medium text-foreground">{rt.name}</TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">{rt.maxOccupancy} Persons ({rt.baseOccupancy} base)</TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">
                        <div className="flex gap-1.5">
                          {!rt.isActive && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-destructive/10 text-destructive border-destructive/20">Inactive</span>
                          )}
                          {rt.isPseudo && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">Pseudo</span>
                          )}
                          {!rt.housekeepingEnabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-muted text-muted-foreground">No Housekeeping</span>
                          )}
                          {rt.isActive && !rt.isPseudo && rt.housekeepingEnabled && "—"}
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary"
                            onClick={() => openEdit(rt)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => openDelete(rt.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </ControlsSectionBody>
    </div>
  )
}
