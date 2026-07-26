"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Plus, Pencil, Trash2, CalendarDays, Check, Lock } from "@/components/icons"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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

type ChargeCodeOption = { id: string; code: string; description: string; category: string }

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

  // Form State
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    priority: 10,
    isNegotiated: false,
    isComplimentary: false,
    isHouseUse: false,
    parentRatePlanId: "",
    derivedAdjustmentType: "PERCENT",
    derivedAdjustmentValue: "",
    chargeCodeId: "",
  })
  // Package contents — which allocations this rate plan carries.
  const [selectedAllocationIds, setSelectedAllocationIds] = useState<string[]>([])
  const [allocations, setAllocations] = useState<AllocationDto[]>([])
  // Charge codes (enterprise-wide) for the accommodation charge code selector.
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])

  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

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
    fetch(`/api/charge-codes`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setChargeCodes(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const resetForm = () => {
    setForm({
      code: "",
      name: "",
      description: "",
      priority: 10,
      isNegotiated: false,
      isComplimentary: false,
      isHouseUse: false,
      parentRatePlanId: "",
      derivedAdjustmentType: "PERCENT",
      derivedAdjustmentValue: "",
      chargeCodeId: "",
    })
    setSelectedAllocationIds([])
    setSelectedPlan(null)
  }

  const handleEdit = (plan: RatePlan) => {
    setSelectedPlan(plan)
    setForm({
      code: plan.code,
      name: plan.name,
      description: plan.description || "",
      priority: plan.priority,
      isNegotiated: plan.isNegotiated,
      isComplimentary: plan.isComplimentary,
      isHouseUse: plan.isHouseUse,
      parentRatePlanId: plan.parentRatePlanId || "",
      derivedAdjustmentType: plan.derivedAdjustmentType || "PERCENT",
      derivedAdjustmentValue: plan.derivedAdjustmentValue != null ? plan.derivedAdjustmentValue.toString() : "",
      chargeCodeId: plan.chargeCodeId || "",
    })
    setSelectedAllocationIds((plan.allocationLinks ?? []).map(l => l.allocation.id))
    setIsDialogOpen(true)
  }

  const handleDeletePrompt = (plan: RatePlan) => {
    setSelectedPlan(plan)
    setIsDeleteModalOpen(true)
  }

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const payload = {
        ...form,
        propertyId,
        parentRatePlanId: form.parentRatePlanId || null,
        derivedAdjustmentType: form.parentRatePlanId ? form.derivedAdjustmentType : null,
        derivedAdjustmentValue: form.parentRatePlanId && form.derivedAdjustmentValue !== "" ? parseFloat(form.derivedAdjustmentValue) : null,
        chargeCodeId: form.chargeCodeId || null,
        allocationIds: selectedAllocationIds,
      }

      const url = selectedPlan ? `/api/rate-plans/${selectedPlan.id}` : `/api/rate-plans`
      const method = selectedPlan ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setIsDialogOpen(false)
        resetForm()
        fetchRatePlans()
        setNotification({ title: "Success", message: "Rate plan saved successfully." })
      } else {
        const err = await res.json()
        setNotification({ title: "Error", message: `Failed to save: ${JSON.stringify(err)}`, isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An unexpected error occurred.", isError: true })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!selectedPlan) return
    try {
      await fetch(`/api/rate-plans/${selectedPlan.id}`, { method: "DELETE" })
      setIsDeleteModalOpen(false)
      fetchRatePlans()
      setNotification({ title: "Success", message: "Rate plan deleted successfully." })
    } catch {
      setNotification({ title: "Error", message: "Failed to delete rate plan.", isError: true })
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
          <h2 className="text-3xl font-bold tracking-tight">Revenue Management</h2>
          <p className="text-muted-foreground">
            Configure dynamic rate plans, priorities, and price calendars.
          </p>
        </div>
      </div>

      <Tabs defaultValue="rate-plans" className="w-full">
        <TabsList className="bg-muted/50 mb-6">
          <TabsTrigger value="flash-report">Manager Flash</TabsTrigger>
          <TabsTrigger value="rate-plans">Rate Plans</TabsTrigger>
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
          <TabsTrigger value="seasonal-pricing">Rate Details</TabsTrigger>
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
                <Button onClick={() => setIsDialogOpen(true)} className="shadow-sm">
                  <Plus className="mr-2 h-4 w-4" /> New Rate Plan
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleCreateOrUpdate}>
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

              <div className="grid sm:grid-cols-2 gap-6 py-4">
                {/* Left column — rate definition */}
                <div className="flex flex-col gap-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Rate Code <span className="text-destructive">*</span></Label>
                    <Input required disabled={isLockedPlan} placeholder="e.g. BAR" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Priority</Label>
                    <Input type="number" min="0" disabled={isLockedPlan} value={form.priority} onChange={e => setForm(p => ({ ...p, priority: parseInt(e.target.value) || 0 }))} />
                    <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Plan Name <span className="text-destructive">*</span></Label>
                  <Input required disabled={isLockedPlan} placeholder="Best Available Rate" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>

                <div className="grid gap-2">
                  <Label>Description</Label>
                  <textarea
                    disabled={isLockedPlan}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Enter details about this rate plan..."
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Accommodation Charge Code</Label>
                  <SearchableSelect
                    value={form.chargeCodeId}
                    onChange={(v) => setForm(p => ({ ...p, chargeCodeId: v }))}
                    placeholder="Enterprise default (Accommodation)"
                    options={[
                      { value: "", label: "Enterprise default (Accommodation)" },
                      ...chargeCodes
                        .filter(c => c.category === "ROOM")
                        .map(c => ({ label: `${c.code} — ${c.description}`, value: c.id })),
                    ]}
                  />
                  <p className="text-xs text-muted-foreground">
                    The code Night Audit posts this plan&apos;s nightly room charge against. Leave as
                    default to use the enterprise-wide accommodation code (Controls &gt; Finance).
                  </p>
                </div>

                {!isLockedPlan && (
                <div className="grid gap-2 border rounded-lg p-4 bg-muted/30">
                  <Label>Derive from another Rate Plan <span className="text-muted-foreground font-normal">Optional</span></Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Instead of its own Price Calendar, this plan&apos;s price is computed live as the parent plan&apos;s price plus an adjustment — e.g. &quot;BAR-BB&quot; derived from &quot;BAR&quot; at +$20 flat.
                  </p>
                  <SearchableSelect
                    value={form.parentRatePlanId}
                    onChange={(v) => setForm(p => ({ ...p, parentRatePlanId: v ?? "" }))}
                    placeholder="None — independent rate plan"
                    options={[
                      { value: "", label: "None — independent rate plan" },
                      ...ratePlans
                        .filter(r => !r.parentRatePlanId && r.id !== selectedPlan?.id && !r.isLocked)
                        .map(r => ({ value: r.id, label: `${r.name} (${r.code})` })),
                    ]}
                  />

                  {form.parentRatePlanId && (
                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div className="grid gap-2">
                        <Label className="text-xs">Adjustment Type</Label>
                        <Select value={form.derivedAdjustmentType} onValueChange={(v) => setForm(p => ({ ...p, derivedAdjustmentType: v ?? "PERCENT" }))}>
                          <SelectTrigger>
                            <SelectValue>{form.derivedAdjustmentType === "FLAT" ? "Flat Amount ($)" : "Percent (%)"}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PERCENT">Percent (%)</SelectItem>
                            <SelectItem value="FLAT">Flat Amount ($)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-xs">Adjustment Value</Label>
                        <Input
                          type="number"
                          step="0.01"
                          required
                          placeholder={form.derivedAdjustmentType === "FLAT" ? "e.g. 20 or -20" : "e.g. 10 or -10"}
                          value={form.derivedAdjustmentValue}
                          onChange={e => setForm(p => ({ ...p, derivedAdjustmentValue: e.target.value }))}
                        />
                      </div>
                    </div>
                  )}
                </div>
                )}

                <div className="flex flex-col gap-2 mt-auto">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="negotiated"
                      disabled={isLockedPlan}
                      checked={form.isNegotiated}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, isNegotiated: !!checked }))}
                    />
                    <Label htmlFor="negotiated" className="font-normal cursor-pointer">
                      This is a negotiated rate (Corporate/Wholesale)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="complimentary"
                      disabled={isLockedPlan}
                      checked={form.isComplimentary}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, isComplimentary: !!checked }))}
                    />
                    <Label htmlFor="complimentary" className="font-normal cursor-pointer">
                      Complimentary
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="houseUse"
                      disabled={isLockedPlan}
                      checked={form.isHouseUse}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, isHouseUse: !!checked }))}
                    />
                    <Label htmlFor="houseUse" className="font-normal cursor-pointer">
                      House Use
                    </Label>
                  </div>
                </div>
                </div>
                {/* End left column */}

                {/* Right column — package allocations chip picker */}
                <div className="flex flex-col gap-2 border rounded-lg p-4 bg-muted/30 min-h-[240px]">
                  <div className="flex items-center justify-between">
                    <Label>Package Allocations</Label>
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
                                      setSelectedAllocationIds(prev =>
                                        selected ? prev.filter(id => id !== a.id) : [...prev, a.id]
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

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Rate Plan"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rate Plan Hierarchy</CardTitle>
          <CardDescription>
            Defines the pricing waterfall. Lower priority numbers always win in a conflict.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10">Loading rate plans...</TableCell></TableRow>
              ) : loadError ? (
                <TableRow><TableCell colSpan={5} className="py-0"><ErrorState title="Couldn't load rate plans" onRetry={fetchRatePlans} /></TableCell></TableRow>
              ) : ratePlans.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-0"><EmptyState icon={CalendarDays} title="No rate plans defined" /></TableCell></TableRow>
              ) : (
                ratePlans.map((plan) => (
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
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Link href={`/e/${slug}/dashboard/revenue/calendar?ratePlanId=${plan.id}`}>
                        <Button variant="outline" size="sm">
                          <CalendarDays className="mr-2 h-3 w-3" /> Calendar
                        </Button>
                      </Link>
                      <Button variant="outline" size="icon" onClick={() => handleEdit(plan)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!plan.isLocked && (
                        <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeletePrompt(plan)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete Rate Plan</Button>
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
