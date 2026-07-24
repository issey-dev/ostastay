"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import * as z from "zod"
import { Plus, Pencil, Trash2, X, DoorOpen, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useProperty } from "@/components/providers/property-provider"
import type { SpaTreatmentCategoryDto } from "@/components/controls/spa-categories-manager"

export type SpaTreatmentRateDto = {
  id: string
  price: number
  effectiveFrom: string
  effectiveTo: string | null
}

export type SpaTreatmentDto = {
  id: string
  categoryId: string
  category: { id: string; name: string }
  name: string
  shortName: string | null
  description: string | null
  defaultDurationMinutes: number
  preparationBufferMinutes: number
  cleanupBufferMinutes: number
  chargeCodeId: string
  chargeCode: { id: string; code: string; description: string }
  maxParticipants: number
  pricingMode: string
  allowWalkIn: boolean
  allowInHouseGuest: boolean
  displayOrder: number
  isActive: boolean
  rates: SpaTreatmentRateDto[]
  compatibleRooms: { roomId: string; preferred: boolean }[]
}

type ChargeCodeOption = { id: string; code: string; description: string }
type RoomOption = { id: string; name: string }

const PRICING_MODE_LABELS: Record<string, string> = {
  PER_PERSON: "Per person (x party size)",
  FLAT: "Flat package price",
}

const priceString = z.string().min(1, "Required").refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Must be a number ≥ 0")

const rateRowSchema = z.object({
  price: priceString,
  effectiveFrom: z.string().min(1, "Required"),
  effectiveTo: z.string().optional(),
})

const treatmentSchema = z
  .object({
    categoryId: z.string().min(1, "Category is required"),
    name: z.string().min(2, "Name must be at least 2 characters"),
    shortName: z.string().optional(),
    description: z.string().optional(),
    defaultDurationMinutes: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) > 0, "Must be a positive number"),
    preparationBufferMinutes: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 0, "Must be a non-negative number"),
    cleanupBufferMinutes: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 0, "Must be a non-negative number"),
    chargeCodeId: z.string().min(1, "Charge code is required"),
    maxParticipants: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 1, "Must be at least 1"),
    pricingMode: z.enum(["PER_PERSON", "FLAT"]),
    allowWalkIn: z.boolean(),
    allowInHouseGuest: z.boolean(),
    isActive: z.boolean(),
    rates: z.array(rateRowSchema).min(1, "At least one price row is required"),
  })
  .superRefine((val, ctx) => {
    const rows = val.rates
      .map((r, i) => ({ i, from: new Date(r.effectiveFrom), to: r.effectiveTo ? new Date(r.effectiveTo) : null }))
      .sort((a, b) => a.from.getTime() - b.from.getTime())
    for (const r of rows) {
      if (r.to && r.to < r.from) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rates", r.i, "effectiveTo"], message: "End date is before start date" })
      }
    }
    for (let k = 0; k < rows.length - 1; k++) {
      if (!rows[k].to || rows[k].to! >= rows[k + 1].from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rates", rows[k + 1].i, "effectiveFrom"],
          message: "Date ranges must not overlap (only the last range may be open-ended)",
        })
      }
    }
  })

type TreatmentFormValues = z.infer<typeof treatmentSchema>

const emptyValues: TreatmentFormValues = {
  categoryId: "",
  name: "",
  shortName: "",
  description: "",
  defaultDurationMinutes: "60",
  preparationBufferMinutes: "0",
  cleanupBufferMinutes: "15",
  chargeCodeId: "",
  maxParticipants: "1",
  pricingMode: "PER_PERSON",
  allowWalkIn: true,
  allowInHouseGuest: true,
  isActive: true,
  rates: [{ price: "0", effectiveFrom: "", effectiveTo: "" }],
}

export function SpaTreatmentsManager({ categories, refreshKey }: { categories: SpaTreatmentCategoryDto[]; refreshKey: number }) {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [treatments, setTreatments] = useState<SpaTreatmentDto[]>([])
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SpaTreatmentDto | null>(null)
  const [deleting, setDeleting] = useState<SpaTreatmentDto | null>(null)
  const [roomsFor, setRoomsFor] = useState<SpaTreatmentDto | null>(null)
  const [roomSelection, setRoomSelection] = useState<Record<string, boolean>>({})
  const [preferredSelection, setPreferredSelection] = useState<Record<string, boolean>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<TreatmentFormValues>({ resolver: zodResolver(treatmentSchema), mode: "onChange", defaultValues: emptyValues })
  const ratesArray = useFieldArray({ control: form.control, name: "rates" })

  const fetchTreatments = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/spa/treatments?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTreatments(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchTreatments()
    fetch("/api/charge-codes").then((r) => r.json()).then((data) => { if (Array.isArray(data)) setChargeCodes(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, refreshKey])

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/spa/rooms?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setRooms(data.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }))) })
  }, [propertyId])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (t: SpaTreatmentDto) => {
    setEditing(t)
    setServerError(null)
    form.reset({
      categoryId: t.categoryId,
      name: t.name,
      shortName: t.shortName ?? "",
      description: t.description ?? "",
      defaultDurationMinutes: String(t.defaultDurationMinutes),
      preparationBufferMinutes: String(t.preparationBufferMinutes),
      cleanupBufferMinutes: String(t.cleanupBufferMinutes),
      chargeCodeId: t.chargeCodeId,
      maxParticipants: String(t.maxParticipants),
      pricingMode: (t.pricingMode as TreatmentFormValues["pricingMode"]) || "PER_PERSON",
      allowWalkIn: t.allowWalkIn,
      allowInHouseGuest: t.allowInHouseGuest,
      isActive: t.isActive,
      rates: t.rates.map((r) => ({
        price: String(r.price),
        effectiveFrom: r.effectiveFrom.slice(0, 10),
        effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : "",
      })),
    })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: TreatmentFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = {
        ...values,
        propertyId,
        defaultDurationMinutes: parseInt(values.defaultDurationMinutes),
        preparationBufferMinutes: parseInt(values.preparationBufferMinutes),
        cleanupBufferMinutes: parseInt(values.cleanupBufferMinutes),
        maxParticipants: parseInt(values.maxParticipants),
        rates: values.rates.map((r) => ({
          price: parseFloat(r.price),
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo || null,
        })),
      }
      const url = editing ? `/api/spa/treatments/${editing.id}` : "/api/spa/treatments"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchTreatments()
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save treatment")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/spa/treatments/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to delete treatment")
    } else {
      setServerError(null)
    }
    setDeleting(null)
    fetchTreatments()
  }

  const openRooms = (t: SpaTreatmentDto) => {
    setRoomsFor(t)
    const selected: Record<string, boolean> = {}
    const preferred: Record<string, boolean> = {}
    for (const cr of t.compatibleRooms) {
      selected[cr.roomId] = true
      preferred[cr.roomId] = cr.preferred
    }
    setRoomSelection(selected)
    setPreferredSelection(preferred)
  }

  const saveRooms = async () => {
    if (!roomsFor) return
    const roomsPayload = Object.entries(roomSelection)
      .filter(([, checked]) => checked)
      .map(([roomId]) => ({ roomId, preferred: !!preferredSelection[roomId] }))
    const res = await fetch(`/api/spa/treatments/${roomsFor.id}/rooms`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rooms: roomsPayload }),
    })
    if (res.ok) {
      setRoomsFor(null)
      fetchTreatments()
    } else {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to save room compatibility")
    }
  }

  const currentPriceLabel = (t: SpaTreatmentDto) => {
    const today = new Date()
    const row = t.rates.find((r) => {
      const from = new Date(r.effectiveFrom)
      const to = r.effectiveTo ? new Date(r.effectiveTo) : null
      return from <= today && (!to || to >= today)
    })
    if (!row) return <span className="text-muted-foreground text-xs">No current price</span>
    return <span className="font-mono text-sm">${row.price}{t.pricingMode === "PER_PERSON" ? "/person" : " flat"}</span>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm" disabled={categories.length === 0}>
          <Plus className="mr-2 h-4 w-4" /> New Treatment
        </Button>
      </div>
      {categories.length === 0 && (
        <p className="text-xs text-muted-foreground">Create at least one treatment category first.</p>
      )}

      {serverError && !isDialogOpen && !roomsFor && <p className="text-sm text-destructive">{serverError}</p>}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : treatments.length === 0 ? (
        <EmptyState icon={Sparkles} title="No treatments yet" description="e.g. Swedish Massage — 60 min, $80." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Charge Code</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {treatments.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-sm">{t.category?.name}</TableCell>
                <TableCell className="text-sm">
                  {t.defaultDurationMinutes} min
                  {(t.preparationBufferMinutes > 0 || t.cleanupBufferMinutes > 0) && (
                    <span className="text-muted-foreground text-xs"> (+{t.preparationBufferMinutes}/{t.cleanupBufferMinutes} buffer)</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{t.chargeCode?.code}</TableCell>
                <TableCell>{currentPriceLabel(t)}</TableCell>
                <TableCell className="text-sm">{t.maxParticipants > 1 ? `up to ${t.maxParticipants}` : "1"}</TableCell>
                <TableCell>
                  {t.isActive ? (
                    <Badge variant="outline" className="bg-success-muted text-success border-success/30">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="sm" onClick={() => openRooms(t)}>
                    <DoorOpen className="h-4 w-4 mr-1.5" /> Rooms
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleting(t)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Treatment" : "New Treatment"}</DialogTitle>
                <DialogDescription>e.g. Swedish Massage, 60 minutes, $80.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name *</FormLabel>
                      <FormControl><Input placeholder="e.g. Swedish Massage" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="categoryId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select category..."
                          options={categories.map((c) => ({ label: c.name, value: c.id }))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input placeholder="Optional guest-facing description" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="defaultDurationMinutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duration (min) *</FormLabel>
                      <FormControl><Input type="number" min="1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="preparationBufferMinutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prep Buffer (min)</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="cleanupBufferMinutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cleanup Buffer (min)</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="chargeCodeId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Charge Code *</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select charge code..."
                          options={chargeCodes.map((c) => ({ label: `${c.code} — ${c.description}`, value: c.id }))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="maxParticipants" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Participants *</FormLabel>
                      <FormControl><Input type="number" min="1" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">1 = individual only. 2+ = bookable as a couple/group session.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="pricingMode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pricing Mode *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue>{PRICING_MODE_LABELS[field.value]}</SelectValue></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(PRICING_MODE_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <Label className="text-sm font-medium">Pricing</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Date ranges must not overlap. Leave the end date empty for an open-ended range.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => ratesArray.append({ price: "0", effectiveFrom: "", effectiveTo: "" })}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add range
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {ratesArray.fields.map((row, idx) => (
                      <div key={row.id} className="grid grid-cols-[1fr_1.2fr_1.2fr_auto] gap-2 items-start">
                        <FormField control={form.control} name={`rates.${idx}.price`} render={({ field }) => (
                          <FormItem>
                            {idx === 0 && <FormLabel className="text-xs">Price $</FormLabel>}
                            <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`rates.${idx}.effectiveFrom`} render={({ field }) => (
                          <FormItem>
                            {idx === 0 && <FormLabel className="text-xs">From *</FormLabel>}
                            <FormControl><DatePicker value={field.value} onChange={field.onChange} placeholder="Start" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`rates.${idx}.effectiveTo`} render={({ field }) => (
                          <FormItem>
                            {idx === 0 && <FormLabel className="text-xs">To</FormLabel>}
                            <FormControl><DatePicker value={field.value || null} onChange={field.onChange} placeholder="Open-ended" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={idx === 0 ? "mt-6" : ""}
                          disabled={ratesArray.fields.length === 1}
                          onClick={() => ratesArray.remove(idx)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="allowInHouseGuest" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Bookable for in-house guests</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="allowWalkIn" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Bookable for walk-ins</FormLabel>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0 font-normal cursor-pointer">Active — bookable from Front Office</FormLabel>
                  </FormItem>
                )} />

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Treatment"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Treatment</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleting?.name}&quot;? If it has any appointments booked this will be blocked — deactivate instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Room compatibility */}
      <Dialog open={!!roomsFor} onOpenChange={(open) => !open && setRoomsFor(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Compatible Rooms — {roomsFor?.name}</DialogTitle>
            <DialogDescription>
              The booking engine only offers a room here. With none checked, any room compatible by type is offered instead.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-2 py-2">
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms configured yet.</p>
            ) : (
              rooms.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!!roomSelection[r.id]}
                      onCheckedChange={(checked) => setRoomSelection((prev) => ({ ...prev, [r.id]: !!checked }))}
                    />
                    <span className="text-sm">{r.name}</span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={!!preferredSelection[r.id]}
                      disabled={!roomSelection[r.id]}
                      onCheckedChange={(checked) => setPreferredSelection((prev) => ({ ...prev, [r.id]: !!checked }))}
                    />
                    Preferred
                  </label>
                </div>
              ))
            )}
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoomsFor(null)}>Cancel</Button>
            <Button onClick={saveRooms}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
