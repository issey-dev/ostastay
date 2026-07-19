"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Pencil, Trash2, CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BulkPricingTool } from "@/components/revenue/bulk-pricing-tool"
import { FlashReport } from "@/components/revenue/flash-report"
import { useProperty } from "@/components/providers/property-provider"

type RatePlan = {
  id: string
  code: string
  name: string
  description?: string
  priority: number
  isNegotiated: boolean
  parentRatePlanId: string | null
  derivedAdjustmentType: string | null
  derivedAdjustmentValue: number | null
  parentRatePlan?: { id: string; name: string; code: string } | null
}

export default function RevenueDashboard() {
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([])
  const [loading, setLoading] = useState(true)
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
    parentRatePlanId: "",
    derivedAdjustmentType: "PERCENT",
    derivedAdjustmentValue: "",
  })

  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const fetchRatePlans = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/rate-plans?propertyId=${propertyId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRatePlans(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRatePlans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const resetForm = () => {
    setForm({
      code: "",
      name: "",
      description: "",
      priority: 10,
      isNegotiated: false,
      parentRatePlanId: "",
      derivedAdjustmentType: "PERCENT",
      derivedAdjustmentValue: "",
    })
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
      parentRatePlanId: plan.parentRatePlanId || "",
      derivedAdjustmentType: plan.derivedAdjustmentType || "PERCENT",
      derivedAdjustmentValue: plan.derivedAdjustmentValue != null ? plan.derivedAdjustmentValue.toString() : "",
    })
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
    } catch (err) {
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
    } catch (e) {
      setNotification({ title: "Error", message: "Failed to delete rate plan.", isError: true })
    }
  }

  const isEditMode = !!selectedPlan

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
          <TabsTrigger value="seasonal-pricing">Rate Details</TabsTrigger>
        </TabsList>

        <TabsContent value="flash-report" className="m-0">
          <FlashReport />
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
              <DialogContent className="sm:max-w-[500px]">
            <form onSubmit={handleCreateOrUpdate}>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Rate Plan" : "Create New Rate Plan"}</DialogTitle>
                <DialogDescription>
                  {isEditMode ? "Modify details for this rate plan." : "Enter the configuration for a new rate plan."}
                </DialogDescription>
              </DialogHeader>
              
              <div className="grid gap-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Rate Code <span className="text-destructive">*</span></Label>
                    <Input required placeholder="e.g. BAR" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Priority</Label>
                    <Input type="number" min="0" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: parseInt(e.target.value) || 0 }))} />
                    <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Plan Name <span className="text-destructive">*</span></Label>
                  <Input required placeholder="Best Available Rate" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>

                <div className="grid gap-2">
                  <Label>Description</Label>
                  <textarea 
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" 
                    placeholder="Enter details about this rate plan..."
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  />
                </div>

                <div className="grid gap-2 border rounded-lg p-4 bg-muted/30">
                  <Label>Derive from another Rate Plan <span className="text-muted-foreground font-normal">Optional</span></Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Instead of its own Price Calendar, this plan's price is computed live as the parent plan's price plus an adjustment — e.g. &quot;BAR-BB&quot; derived from &quot;BAR&quot; at +$20 flat.
                  </p>
                  <Select
                    value={form.parentRatePlanId || "__none__"}
                    onValueChange={(v) => setForm(p => ({ ...p, parentRatePlanId: v === "__none__" ? "" : (v ?? "") }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None — independent rate plan">
                        {form.parentRatePlanId
                          ? ratePlans.find(r => r.id === form.parentRatePlanId)?.name
                          : "None — independent rate plan"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None — independent rate plan</SelectItem>
                      {ratePlans
                        .filter(r => !r.parentRatePlanId && r.id !== selectedPlan?.id)
                        .map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

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

                <div className="flex items-center space-x-2 mt-2">
                  <Checkbox 
                    id="negotiated" 
                    checked={form.isNegotiated} 
                    onCheckedChange={(checked) => setForm(p => ({ ...p, isNegotiated: !!checked }))}
                  />
                  <Label htmlFor="negotiated" className="font-normal cursor-pointer">
                    This is a negotiated rate (Corporate/Wholesale)
                  </Label>
                </div>
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
              ) : ratePlans.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-10">No rate plans defined.</TableCell></TableRow>
              ) : (
                ratePlans.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <span className="font-bold text-lg bg-muted rounded-md px-2 py-1">{plan.priority}</span>
                    </TableCell>
                    <TableCell className="font-mono font-bold text-info">{plan.code}</TableCell>
                    <TableCell className="font-medium">{plan.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {plan.isNegotiated ? (
                          <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">Negotiated</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-success-muted text-success border-success/30">Public Rate</Badge>
                        )}
                        {plan.parentRatePlan && (
                          <Badge variant="outline" className="bg-info-muted text-info border-info/30">
                            ← {plan.parentRatePlan.code} {plan.derivedAdjustmentType === "FLAT"
                              ? `${(plan.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}$${plan.derivedAdjustmentValue}`
                              : `${(plan.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}${plan.derivedAdjustmentValue}%`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Link href={`/dashboard/revenue/calendar?ratePlanId=${plan.id}`}>
                        <Button variant="outline" size="sm">
                          <CalendarDays className="mr-2 h-3 w-3" /> Calendar
                        </Button>
                      </Link>
                      <Button variant="outline" size="icon" onClick={() => handleEdit(plan)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeletePrompt(plan)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
