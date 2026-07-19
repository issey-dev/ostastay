"use client"

import { useState, useEffect } from "react"
import { Plus, Edit2, Trash2, UtensilsCrossed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useProperty } from "@/components/providers/property-provider"

type MealPlan = {
  id: string
  code: string
  name: string
  isActive: boolean
}

// Purely the LOV — which meal plan codes exist and their display name. Pricing a
// meal plan is done via a Derived Rate Plan (e.g. "BAR-BB" derived from "BAR"), not
// here; this list just populates the Reservation form's selector and tags a stay
// for kitchen/back-office visibility.
export function MealPlansManager() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [mealPlans, setMealPlans] = useState<MealPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ code: "", name: "", isActive: true })

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const openDialog = (mp?: MealPlan) => {
    if (mp) {
      setEditingId(mp.id)
      setFormData({ code: mp.code, name: mp.name, isActive: mp.isActive })
    } else {
      setEditingId(null)
      setFormData({ code: "", name: "", isActive: true })
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
        body: JSON.stringify({ ...formData, propertyId }),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchMealPlans()
      } else {
        const body = await res.json()
        alert(body.error || "Failed to save meal plan.")
      }
    } catch (e) {
      console.error(e)
      alert("An unexpected error occurred.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this meal plan?")) return
    try {
      await fetch(`/api/meal-plans/${id}`, { method: "DELETE" })
      fetchMealPlans()
    } catch (e) {
      console.error(e)
      alert("Failed to delete meal plan.")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-sm font-semibold text-foreground">Meal Plans</h4>
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="w-4 h-4 mr-2" /> Add Meal Plan
          </Button>
        </div>
        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>Code</TableHead>
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
                mealPlans.map(mp => (
                  <TableRow key={mp.id}>
                    <TableCell className="font-mono font-semibold">{mp.code}</TableCell>
                    <TableCell className="font-medium">{mp.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={mp.isActive ? "bg-success-muted text-success border-success/30" : "bg-muted text-muted-foreground"}>
                        {mp.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openDialog(mp)}>
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(mp.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
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
    </div>
  )
}
