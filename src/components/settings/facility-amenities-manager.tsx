"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Pencil, Plus, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { amenitySchema, amenityNameKey } from "@/lib/facility-amenity"

type Facility = { id: string; name: string; description: string | null }

// The shared amenity schema plus a live duplicate-name check against this property's
// other amenities (the API re-checks, case-insensitively).
function formSchema(facilities: Facility[], exceptId?: string) {
  const taken = new Set(facilities.filter((f) => f.id !== exceptId).map((f) => amenityNameKey(f.name)))
  return amenitySchema.refine((v) => !taken.has(amenityNameKey(v.name)), {
    message: "An amenity with this name already exists",
    path: ["name"],
  })
}

function useAmenityForm(facilities: Facility[], exceptId?: string, initial?: Facility) {
  const schema = useMemo(() => formSchema(facilities, exceptId), [facilities, exceptId])
  return useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { name: initial?.name ?? "", description: initial?.description ?? "" },
  })
}

type AmenityForm = ReturnType<typeof useAmenityForm>

function AmenityFields({ form }: { form: AmenityForm }) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel>Facility Name</FormLabel>
            <FormControl>
              <Input placeholder="e.g. Infinity Pool" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel>Description (Optional)</FormLabel>
            <FormControl>
              <Input placeholder="Located on the rooftop" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

function EditAmenityDialog({
  facility,
  facilities,
  onClose,
  onSaved,
}: {
  facility: Facility
  facilities: Facility[]
  onClose: () => void
  onSaved: () => void
}) {
  const form = useAmenityForm(facilities, facility.id, facility)
  const [serverError, setServerError] = useState<string | null>(null)

  const onSubmit = async (values: z.output<typeof amenitySchema>) => {
    setServerError(null)
    const res = await fetch(`/api/facilities/${facility.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: values.name, description: values.description ?? "" }),
    })
    if (res.ok) {
      onSaved()
      return
    }
    const body = await res.json().catch(() => null)
    setServerError(body?.error || "Couldn't save the amenity.")
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit amenity</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <AmenityFields form={form} />
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!form.formState.isValid || !form.formState.isDirty || form.formState.isSubmitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// Folded in from the previously-orphaned /dashboard/settings/facilities page — this is
// the amenities list (Pool, Gym, Spa) shown on a property's public/guest-facing profile,
// distinct from "Facilities & Rooms" tab's Buildings/Floors/RoomTypes management above.
export function FacilityAmenitiesManager({ propertyId }: { propertyId: string }) {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Facility | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const confirm = useConfirm()
  const form = useAmenityForm(facilities)

  const fetchFacilities = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/facilities?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setFacilities(data)
      })
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchFacilities() }, [fetchFacilities])

  const handleAdd = async (values: z.output<typeof amenitySchema>) => {
    if (!propertyId) return
    setServerError(null)
    const res = await fetch("/api/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, name: values.name, description: values.description ?? "" }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Couldn't add the amenity.")
      return
    }
    form.reset({ name: "", description: "" })
    fetchFacilities()
  }

  const handleDelete = async (f: Facility) => {
    const ok = await confirm({
      title: `Delete "${f.name}"?`,
      description: "It will no longer be listed among this property's amenities.",
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/facilities/${f.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      toast.error(body?.error || "Couldn't delete the amenity.")
      return
    }
    fetchFacilities()
  }

  // First-column (Name) sorting, asc<->desc.
  const { sorted: sortedFacilities, sort } = useTableSort(facilities, { name: (f) => f.name }, "name")

  return (
    <div className="space-y-4">
      {propertyId && (
        <>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAdd)} className="space-y-2">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <AmenityFields form={form} />
                <Button type="submit" className="sm:mt-8" disabled={!form.formState.isValid || form.formState.isSubmitting}>
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>
              </div>
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            </form>
          </Form>

          {/* Phone view — the table below takes over at md. */}
          <MobileCardList
            empty={<p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">No facilities configured.</p>}
          >
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
              : sortedFacilities.map((f) => (
                  <MobileCard
                    key={f.id}
                    title={f.name}
                    subtitle={f.description || undefined}
                    onClick={() => setEditing(f)}
                    actions={
                      <>
                        <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => setEditing(f)}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                        <Button
                          variant="outline" size="icon"
                          className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive-muted"
                          aria-label={`Delete ${f.name}`}
                          onClick={() => handleDelete(f)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    }
                  />
                ))}
          </MobileCardList>

          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead columnKey="name" sort={sort}>Name</SortableTableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : facilities.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center">No facilities configured.</TableCell></TableRow>
              ) : (
                sortedFacilities.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{f.description || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${f.name}`} className="text-destructive" onClick={() => handleDelete(f)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>

          {editing && (
            <EditAmenityDialog
              facility={editing}
              facilities={facilities}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                fetchFacilities()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
