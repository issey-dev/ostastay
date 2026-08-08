"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, Pencil, Trash2, CalendarOff, DoorOpen } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useProperty } from "@/components/providers/property-provider"

type RoomExceptionRow = { id: string; date: string; startTime: string | null; endTime: string | null; exceptionType: string; reason: string | null }

type SpaRoomDto = {
  id: string
  name: string
  code: string | null
  description: string | null
  capacity: number
  roomType: string | null
  isActive: boolean
  bookable: boolean
  displayOrder: number
  compatibleTreatments: { treatmentId: string; treatment: { id: string; name: string } }[]
  exceptions: RoomExceptionRow[]
}

const roomSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().optional(),
  description: z.string().optional(),
  capacity: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 1, "Must be at least 1"),
  roomType: z.string().optional(),
  isActive: z.boolean(),
  bookable: z.boolean(),
  displayOrder: z.string().refine((v) => !isNaN(parseInt(v)), "Must be a number"),
})

type RoomFormValues = z.infer<typeof roomSchema>

const emptyValues: RoomFormValues = {
  name: "", code: "", description: "", capacity: "1", roomType: "", isActive: true, bookable: true, displayOrder: "0",
}

const EXCEPTION_TYPES = ["MAINTENANCE", "CLEANING", "RENOVATION", "PRIVATE_EVENT", "UNAVAILABLE"] as const

export function SpaRoomsManager() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [rooms, setRooms] = useState<SpaRoomDto[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SpaRoomDto | null>(null)
  const [deleting, setDeleting] = useState<SpaRoomDto | null>(null)
  const [exceptionsFor, setExceptionsFor] = useState<SpaRoomDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<RoomFormValues>({ resolver: zodResolver(roomSchema), mode: "onChange", defaultValues: emptyValues })

  const fetchRooms = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/spa/rooms?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setRooms(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRooms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (r: SpaRoomDto) => {
    setEditing(r)
    setServerError(null)
    form.reset({
      name: r.name,
      code: r.code ?? "",
      description: r.description ?? "",
      capacity: String(r.capacity),
      roomType: r.roomType ?? "",
      isActive: r.isActive,
      bookable: r.bookable,
      displayOrder: String(r.displayOrder),
    })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: RoomFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = { ...values, propertyId, capacity: parseInt(values.capacity), displayOrder: parseInt(values.displayOrder) }
      const url = editing ? `/api/spa/rooms/${editing.id}` : "/api/spa/rooms"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchRooms()
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save room")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/spa/rooms/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to delete room")
    } else {
      setServerError(null)
    }
    setDeleting(null)
    fetchRooms()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm">
          <Plus className="mr-2 h-4 w-4" /> New Room
        </Button>
      </div>

      {serverError && !isDialogOpen && !exceptionsFor && <p className="text-sm text-destructive">{serverError}</p>}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState icon={DoorOpen} title="No treatment rooms yet" description="e.g. Treatment Room 1, Treatment Room 2, Couple Treatment Room." />
      ) : (
        <>
          {/* Phone view — the table below takes over at md. */}
          <div className="md:hidden space-y-3">
            {rooms.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <p className="font-medium truncate">{r.name}</p>
                      {r.code && <span className="font-mono text-xs text-muted-foreground shrink-0">{r.code}</span>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Capacity {r.capacity}{r.roomType ? ` · ${r.roomType}` : ""}
                    </p>
                  </div>
                  {r.isActive && r.bookable ? (
                    <Badge variant="outline" className="bg-success-muted text-success border-success/30 shrink-0">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground shrink-0">{r.isActive ? "Not bookable" : "Inactive"}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => setExceptionsFor(r)}>
                    <CalendarOff className="h-3.5 w-3.5 mr-1.5" /> Closures
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openEdit(r)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive hover:text-destructive" onClick={() => setDeleting(r)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.code || "—"}</TableCell>
                    <TableCell className="text-sm">{r.capacity}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.roomType || "—"}</TableCell>
                    <TableCell>
                      {r.isActive && r.bookable ? (
                        <Badge variant="outline" className="bg-success-muted text-success border-success/30">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">{r.isActive ? "Not bookable" : "Inactive"}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setExceptionsFor(r)}>
                        <CalendarOff className="h-4 w-4 mr-1.5" /> Closures
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Edit spa room" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Delete spa room" className="text-destructive hover:text-destructive" onClick={() => setDeleting(r)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Room" : "New Room"}</DialogTitle>
                <DialogDescription>A treatment room — capacity 2+ enables couple treatments.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl><Input placeholder="e.g. Treatment Room 1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="code" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="capacity" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity *</FormLabel>
                      <FormControl><Input type="number" min="1" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">Must be ≥ a treatment&apos;s party size to be offered.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="roomType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Room Type</FormLabel>
                      <FormControl><Input placeholder="e.g. MASSAGE, SALON" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Active</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bookable" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Bookable</FormLabel>
                    </FormItem>
                  )} />
                </div>
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Room"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Room</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleting?.name}&quot;? If it has any appointments booked this will be blocked — mark inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closures */}
      {exceptionsFor && (
        <RoomExceptionsDialog
          room={exceptionsFor}
          onClose={() => setExceptionsFor(null)}
          onChanged={fetchRooms}
        />
      )}
    </div>
  )
}

function RoomExceptionsDialog({ room, onClose, onChanged }: { room: SpaRoomDto; onClose: () => void; onChanged: () => void }) {
  const [exceptions, setExceptions] = useState<RoomExceptionRow[]>(room.exceptions)
  const [date, setDate] = useState<string | null>(null)
  const [exceptionType, setExceptionType] = useState<string>("MAINTENANCE")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const add = async () => {
    if (!date) {
      setError("Date is required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/spa/rooms/${room.id}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, exceptionType, reason: reason || null }),
      })
      if (res.ok) {
        const created = await res.json()
        setExceptions((prev) => [...prev, created])
        setDate(null)
        setReason("")
        onChanged()
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.error || "Failed to add closure")
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const res = await fetch(`/api/spa/rooms/${room.id}/exceptions/${id}`, { method: "DELETE" })
    if (res.ok) {
      setExceptions((prev) => prev.filter((e) => e.id !== id))
      onChanged()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Closures — {room.name}</DialogTitle>
          <DialogDescription>Maintenance, deep cleaning, renovation, or a private-event hold.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 items-end py-2 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Date *</p>
            <DatePicker value={date} onChange={setDate} placeholder="Select date" />
          </div>
          <Select value={exceptionType} onValueChange={(v) => setExceptionType(v ?? "MAINTENANCE")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXCEPTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="md:col-span-2" />
          <Button type="button" onClick={add} disabled={saving} className="md:col-span-2">
            <Plus className="h-4 w-4 mr-1.5" /> Add Closure
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-[35vh] overflow-y-auto space-y-2">
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closures recorded.</p>
          ) : (
            exceptions.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{new Date(e.date).toDateString()}</span>
                  <Badge variant="outline" className="ml-2">{e.exceptionType.replace(/_/g, " ")}</Badge>
                  {e.reason && <span className="text-muted-foreground ml-2">{e.reason}</span>}
                </div>
                <Button variant="ghost" size="icon" aria-label="Delete closure" className="text-destructive hover:text-destructive" onClick={() => remove(e.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
