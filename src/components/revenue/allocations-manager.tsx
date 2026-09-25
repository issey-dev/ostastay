"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import * as z from "zod"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { Plus, Pencil, Trash2, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
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
import { StatusBadge } from "@/components/ui/status-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { useConfirm } from "@/components/providers/confirm-provider"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

export type AllocationDto = {
  id: string
  code: string
  name: string
  type: string
  chargeCodeId: string
  chargeCode: { id: string; code: string; description: string }
  postingRhythm: string
  mode: string
  sellSeparate: boolean
  publishToApi: boolean
  isActive: boolean
  rates: Array<{
    id: string
    adultPrice: number
    childPrice: number
    effectiveFrom: string
    effectiveTo: string | null
  }>
}

type ChargeCodeOption = { id: string; code: string; description: string }

const TYPE_LABELS: Record<string, string> = {
  FNB: "F&B",
  TRANSFER: "Transfer",
  SPA: "Spa",
  EXCURSION: "Excursion",
  OTHER: "Other",
}

const RHYTHM_LABELS: Record<string, string> = {
  EVERY_NIGHT: "Every night",
  ARRIVAL_NIGHT: "On arrival night",
  DEPARTURE_NIGHT: "On departure night",
}

const MODE_LABELS: Record<string, string> = {
  INCLUDE_IN_RATE: "Include in rate",
  ADD_TO_RATE: "Add to rate",
}

const MODE_HINTS: Record<string, string> = {
  INCLUDE_IN_RATE:
    "When attached to a package rate, this allocation's value is carved out of the room rate — the guest total doesn't change, revenue is attributed to this allocation's charge code.",
  ADD_TO_RATE: "When attached to a package rate, this allocation posts on top of the room rate.",
}

const priceString = z
  .string()
  .min(1, "Required")
  .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Must be a number ≥ 0")

const rateRowSchema = z.object({
  adultPrice: priceString,
  childPrice: priceString,
  effectiveFrom: z.string().min(1, "Required"),
  effectiveTo: z.string().optional(),
})

const allocationSchema = z
  .object({
    code: z.string().min(2, "Code must be at least 2 characters").max(10),
    name: z.string().min(2, "Name must be at least 2 characters"),
    type: z.enum(["FNB", "TRANSFER", "SPA", "EXCURSION", "OTHER"]),
    chargeCodeId: z.string().min(1, "Charge code is required"),
    postingRhythm: z.enum(["EVERY_NIGHT", "ARRIVAL_NIGHT", "DEPARTURE_NIGHT"]),
    mode: z.enum(["INCLUDE_IN_RATE", "ADD_TO_RATE"]),
    sellSeparate: z.boolean(),
    isActive: z.boolean(),
    rates: z.array(rateRowSchema).min(1, "At least one price row is required"),
  })
  .superRefine((val, ctx) => {
    // Mirror the API's no-overlap rule inline so the user hears about it before
    // submitting (the API remains the authority).
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

type AllocationFormValues = z.infer<typeof allocationSchema>

const emptyValues: AllocationFormValues = {
  code: "",
  name: "",
  type: "FNB",
  chargeCodeId: "",
  postingRhythm: "EVERY_NIGHT",
  mode: "ADD_TO_RATE",
  sellSeparate: false,
  isActive: true,
  rates: [{ adultPrice: "0", childPrice: "0", effectiveFrom: "", effectiveTo: "" }],
}

export function AllocationsManager() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const confirm = useConfirm()

  const [allocations, setAllocations] = useState<AllocationDto[]>([])
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AllocationDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<AllocationFormValues>({
    resolver: zodResolver(allocationSchema),
    mode: "onChange",
    defaultValues: emptyValues,
  })
  const ratesArray = useFieldArray({ control: form.control, name: "rates" })

  const fetchAllocations = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/allocations?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllocations(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchAllocations()
    fetch(`/api/charge-codes?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setChargeCodes(data)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (a: AllocationDto) => {
    setEditing(a)
    setServerError(null)
    form.reset({
      code: a.code,
      name: a.name,
      type: (a.type as AllocationFormValues["type"]) || "OTHER",
      chargeCodeId: a.chargeCodeId,
      postingRhythm: (a.postingRhythm as AllocationFormValues["postingRhythm"]) || "EVERY_NIGHT",
      mode: (a.mode as AllocationFormValues["mode"]) || "ADD_TO_RATE",
      sellSeparate: a.sellSeparate,
      isActive: a.isActive,
      rates: a.rates.map((r) => ({
        adultPrice: String(r.adultPrice),
        childPrice: String(r.childPrice),
        effectiveFrom: r.effectiveFrom.slice(0, 10),
        effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : "",
      })),
    })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: AllocationFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = {
        ...values,
        propertyId,
        rates: values.rates.map((r) => ({
          adultPrice: parseFloat(r.adultPrice),
          childPrice: parseFloat(r.childPrice),
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo || null,
        })),
      }
      const url = editing ? `/api/allocations/${editing.id}` : "/api/allocations"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        toast.success("Allocation saved")
        fetchAllocations()
      } else {
        setServerError(await apiError(res, "Couldn't save the allocation. Try again."))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async (deleting: AllocationDto) => {
    const ok = await confirm({
      title: "Delete allocation?",
      description: `Delete "${deleting.name}" (${deleting.code})? If it is attached to any reservation this will be blocked — deactivate instead to retire it.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/allocations/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error(await apiError(res, "Couldn't delete the allocation. Try again."))
    } else {
      setServerError(null)
      toast.success("Allocation deleted")
    }
    fetchAllocations()
  }

  const currentPriceLabel = (a: AllocationDto) => {
    const today = new Date()
    const row = a.rates.find((r) => {
      const from = new Date(r.effectiveFrom)
      const to = r.effectiveTo ? new Date(r.effectiveTo) : null
      return from <= today && (!to || to >= today)
    })
    if (!row) return <span className="text-muted-foreground text-xs">No current price</span>
    return (
      <span className="font-mono text-sm">
        A ${row.adultPrice} / C ${row.childPrice}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm max-md:hidden">
          <Plus className="mr-2 h-4 w-4" /> Add allocation
        </Button>
        <DesktopOnlyNotice
          className="w-full"
          feature="Allocation editing"
          description="The list below is read-only on a phone. Open this page on a computer to create, edit or delete allocations."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Allocations
            <InfoHint label="Allocations">Per-person priced components — meals, transfers, spa, excursions — attachable to package rates and meal plans, or sold separately per reservation. Posted nightly by Night Audit according to each allocation&apos;s posting rhythm.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {serverError && !isDialogOpen && (
            <p className="text-sm text-destructive mb-3">{serverError}</p>
          )}
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : allocations.length === 0 ? (
            <EmptyState
              title="No allocations yet"
              description="Create your first allocation — e.g. BF (Breakfast) at adult $10 / child $5."
            />
          ) : (
            <>
              {/* Mobile card view — the table below takes over at md. */}
              <MobileCardList>
                {allocations.map((a) => (
                  <MobileCard
                    key={a.id}
                    title={a.name}
                    subtitle={<span className="font-mono font-bold text-info">{a.code}</span>}
                    tone={a.isActive ? undefined : "muted"}
                    badge={
                      <StatusBadge status={a.isActive ? "ACTIVE" : "INACTIVE"} label={a.isActive ? "Active" : "Inactive"} />
                    }
                    meta={[
                      { label: "Charge code", value: <span className="font-mono text-xs">{a.chargeCode?.code}</span> },
                      { label: "Rhythm", value: RHYTHM_LABELS[a.postingRhythm] ?? a.postingRhythm },
                      { label: "Current price", value: currentPriceLabel(a), wide: true },
                    ]}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                      <StatusBadge tone={a.mode === "INCLUDE_IN_RATE" ? "info" : "success"} label={MODE_LABELS[a.mode] ?? a.mode} />
                      {a.sellSeparate && (
                        <StatusBadge tone="warning" label="Sell separate" />
                      )}
                      {a.sellSeparate && a.publishToApi && (
                        <Badge variant="outline" title="Offered by the booking APIs — set in Hub → Website">
                          Online
                        </Badge>
                      )}
                    </div>
                  </MobileCard>
                ))}
              </MobileCardList>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Charge code</TableHead>
                      <TableHead>Rhythm</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Current price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono font-bold text-info">{a.code}</TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{TYPE_LABELS[a.type] ?? a.type}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.chargeCode?.code}</TableCell>
                        <TableCell className="text-sm">{RHYTHM_LABELS[a.postingRhythm] ?? a.postingRhythm}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge tone={a.mode === "INCLUDE_IN_RATE" ? "info" : "success"} label={MODE_LABELS[a.mode] ?? a.mode} />
                            {a.sellSeparate && (
                              <StatusBadge tone="warning" label="Sell separate" />
                            )}
                            {a.sellSeparate && a.publishToApi && (
                              <Badge variant="outline" title="Offered by the booking APIs — set in Hub → Website">
                                Online
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{currentPriceLabel(a)}</TableCell>
                        <TableCell>
                          <StatusBadge status={a.isActive ? "ACTIVE" : "INACTIVE"} label={a.isActive ? "Active" : "Inactive"} />
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button variant="outline" size="icon" aria-label="Edit allocation" onClick={() => openEdit(a)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Delete allocation"
                            className="text-destructive hover:text-destructive"
                            onClick={() => confirmDelete(a)}
                          >
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
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent size="lg">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit allocation" : "Add allocation"}</DialogTitle>
                <DialogDescription>
                  {editing
                    ? "Modify this allocation's configuration and pricing."
                    : "e.g. BF — Breakfast, F&B, adult $10 / child $5, every night."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. BF"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                          />
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
                          <Input placeholder="e.g. Breakfast" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue>{TYPE_LABELS[field.value]}</SelectValue>
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(TYPE_LABELS).map(([v, label]) => (
                              <SelectItem key={v} value={v}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="chargeCodeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Charge code *</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Select charge code..."
                            options={chargeCodeOptions(chargeCodes)}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          Internal revenue attribution — which charge code Night Audit posts this under.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="postingRhythm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Posting rhythm *</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>{RHYTHM_LABELS[field.value]}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(RHYTHM_LABELS).map(([v, label]) => (
                            <SelectItem key={v} value={v}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mode"
                  render={({ field }) => (
                    <FormItem className="border rounded-lg p-4 bg-muted/30">
                      <FormLabel>Rate behaviour *</FormLabel>
                      <p className="text-xs text-muted-foreground -mt-1">
                        How this allocation posts when it is part of a package rate.
                      </p>
                      <FormControl>
                        <div className="flex flex-col gap-2 mt-1" role="radiogroup">
                          {Object.entries(MODE_LABELS).map(([v, label]) => (
                            <label key={v} className="flex items-start gap-2 cursor-pointer">
                              <input
                                type="radio"
                                className="mt-1 accent-primary"
                                checked={field.value === v}
                                onChange={() => field.onChange(v)}
                              />
                              <span>
                                <span className="text-sm font-medium">{label}</span>
                                <span className="block text-xs text-muted-foreground">{MODE_HINTS[v]}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sellSeparate"
                  render={({ field }) => (
                    <FormItem className="border rounded-lg p-4 flex items-start justify-between gap-4">
                      <div>
                        <FormLabel className="cursor-pointer">Sell separately</FormLabel>
                        <p className="text-xs text-muted-foreground mt-1">
                          Independent of the rate behaviour above — when on, this allocation can also be
                          attached manually to any reservation (as an add-on), whether or not it is part
                          of a rate or meal plan.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <Label className="text-sm font-medium">Pricing (per person, per posting)</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Date ranges must not overlap. Leave the end date empty for an open-ended range.
                        Infants are never charged.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        ratesArray.append({ adultPrice: "0", childPrice: "0", effectiveFrom: "", effectiveTo: "" })
                      }
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add range
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {ratesArray.fields.map((row, idx) => (
                      <div key={row.id} className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] gap-2 items-start">
                        <FormField
                          control={form.control}
                          name={`rates.${idx}.adultPrice`}
                          render={({ field }) => (
                            <FormItem>
                              {idx === 0 && <FormLabel className="text-xs">Adult $</FormLabel>}
                              <FormControl>
                                <Input type="number" step="0.01" min="0" {...field} />
                              </FormControl>
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
                              <FormControl>
                                <Input type="number" step="0.01" min="0" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rates.${idx}.effectiveFrom`}
                          render={({ field }) => (
                            <FormItem>
                              {idx === 0 && <FormLabel className="text-xs">From *</FormLabel>}
                              <FormControl>
                                <DatePicker value={field.value} onChange={field.onChange} placeholder="Start" />
                              </FormControl>
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
                              <FormControl>
                                <DatePicker value={field.value || null} onChange={field.onChange} placeholder="Open-ended" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove rate"
                          className={`col-span-2 justify-self-end md:col-span-1 md:justify-self-auto ${idx === 0 ? "md:mt-6" : ""}`}
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
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">
                        Active — available for linking and reservations
                      </FormLabel>
                    </FormItem>
                  )}
                />

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton pending={submitting}>{editing ? "Save" : "Create"}</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
