"use client"

import { useState, useEffect } from "react"
import { Plus, Edit2, Trash2, UtensilsCrossed } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsCard } from "@/components/controls/controls-card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useProperty } from "@/components/providers/property-provider"
import { toast } from "@/lib/toast"
import { useConfirm } from "@/components/providers/confirm-provider"

type MealPlan = {
  id: string
  code: string
  name: string
  isActive: boolean
  allocationLinks?: Array<{ allocation: { id: string; code: string; name: string; mode: string } }>
}

type AllocationOption = { id: string; code: string; name: string; mode: string; isActive: boolean }

// Purely the LOV — which meal plan codes exist and their display name. Pricing a
// meal plan is done via a Derived Rate Plan (e.g. "BAR-BB" derived from "BAR"), not
// here; this list just populates the Reservation form's selector and tags a stay
// for kitchen/back-office visibility.
export function MealPlansManager({ title, description }: { title: string; description?: string }) {
  const { currentProperty } = useProperty()
  const confirm = useConfirm()
  const propertyId = currentProperty?.id ?? ""

  const [mealPlans, setMealPlans] = useState<MealPlan[]>([])
  const [allocations, setAllocations] = useState<AllocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ code: "", name: "", isActive: true })
  const [selectedAllocationIds, setSelectedAllocationIds] = useState<string[]>([])

  const fetchMealPlans = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/meal-plans?propertyId=${propertyId}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setMealPlans(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchMealPlans()
    if (propertyId) {
      fetch(`/api/allocations?propertyId=${propertyId}`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setAllocations(data) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const linkableAllocations = allocations.filter(a => a.isActive)

  const openDialog = (mp?: MealPlan) => {
    if (mp) {
      setEditingId(mp.id)
      setFormData({ code: mp.code, name: mp.name, isActive: mp.isActive })
      setSelectedAllocationIds((mp.allocationLinks ?? []).map(l => l.allocation.id))
    } else {
      setEditingId(null)
      setFormData({ code: "", name: "", isActive: true })
      setSelectedAllocationIds([])
    }
    setIsDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = editingId ? `/api/meal-plans/${editingId}` : "/api/meal-plans"
      const method = editingId ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, propertyId, allocationIds: selectedAllocationIds }),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchMealPlans()
      } else {
        const body = await res.json()
        toast.error(body.error || "Failed to save meal plan.")
      }
    } catch (e) {
      console.error(e)
      toast.error("An unexpected error occurred.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this meal plan?", confirmLabel: "Delete", destructive: true }))) return
    try {
      await fetch(`/api/meal-plans/${id}`, { method: "DELETE" })
      fetchMealPlans()
    } catch (e) {
      console.error(e)
      toast.error("Failed to delete meal plan.")
    }
  }

  // First-column (Code) sorting, asc<->desc.
  const { sorted: sortedMealPlans, sort } = useTableSort(mealPlans, { code: (mp) => mp.code }, "code")

  return (
    <ControlsCard
      title={title}
      description={description}
      action={
        <Button size="sm" onClick={() => openDialog()}>
          <Plus className="w-4 h-4 mr-2" /> Add Meal Plan
        </Button>
      }
    >
      <div className="-mx-6 -mb-6 border-t border-border">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <SortableTableHead columnKey="code" sort={sort}>Code</SortableTableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : mealPlans.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="py-0">
                  <EmptyState icon={UtensilsCrossed} title="No meal plans configured" description="Add one (e.g. Bed & Breakfast) so it can be selected on a reservation." />
                </TableCell></TableRow>
              ) : (
                sortedMealPlans.map(mp => (
                  <TableRow key={mp.id}>
                    <TableCell className="font-mono font-semibold">{mp.code}</TableCell>
                    <TableCell className="font-medium">
                      {mp.name}
                      {(mp.allocationLinks ?? []).length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {(mp.allocationLinks ?? []).map(l => (
                            <Badge key={l.allocation.id} variant="outline" className="font-mono text-xs">
                              {l.allocation.code}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={mp.isActive ? "bg-success-muted text-success border-success/30" : "bg-muted text-muted-foreground"}>
                        {mp.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" aria-label="Edit meal plan" onClick={() => openDialog(mp)}>
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Delete meal plan" onClick={() => handleDelete(mp.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Meal Plan" : "Add Meal Plan"}</DialogTitle>
            <DialogDescription>Configure the details for this meal plan.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Code <span className="text-destructive">*</span></Label>
              <Input required placeholder="e.g. BB, HB, FB, AI" value={formData.code} onChange={e => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
            </div>
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input required placeholder="e.g. Bed & Breakfast" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
              <Label>Included Allocations</Label>
              <p className="text-xs text-muted-foreground">
                Selecting this meal plan on a reservation attaches these allocations (e.g. BB → BF).
                Configure allocations under Revenue &gt; Allocations.
              </p>
              {linkableAllocations.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No linkable allocations configured yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {linkableAllocations.map(a => (
                    <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={selectedAllocationIds.includes(a.id)}
                        onCheckedChange={(checked) =>
                          setSelectedAllocationIds(prev =>
                            checked ? [...prev, a.id] : prev.filter(id => id !== a.id)
                          )
                        }
                      />
                      <span className="text-sm">
                        <span className="font-mono font-medium">{a.code}</span> — {a.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="flex-1">Active Status</Label>
              <Switch checked={formData.isActive} onCheckedChange={v => setFormData(p => ({ ...p, isActive: v }))} />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ControlsCard>
  )
}
