"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import * as z from "zod"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { Plus, Pencil, Trash2, X, CalendarClock } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsCard } from "@/components/controls/controls-card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useProperty } from "@/components/providers/property-provider"
import { ExcursionScheduleManager } from "@/components/controls/excursion-schedule-manager"

export type ExcursionRateDto = {
  id: string
  adultPrice: number
  childPrice: number
  infantPrice: number
  flatPrice: number | null
  effectiveFrom: string
  effectiveTo: string | null
}

export type ExcursionScheduleDto = {
  id: string
  daysOfWeek: string
  departureTime: string
  meetingTime: string | null
  meetingPoint: string | null
  capacity: number
  minCapacity: number | null
  isActive: boolean
}

export type ExcursionTypeDto = {
  id: string
  code: string
  name: string
  description: string | null
  chargeCodeId: string
  chargeCode: { id: string; code: string; description: string }
  pricingMode: string
  cutoffHours: number
  isActive: boolean
  rates: ExcursionRateDto[]
  schedules: ExcursionScheduleDto[]
}

type ChargeCodeOption = { id: string; code: string; description: string }

const PRICING_MODE_LABELS: Record<string, string> = {
  PER_PERSON: "Per adult / child / infant",
  FLAT: "Flat price per booking",
}

const priceString = z.string().min(1, "Required").refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Must be a number ≥ 0")
const optionalPriceString = z.string().refine((v) => v === "" || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0), "Must be a number ≥ 0")

const rateRowSchema = z.object({
  adultPrice: priceString,
  childPrice: priceString,
  infantPrice: priceString,
  flatPrice: optionalPriceString,
  effectiveFrom: z.string().min(1, "Required"),
  effectiveTo: z.string().optional(),
})

const excursionTypeSchema = z
  .object({
    code: z.string().min(2, "Code must be at least 2 characters").max(10),
    name: z.string().min(2, "Name must be at least 2 characters"),
    description: z.string().optional(),
    chargeCodeId: z.string().min(1, "Charge code is required"),
    pricingMode: z.enum(["PER_PERSON", "FLAT"]),
    cutoffHours: z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 0, "Must be a non-negative integer"),
    isActive: z.boolean(),
    rates: z.array(rateRowSchema).min(1, "At least one price row is required"),
  })
  .superRefine((val, ctx) => {
    if (val.pricingMode === "FLAT") {
      val.rates.forEach((r, i) => {
        if (r.flatPrice === "") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rates", i, "flatPrice"], message: "Required under flat pricing" })
        }
      })
    }
    // Mirror the API's no-overlap rule inline so the user hears about it before
    // submitting (the API remains the authority) — same pattern as AllocationsManager.
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

type ExcursionTypeFormValues = z.infer<typeof excursionTypeSchema>

const emptyValues: ExcursionTypeFormValues = {
  code: "",
  name: "",
  description: "",
  chargeCodeId: "",
  pricingMode: "PER_PERSON",
  cutoffHours: "24",
  isActive: true,
  rates: [{ adultPrice: "0", childPrice: "0", infantPrice: "0", flatPrice: "", effectiveFrom: "", effectiveTo: "" }],
}

export function ExcursionsManager({ title, description }: { title: string; description?: string }) {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [types, setTypes] = useState<ExcursionTypeDto[]>([])
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExcursionTypeDto | null>(null)
  const [deleting, setDeleting] = useState<ExcursionTypeDto | null>(null)
  const [schedulingFor, setSchedulingFor] = useState<ExcursionTypeDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<ExcursionTypeFormValues>({
    resolver: zodResolver(excursionTypeSchema),
    mode: "onChange",
    defaultValues: emptyValues,
  })
  const ratesArray = useFieldArray({ control: form.control, name: "rates" })
  const pricingMode = form.watch("pricingMode")

  const fetchTypes = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/excursions/types?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTypes(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchTypes()
    fetch("/api/charge-codes")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setChargeCodes(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (t: ExcursionTypeDto) => {
    setEditing(t)
    setServerError(null)
    form.reset({
      code: t.code,
      name: t.name,
      description: t.description ?? "",
      chargeCodeId: t.chargeCodeId,
      pricingMode: (t.pricingMode as ExcursionTypeFormValues["pricingMode"]) || "PER_PERSON",
      cutoffHours: String(t.cutoffHours),
      isActive: t.isActive,
      rates: t.rates.map((r) => ({
        adultPrice: String(r.adultPrice),
        childPrice: String(r.childPrice),
        infantPrice: String(r.infantPrice),
        flatPrice: r.flatPrice != null ? String(r.flatPrice) : "",
        effectiveFrom: r.effectiveFrom.slice(0, 10),
        effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : "",
      })),
    })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: ExcursionTypeFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = {
        ...values,
        propertyId,
        cutoffHours: parseInt(values.cutoffHours),
        rates: values.rates.map((r) => ({
          adultPrice: parseFloat(r.adultPrice),
          childPrice: parseFloat(r.childPrice),
          infantPrice: parseFloat(r.infantPrice),
          flatPrice: r.flatPrice !== "" ? parseFloat(r.flatPrice) : null,
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo || null,
        })),
      }
      const url = editing ? `/api/excursions/types/${editing.id}` : "/api/excursions/types"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchTypes()
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save excursion type")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/excursions/types/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to delete excursion type")
    } else {
      setServerError(null)
    }
    setDeleting(null)
    fetchTypes()
  }

  const currentPriceLabel = (t: ExcursionTypeDto) => {
    const today = new Date()
    const row = t.rates.find((r) => {
      const from = new Date(r.effectiveFrom)
      const to = r.effectiveTo ? new Date(r.effectiveTo) : null
      return from <= today && (!to || to >= today)
    })
    if (!row) return <span className="text-muted-foreground text-xs">No current price</span>
    if (t.pricingMode === "FLAT") return <span className="font-mono text-sm">${row.flatPrice}</span>
    return <span className="font-mono text-sm">A ${row.adultPrice} / C ${row.childPrice} / I ${row.infantPrice}</span>
  }

  // First-column (Code) sorting, asc<->desc.
  const { sorted: sortedTypes, sort } = useTableSort(types, { code: (t) => t.code }, "code")

  return (
    <div className="flex flex-col gap-4">
      <ControlsCard
        title={title}
        description={description}
        action={
          <Button onClick={openCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> New Excursion
          </Button>
        }
      >
          {serverError && !isDialogOpen && (
            <p className="text-sm text-destructive mb-3">{serverError}</p>
          )}
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : types.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No excursions yet"
              description="Create your first excursion — e.g. SNORK — Snorkelling Trip, adult $50 / child $25."
            />
          ) : (
            <div className="-mx-6 -mb-6 border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead columnKey="code" sort={sort}>Code</SortableTableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Charge Code</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>Schedules</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTypes.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono font-bold text-info">{t.code}</TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="font-mono text-xs">{t.chargeCode?.code}</TableCell>
                    <TableCell className="text-sm">{PRICING_MODE_LABELS[t.pricingMode] ?? t.pricingMode}</TableCell>
                    <TableCell>{currentPriceLabel(t)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.schedules.length} template{t.schedules.length === 1 ? "" : "s"}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge variant="outline" className="bg-success-muted text-success border-success/30">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => setSchedulingFor(t)}>
                        <CalendarClock className="h-4 w-4 mr-1.5" /> Schedule
                      </Button>
                      <Button variant="outline" size="icon" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(t)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
      </ControlsCard>

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Excursion" : "New Excursion"}</DialogTitle>
                <DialogDescription>
                  {editing ? "Modify this excursion's configuration and pricing." : "e.g. SNORK — Snorkelling Trip, adult $50 / child $25."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. SNORK" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Snorkelling Trip" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional guest-facing description" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="chargeCodeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Charge Code *</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Select charge code..."
                            options={chargeCodeOptions(chargeCodes, { buckets: ["OTHER", "TRANSPORT"] })}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cutoffHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cancellation Cutoff (hours) *</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" {...field} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">Hours before departure a booking can still be freely cancelled.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="pricingMode"
                  render={({ field }) => (
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
                  )}
                />

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
                      onClick={() =>
                        ratesArray.append({ adultPrice: "0", childPrice: "0", infantPrice: "0", flatPrice: "", effectiveFrom: "", effectiveTo: "" })
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add range
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {ratesArray.fields.map((row, idx) => (
                      <div
                        key={row.id}
                        className={pricingMode === "FLAT" ? "grid grid-cols-[1fr_1.2fr_1.2fr_auto] gap-2 items-start" : "grid grid-cols-[1fr_1fr_1fr_1.2fr_1.2fr_auto] gap-2 items-start"}
                      >
                        {pricingMode === "FLAT" ? (
                          <FormField
                            control={form.control}
                            name={`rates.${idx}.flatPrice`}
                            render={({ field }) => (
                              <FormItem>
                                {idx === 0 && <FormLabel className="text-xs">Flat $</FormLabel>}
                                <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ) : (
                          <>
                            <FormField
                              control={form.control}
                              name={`rates.${idx}.adultPrice`}
                              render={({ field }) => (
                                <FormItem>
                                  {idx === 0 && <FormLabel className="text-xs">Adult $</FormLabel>}
                                  <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`rates.${idx}.childPrice`}
                              render={({ field }) => (
                                <FormItem>
                                  {idx === 0 && <FormLabel className="text-xs">Child $</FormLabel>}
                                  <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`rates.${idx}.infantPrice`}
                              render={({ field }) => (
                                <FormItem>
                                  {idx === 0 && <FormLabel className="text-xs">Infant $</FormLabel>}
                                  <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </>
                        )}
                        <FormField
                          control={form.control}
                          name={`rates.${idx}.effectiveFrom`}
                          render={({ field }) => (
                            <FormItem>
                              {idx === 0 && <FormLabel className="text-xs">From *</FormLabel>}
                              <FormControl><DatePicker value={field.value} onChange={field.onChange} placeholder="Start" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rates.${idx}.effectiveTo`}
                          render={({ field }) => (
                            <FormItem>
                              {idx === 0 && <FormLabel className="text-xs">To</FormLabel>}
                              <FormControl><DatePicker value={field.value || null} onChange={field.onChange} placeholder="Open-ended" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
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

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Active — bookable from Front Office</FormLabel>
                    </FormItem>
                  )}
                />

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Excursion"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Excursion</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleting?.name}&quot; ({deleting?.code})? If it has any scheduled departures this will be
              blocked — deactivate instead to retire it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule management */}
      <Dialog open={!!schedulingFor} onOpenChange={(open) => { if (!open) { setSchedulingFor(null); fetchTypes() } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          {schedulingFor && (
            <ExcursionScheduleManager
              excursionType={schedulingFor}
              onChanged={() => {
                fetch(`/api/excursions/types?propertyId=${propertyId}`)
                  .then((r) => r.json())
                  .then((data) => {
                    if (Array.isArray(data)) {
                      setTypes(data)
                      setSchedulingFor(data.find((t: ExcursionTypeDto) => t.id === schedulingFor.id) ?? null)
                    }
                  })
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
