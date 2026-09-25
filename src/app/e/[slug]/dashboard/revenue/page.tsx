"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useParams } from "next/navigation"
import Link from "next/link"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { Plus, Pencil, Trash2, CalendarDays, Check, Lock } from "@/components/icons"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ErrorState } from "@/components/ui/error-state"
import { BulkPricingTool } from "@/components/revenue/bulk-pricing-tool"
import { FlashReport } from "@/components/revenue/flash-report"
import { AllocationsManager, type AllocationDto } from "@/components/revenue/allocations-manager"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { DesktopOnlyNotice } from "@/components/ui/mobile"
import {
  emptyRatePlanForm,
  ratePlanFormSchema,
  ratePlanPayload,
  readApiError,
  type RatePlanFormValues,
} from "@/lib/revenue-plan-schemas"

const ALLOCATION_TYPE_LABELS: Record<string, string> = {
  FNB: "Food & Beverage",
  TRANSFER: "Transfers",
  SPA: "Spa",
  EXCURSION: "Excursions",
  OTHER: "Other",
}

type RatePlan = {
  id: string
  code: string
  name: string
  description?: string
  priority: number
  isNegotiated: boolean
  isComplimentary: boolean
  isHouseUse: boolean
  isLocked: boolean
  parentRatePlanId: string | null
  derivedAdjustmentType: string | null
  derivedAdjustmentValue: number | null
  parentRatePlan?: { id: string; name: string; code: string } | null
  chargeCodeId: string | null
  chargeCode?: { id: string; code: string; description: string } | null
  allocationLinks?: Array<{ allocation: { id: string; code: string; name: string; mode: string } }>
  negotiatedForProfileIds?: string[]
}

type ChargeCodeOption = {
  id: string
  code: string
  description: string
  isActive?: boolean
  chargeSubgroup?: { chargeGroup?: { reportBucket?: string } | null } | null
}

export default function RevenueDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Modals state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<RatePlan | null>(null)
  
  // Custom Notification State
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  // Form State — Zod + React Hook Form (APP STANDARD 001).
  const form = useForm<RatePlanFormValues>({
    resolver: zodResolver(ratePlanFormSchema),
    mode: "onChange",
    defaultValues: emptyRatePlanForm,
  })
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const parentRatePlanId = form.watch("parentRatePlanId")
  const derivedAdjustmentType = form.watch("derivedAdjustmentType")
  const selectedAllocationIds = form.watch("allocationIds")
  const [allocations, setAllocations] = useState<AllocationDto[]>([])
  // Charge codes (enterprise-wide) for the accommodation charge code selector.
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])

  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  // Desktop opens on Rate Plans, as it always has. A phone opens on Manager Flash — the
  // one tab that is read on the go — chosen after mount, so the server render (and every
  // desktop) keeps the Rate Plans default.
  const [tab, setTab] = useState("rate-plans")
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setTab("flash-report")
  }, [])

  const fetchRatePlans = () => {
    if (!propertyId) return
    setLoading(true)
    setLoadError(false)
    fetch(`/api/rate-plans?propertyId=${propertyId}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) setRatePlans(data)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  const fetchAllocations = () => {
    if (!propertyId) return
    fetch(`/api/allocations?propertyId=${propertyId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setAllocations(data)
      })
  }

  useEffect(() => {
    fetchRatePlans()
    fetchAllocations()
    fetch(`/api/charge-codes?propertyId=${propertyId}`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setChargeCodes(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const resetForm = () => {
    form.reset(emptyRatePlanForm)
    setServerError(null)
    setSelectedPlan(null)
  }

  const handleEdit = (plan: RatePlan) => {
    setSelectedPlan(plan)
    setServerError(null)
    form.reset({
      isLocked: plan.isLocked,
      code: plan.code,
      name: plan.name,
      description: plan.description || "",
      priority: String(plan.priority),
      isNegotiated: plan.isNegotiated,
      isComplimentary: plan.isComplimentary,
      isHouseUse: plan.isHouseUse,
      parentRatePlanId: plan.parentRatePlanId || "",
      derivedAdjustmentType: plan.derivedAdjustmentType === "FLAT" ? "FLAT" : "PERCENT",
      derivedAdjustmentValue: plan.derivedAdjustmentValue != null ? plan.derivedAdjustmentValue.toString() : "",
      chargeCodeId: plan.chargeCodeId || "",
      allocationIds: (plan.allocationLinks ?? []).map(l => l.allocation.id),
    })
    setIsDialogOpen(true)
  }

  const handleDeletePrompt = (plan: RatePlan) => {
    setSelectedPlan(plan)
    setDeleteError(null)
    setIsDeleteModalOpen(true)
  }

  const onSubmit = async (values: RatePlanFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const url = selectedPlan ? `/api/rate-plans/${selectedPlan.id}` : `/api/rate-plans`
      const res = await fetch(url, {
        method: selectedPlan ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ratePlanPayload(values, propertyId)),
      })

      if (res.ok) {
        setIsDialogOpen(false)
        resetForm()
        fetchRatePlans()
        setNotification({ title: "Success", message: "Rate plan saved successfully." })
      } else {
        // Shown inside the dialog so the user can fix the field and retry.
        setServerError(await readApiError(res, "Failed to save the rate plan."))
      }
    } catch {
      setServerError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!selectedPlan) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/rate-plans/${selectedPlan.id}`, { method: "DELETE" })
      if (!res.ok) {
        // e.g. 409 — reservations are priced on this plan. Keep the dialog open with the reason.
        setDeleteError(await readApiError(res, "Failed to delete the rate plan."))
        return
      }
      setIsDeleteModalOpen(false)
      fetchRatePlans()
      setNotification({ title: "Success", message: "Rate plan deleted successfully." })
    } catch {
      setDeleteError("Failed to delete the rate plan.")
    } finally {
      setDeleting(false)
    }
  }

  const isEditMode = !!selectedPlan
  // The property's system-provisioned Base Rate (see RatePlan.isLocked) can't have its
  // own identity fields edited or be deleted — only Package Allocations stay live.
  const isLockedPlan = !!selectedPlan?.isLocked

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Revenue Management
            <InfoHint label="Revenue Management">Configure dynamic rate plans, priorities, and price calendars.</InfoHint>
          </h2>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="w-full">
        {/* 2x2 on a phone, one row from md up — four triggers at whitespace-nowrap width
            overflow a 375px screen if forced into a single row (see the same fix on
            front-office's operations tabs). */}
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/50 mb-6 data-horizontal:h-auto md:flex md:h-8 md:w-fit md:gap-0 md:data-horizontal:h-8">
          <TabsTrigger value="flash-report">Manager Flash</TabsTrigger>
          <TabsTrigger value="rate-plans">Rate Plans</TabsTrigger>
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
          <TabsTrigger value="seasonal-pricing">Rate Seasons</TabsTrigger>
        </TabsList>

        <TabsContent value="flash-report" className="m-0">
          <FlashReport />
        </TabsContent>

        <TabsContent value="allocations" className="m-0">
          <AllocationsManager />
        </TabsContent>

        <TabsContent value="rate-plans" className="m-0">
          <div className="flex justify-end mb-4">
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open)
              if (!open) resetForm()
            }}>
              <DialogTrigger asChild>
                <Button onClick={() => setIsDialogOpen(true)} className="shadow-sm max-md:hidden">
                  <Plus className="mr-2 h-4 w-4" /> New Rate Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
            <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {isEditMode ? "Edit Rate Plan" : "Create New Rate Plan"}
                  {isLockedPlan && (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <Lock className="h-3 w-3" /> Locked
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {isLockedPlan
                    ? "This is the property's Base Rate — its code, name, priority, and pricing rules are fixed and it can't be deleted. You can still add Package Allocations."
                    : isEditMode ? "Modify details for this rate plan." : "Enter the configuration for a new rate plan."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 gap-6 py-4 md:grid-cols-2">
                {/* Left column — rate definition */}
                <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rate Code <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. BAR"
                            {...field}
                            disabled={isLockedPlan}
                            onChange={e => field.onChange(e.target.value.toUpperCase())}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="1" {...field} disabled={isLockedPlan} />
                        </FormControl>
                        <FormDescription className="text-xs">Lower number = higher priority</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plan Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input placeholder="Best Available Rate" {...field} disabled={isLockedPlan} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <textarea
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="Enter details about this rate plan..."
                          {...field}
                          disabled={isLockedPlan}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="chargeCodeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Accommodation Charge Code</FormLabel>
                      <SearchableSelect
                        value={field.value}
                        onChange={(v) => field.onChange(v ?? "")}
                        placeholder="Enterprise default (Accommodation)"
                        options={[
                          { value: "", label: "Enterprise default (Accommodation)" },
                          // Classification comes from the hierarchy now, not the deprecated
                          // `category` string — see src/lib/charge-code-options.ts.
                          ...chargeCodeOptions(chargeCodes, { buckets: ["ROOM"] }),
                        ]}
                      />
                      <FormDescription className="text-xs">
                        The code Night Audit posts this plan&apos;s nightly room charge against. Leave as
                        default to use the enterprise-wide accommodation code (Hub › Charge Codes).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!isLockedPlan && (
                <div className="grid gap-2 border rounded-lg p-4 bg-muted/30">
                  <FormField
                    control={form.control}
                    name="parentRatePlanId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Derive from another Rate Plan <span className="text-muted-foreground font-normal">Optional</span></FormLabel>
                        <FormDescription className="text-xs mb-1">
                          Instead of its own Price Calendar, this plan&apos;s price is computed live as the parent plan&apos;s price plus an adjustment — e.g. &quot;BAR-BB&quot; derived from &quot;BAR&quot; at +$20 flat.
                        </FormDescription>
                        <SearchableSelect
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? "")}
                          placeholder="None — independent rate plan"
                          options={[
                            { value: "", label: "None — independent rate plan" },
                            ...ratePlans
                              .filter(r => !r.parentRatePlanId && r.id !== selectedPlan?.id && !r.isLocked)
                              .map(r => ({ value: r.id, label: `${r.name} (${r.code})` })),
                          ]}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {parentRatePlanId && (
                    <div className="grid grid-cols-1 gap-4 mt-3 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="derivedAdjustmentType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Adjustment Type</FormLabel>
                            <Select value={field.value} onValueChange={(v) => field.onChange(v === "FLAT" ? "FLAT" : "PERCENT")}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue>{field.value === "FLAT" ? "Flat Amount ($)" : "Percent (%)"}</SelectValue>
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="PERCENT">Percent (%)</SelectItem>
                                <SelectItem value="FLAT">Flat Amount ($)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="derivedAdjustmentValue"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Adjustment Value</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder={derivedAdjustmentType === "FLAT" ? "e.g. 20 or -20" : "e.g. 10 or -10"}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
                )}

                <div className="flex flex-col gap-2 mt-auto">
                  <FormField
                    control={form.control}
                    name="isNegotiated"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            id="negotiated"
                            disabled={isLockedPlan}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(!!checked)}
                          />
                        </FormControl>
                        <FormLabel htmlFor="negotiated" className="font-normal cursor-pointer">
                          This is a negotiated rate (Corporate/Wholesale)
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isComplimentary"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            id="complimentary"
                            disabled={isLockedPlan}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(!!checked)}
                          />
                        </FormControl>
                        <FormLabel htmlFor="complimentary" className="font-normal cursor-pointer">
                          Complimentary
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isHouseUse"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            id="houseUse"
                            disabled={isLockedPlan}
                            checked={field.value}
                            onCheckedChange={(checked) => field.onChange(!!checked)}
                          />
                        </FormControl>
                        <FormLabel htmlFor="houseUse" className="font-normal cursor-pointer">
                          House Use
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                </div>
                {/* End left column */}

                {/* Right column — package allocations chip picker */}
                <div className="flex flex-col gap-2 border rounded-lg p-4 bg-muted/30 min-h-[240px]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Package Allocations</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedAllocationIds.length} selected
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Components this rate carries. Tap to include; each allocation&apos;s own mode
                    (included in / added to rate) decides how it posts. Manage them on the Allocations tab.
                  </p>
                  {(() => {
                    const linkable = allocations.filter(a => a.isActive)
                    if (linkable.length === 0) {
                      return <p className="text-xs text-muted-foreground italic">No allocations configured yet.</p>
                    }
                    const grouped = linkable.reduce((acc, a) => {
                      (acc[a.type] ||= []).push(a)
                      return acc
                    }, {} as Record<string, AllocationDto[]>)
                    return (
                      <div className="flex flex-col gap-4">
                        {Object.entries(grouped).map(([type, items]) => (
                          <div key={type}>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                              {ALLOCATION_TYPE_LABELS[type] ?? type}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {items.map(a => {
                                const selected = selectedAllocationIds.includes(a.id)
                                return (
                                  <button
                                    type="button"
                                    key={a.id}
                                    onClick={() =>
                                      form.setValue(
                                        "allocationIds",
                                        selected ? selectedAllocationIds.filter(id => id !== a.id) : [...selectedAllocationIds, a.id],
                                        { shouldDirty: true, shouldValidate: true }
                                      )
                                    }
                                    title={a.mode === "INCLUDE_IN_RATE" ? "Included in rate" : "Added to rate"}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                                      selected
                                        ? "border-primary text-primary bg-primary/5 font-medium"
                                        : "border-border text-muted-foreground hover:border-foreground/40"
                                    )}
                                  >
                                    {selected && <Check className="h-3.5 w-3.5" />}
                                    <span className="font-mono">{a.code}</span>
                                    <span>{a.name}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
                {/* End right column */}
              </div>

              {serverError && (
                <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Rate Plan"}</Button>
              </DialogFooter>
            </form>
            </Form>
          </DialogContent>
        </Dialog>
        <DesktopOnlyNotice
          className="w-full"
          feature="Rate plan editing"
          description="The list below is read-only on a phone. Open this page on a computer to create, edit or delete rate plans."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Rate Plan Hierarchy
            <InfoHint label="Rate Plan Hierarchy">Defines the pricing waterfall. Lower priority numbers always win in a conflict.</InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(() => {
            const typeBadges = (plan: RatePlan) => (
              <div className="flex flex-wrap gap-1.5">
                {plan.isLocked ? (
                  <Badge variant="outline" className="text-muted-foreground">Base Rate</Badge>
                ) : plan.isNegotiated ? (
                  <>
                    <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">Negotiated</Badge>
                    {(plan.negotiatedForProfileIds?.length ?? 0) === 0 ? (
                      <Badge variant="outline" className="bg-destructive-muted text-destructive border-destructive/30">No agents linked</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        {plan.negotiatedForProfileIds?.length} agent{plan.negotiatedForProfileIds?.length === 1 ? "" : "s"} linked
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge variant="outline" className="bg-success-muted text-success border-success/30">Public Rate</Badge>
                )}
                {plan.isComplimentary && (
                  <Badge variant="outline" className="bg-info-muted text-info border-info/30">Complimentary</Badge>
                )}
                {plan.isHouseUse && (
                  <Badge variant="outline" className="text-muted-foreground">House Use</Badge>
                )}
                {plan.parentRatePlan && (
                  <Badge variant="outline" className="bg-info-muted text-info border-info/30">
                    ← {plan.parentRatePlan.code} {plan.derivedAdjustmentType === "FLAT"
                      ? `${(plan.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}$${plan.derivedAdjustmentValue}`
                      : `${(plan.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}${plan.derivedAdjustmentValue}%`}
                  </Badge>
                )}
                {(plan.allocationLinks ?? []).map(l => (
                  <Badge key={l.allocation.id} variant="outline" className="font-mono text-xs">
                    {l.allocation.code}
                  </Badge>
                ))}
              </div>
            )

            if (loading) {
              return <p className="py-10 text-center text-sm text-muted-foreground">Loading rate plans...</p>
            }
            if (loadError) {
              return <ErrorState title="Couldn't load rate plans" onRetry={fetchRatePlans} />
            }
            if (ratePlans.length === 0) {
              return <EmptyState icon={CalendarDays} title="No rate plans defined" />
            }

            return (
              <>
                {/* Mobile: card-per-row — a 5-column table is unreadable under ~500px. */}
                <div className="space-y-3 p-4 md:hidden">
                  {ratePlans.map((plan) => (
                    <div key={plan.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-mono font-bold text-info">
                            {plan.isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                            {plan.code}
                          </div>
                          <div className="truncate font-medium text-foreground">{plan.name}</div>
                        </div>
                        <span className="shrink-0 font-bold text-lg bg-muted rounded-md px-2 py-1">{plan.priority}</span>
                      </div>
                      {typeBadges(plan)}
                      {/* Phones: read-only — editing is desktop-only (see the notice above). */}
                      <Link href={`/e/${slug}/dashboard/revenue/calendar?ratePlanId=${plan.id}`} className="block pt-1">
                        <Button variant="outline" size="sm" className="h-9 w-full">
                          <CalendarDays className="mr-2 h-3.5 w-3.5" /> Price calendar
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>

                {/* Tablet/desktop: real table. */}
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Priority</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Plan Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ratePlans.map((plan) => (
                        <TableRow key={plan.id}>
                          <TableCell>
                            <span className="font-bold text-lg bg-muted rounded-md px-2 py-1">{plan.priority}</span>
                          </TableCell>
                          <TableCell className="font-mono font-bold text-info">
                            <span className="inline-flex items-center gap-1.5">
                              {plan.isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                              {plan.code}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium">{plan.name}</TableCell>
                          <TableCell>{typeBadges(plan)}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Link href={`/e/${slug}/dashboard/revenue/calendar?ratePlanId=${plan.id}`}>
                              <Button variant="outline" size="sm">
                                <CalendarDays className="mr-2 h-3 w-3" /> Calendar
                              </Button>
                            </Link>
                            <Button variant="outline" size="icon" aria-label="Edit rate plan" onClick={() => handleEdit(plan)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!plan.isLocked && (
                              <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" aria-label="Delete rate plan" onClick={() => handleDeletePrompt(plan)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )
          })()}
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Rate Plan</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the rate plan &quot;{selectedPlan?.name}&quot;? This action cannot be undone and will permanently remove all associated price calendars.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? "Deleting..." : "Delete Rate Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </TabsContent>

      <TabsContent value="seasonal-pricing" className="m-0">
        <BulkPricingTool propertyId={propertyId} />
      </TabsContent>
    </Tabs>

      {/* Notification Modal */}
      <Dialog open={!!notification} onOpenChange={(open) => { if (!open) setNotification(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : "text-success"}>
              {notification?.title}
            </DialogTitle>
            <DialogDescription className="text-base text-foreground mt-2">
              {notification?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
