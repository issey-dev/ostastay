"use client"

import { StatusBadge } from "@/components/ui/status-badge"
import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus, Edit2, Trash2, UtensilsCrossed } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/ui/submit-button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsCard } from "@/components/controls/controls-card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"
import { useConfirm } from "@/components/providers/confirm-provider"
import {
  emptyMealPlanForm,
  mealPlanFormSchema,
  readApiError,
  type MealPlanFormValues,
} from "@/lib/revenue-plan-schemas"

type MealPlan = {
  id: string
  code: string
  name: string
  isActive: boolean
  allocationLinks?: Array<{ allocation: { id: string; code: string; name: string; mode: string } }>
}

type AllocationOption = { id: string; code: string; name: string; mode: string; isActive: boolean }

// The meal plan codes a reservation can carry (Reservation.mealPlan stores the CODE as
// text, which is why the API freezes a used plan's code and refuses to delete it). A
// plan prices per person through its linked Allocations (BB → BF), which attach when
// the property's Allocation Calculation is set to Meal Plan level — see DECISIONS.md,
// "Allocations" and "Allocation Calculation mode". Derived Rate Plans only adjust the
// room rate; they are not how meal plans are priced.
//
// The Hub page is gated on CONTROLS but the meal-plan API needs REVENUE, so the server
// page passes in what this user may change and the actions are hidden otherwise.
export function MealPlansManager({
  propertyId,
  title,
  description,
  copyAction,
  permissions,
}: {
  propertyId: string
  title: string
  description?: string
  /** "Copy from…" another property, shown beside Add meal plan. */
  copyAction?: React.ReactNode
  /** The user's REVENUE rights — add / edit / delete are hidden without them. */
  permissions: { create: boolean; update: boolean; delete: boolean }
}) {
  const confirm = useConfirm()
  const hasActions = permissions.update || permissions.delete

  const [mealPlans, setMealPlans] = useState<MealPlan[]>([])
  const [allocations, setAllocations] = useState<AllocationOption[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<MealPlanFormValues>({
    resolver: zodResolver(mealPlanFormSchema),
    mode: "onChange",
    defaultValues: emptyMealPlanForm,
  })

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
    setServerError(null)
    if (mp) {
      setEditingId(mp.id)
      form.reset({
        code: mp.code,
        name: mp.name,
        isActive: mp.isActive,
        allocationIds: (mp.allocationLinks ?? []).map(l => l.allocation.id),
      })
    } else {
      setEditingId(null)
      form.reset(emptyMealPlanForm)
    }
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: MealPlanFormValues) => {
    setServerError(null)
    try {
      const url = editingId ? `/api/meal-plans/${editingId}` : "/api/meal-plans"
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, code: values.code.toUpperCase(), propertyId }),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        fetchMealPlans()
        toast.success(editingId ? "Meal plan updated." : "Meal plan added.")
      } else {
        setServerError(await readApiError(res, "Couldn't save the meal plan. Try again."))
      }
    } catch (e) {
      console.error(e)
      setServerError("An unexpected error occurred.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this meal plan?", confirmLabel: "Delete", destructive: true }))) return
    try {
      const res = await fetch(`/api/meal-plans/${id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error(await readApiError(res, "Couldn't delete the meal plan. Try again."))
        return
      }
      toast.success("Meal plan deleted.")
      fetchMealPlans()
    } catch (e) {
      console.error(e)
      toast.error("Couldn't delete the meal plan. Try again.")
    }
  }

  // First-column (Code) sorting, asc<->desc.
  const { sorted: sortedMealPlans, sort } = useTableSort(mealPlans, { code: (mp) => mp.code }, "code")
  const columnCount = hasActions ? 4 : 3

  return (
    <ControlsCard
      title={title}
      description={description}
      action={
        <div className="flex flex-wrap gap-2">
          {copyAction}
          {permissions.create && (
            <Button size="sm" onClick={() => openDialog()}>
              <Plus className="w-4 h-4 mr-2" /> Add meal plan
            </Button>
          )}
        </div>
      }
    >
      <div className="-mx-6 -mb-6 border-t border-border">
          {/* Phone view — one card per meal plan: code/name/status up top, included
              allocations as chips, then edit/delete as full-width/icon actions. */}
          <MobileCardList
            className="p-4"
            empty={<EmptyState icon={UtensilsCrossed} title="No meal plans configured" description="Add one (e.g. Bed & Breakfast) so it can be selected on a reservation." />}
          >
            {loading
              ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              : sortedMealPlans.map(mp => (
                  <MobileCard
                    key={mp.id}
                    tone={mp.isActive ? undefined : "muted"}
                    title={mp.name}
                    subtitle={<span className="font-mono">{mp.code}</span>}
                    badge={
                      <StatusBadge status={mp.isActive ? "ACTIVE" : "INACTIVE"} label={mp.isActive ? "Active" : "Inactive"} />
                    }
                    meta={
                      (mp.allocationLinks ?? []).length > 0
                        ? [{
                            label: "Allocations",
                            wide: true,
                            value: (
                              <span className="flex flex-wrap gap-1">
                                {(mp.allocationLinks ?? []).map(l => (
                                  <Badge key={l.allocation.id} variant="outline" className="font-mono text-xs">
                                    {l.allocation.code}
                                  </Badge>
                                ))}
                              </span>
                            ),
                          }]
                        : undefined
                    }
                    onClick={permissions.update ? () => openDialog(mp) : undefined}
                    actions={
                      hasActions ? (
                        <>
                          {permissions.update && (
                            <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openDialog(mp)}>
                              <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Edit
                            </Button>
                          )}
                          {permissions.delete && (
                            <Button
                              variant="outline" size="icon"
                              className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive-muted"
                              aria-label="Delete meal plan"
                              onClick={() => handleDelete(mp.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </>
                      ) : undefined
                    }
                  />
                ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <SortableTableHead columnKey="code" sort={sort}>Code</SortableTableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                {hasActions && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={columnCount}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : mealPlans.length === 0 ? (
                <TableRow><TableCell colSpan={columnCount} className="py-0">
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
                      <StatusBadge status={mp.isActive ? "ACTIVE" : "INACTIVE"} label={mp.isActive ? "Active" : "Inactive"} />
                    </TableCell>
                    {hasActions && (
                      <TableCell className="text-right">
                        {permissions.update && (
                          <Button variant="ghost" size="icon" aria-label="Edit meal plan" onClick={() => openDialog(mp)}>
                            <Edit2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        )}
                        {permissions.delete && (
                          <Button variant="ghost" size="icon" aria-label="Delete meal plan" onClick={() => handleDelete(mp.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit meal plan" : "Add meal plan"}</DialogTitle>
            <DialogDescription>Configure the details for this meal plan.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. BB, HB, FB, AI"
                        {...field}
                        onChange={e => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    {editingId && (
                      <FormDescription className="text-xs">
                        Reservations store this code, so it can&apos;t be changed once a reservation uses the plan.
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Bed & Breakfast" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allocationIds"
                render={({ field }) => (
                  <FormItem className="border rounded-lg p-3 bg-muted/30">
                    <FormLabel>Included allocations</FormLabel>
                    <FormDescription className="text-xs">
                      Selecting this meal plan on a reservation attaches these allocations (e.g. BB → BF) when
                      Allocation Calculation is set to Meal Plan level. Configure allocations under Revenue &gt; Allocations.
                    </FormDescription>
                    {linkableAllocations.length === 0 ? (
                      <EmptyState size="inline" title="No linkable allocations configured yet." />
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {linkableAllocations.map(a => (
                          <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={field.value.includes(a.id)}
                              onCheckedChange={(checked) =>
                                field.onChange(checked ? [...field.value, a.id] : field.value.filter(id => id !== a.id))
                              }
                            />
                            <span className="text-sm">
                              <span className="font-mono font-medium">{a.code}</span> — {a.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between pt-2">
                    <FormLabel className="flex-1">Active status</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {serverError && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              )}
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <SubmitButton pending={form.formState.isSubmitting}>{editingId ? "Save" : "Create"}</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </ControlsCard>
  )
}
