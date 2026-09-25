"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, Pencil, Trash2, Sparkles } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { StatusBadge } from "@/components/ui/status-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { useConfirm } from "@/components/providers/confirm-provider"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"

export type SpaTreatmentCategoryDto = {
  id: string
  name: string
  description: string | null
  displayOrder: number
  isActive: boolean
}

const categorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().optional(),
  displayOrder: z.string().refine((v) => !isNaN(parseInt(v)), "Must be a number"),
  isActive: z.boolean(),
})

type CategoryFormValues = z.infer<typeof categorySchema>

const emptyValues: CategoryFormValues = { name: "", description: "", displayOrder: "0", isActive: true }

// Fires whenever the category list changes (create/edit/delete) so the sibling
// SpaTreatmentsManager (which needs the current category list for its own dropdown)
// can refetch — the two managers don't share React state, only this callback.
export function SpaCategoriesManager({ propertyId, onChanged }: { propertyId: string; onChanged?: () => void }) {
  const confirm = useConfirm()
  const [categories, setCategories] = useState<SpaTreatmentCategoryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SpaTreatmentCategoryDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<CategoryFormValues>({ resolver: zodResolver(categorySchema), mode: "onChange", defaultValues: emptyValues })

  const fetchCategories = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/spa/treatment-categories?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCategories(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (c: SpaTreatmentCategoryDto) => {
    setEditing(c)
    setServerError(null)
    form.reset({ name: c.name, description: c.description ?? "", displayOrder: String(c.displayOrder), isActive: c.isActive })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: CategoryFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = { ...values, propertyId, displayOrder: parseInt(values.displayOrder) }
      const url = editing ? `/api/spa/treatment-categories/${editing.id}` : "/api/spa/treatment-categories"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        toast.success("Category saved")
        fetchCategories()
        onChanged?.()
      } else {
        setServerError(await apiError(res, "Couldn't save the category. Try again."))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async (deleting: SpaTreatmentCategoryDto) => {
    const ok = await confirm({
      title: "Delete category?",
      description: `Delete "${deleting.name}"? If it has any treatments assigned this will be blocked — deactivate instead.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/spa/treatment-categories/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error(await apiError(res, "Couldn't delete the category. Try again."))
    } else {
      setServerError(null)
      toast.success("Category deleted")
      onChanged?.()
    }
    fetchCategories()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm">
          <Plus className="mr-2 h-4 w-4" /> Add category
        </Button>
      </div>

      {serverError && !isDialogOpen && <p className="text-sm text-destructive">{serverError}</p>}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : categories.length === 0 ? (
        <EmptyState icon={Sparkles} title="No treatment categories yet" description="e.g. Massage, Facial, Body Treatment, Manicure & Pedicure." />
      ) : (
        <>
          {/* Phone view — the table below takes over at md. */}
          <MobileCardList>
            {categories.map((c) => (
              <MobileCard
                key={c.id}
                title={c.name}
                subtitle={c.description || undefined}
                tone={c.isActive ? undefined : "muted"}
                badge={
                  <StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} label={c.isActive ? "Active" : "Inactive"} />
                }
                meta={[{ label: "Order", value: c.displayOrder }]}
                onClick={() => openEdit(c)}
                actions={
                  <>
                    <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive hover:text-destructive" onClick={() => confirmDelete(c)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                    </Button>
                  </>
                }
              />
            ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.description || "—"}</TableCell>
                    <TableCell className="text-sm">{c.displayOrder}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.isActive ? "ACTIVE" : "INACTIVE"} label={c.isActive ? "Active" : "Inactive"} />
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="icon" aria-label="Edit category" onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Delete category" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(c)}>
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent size="sm">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit category" : "Add category"}</DialogTitle>
                <DialogDescription>Groups treatments for display — e.g. Massage, Facial, Body Treatment.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Massage" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="displayOrder" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display order</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0 font-normal cursor-pointer">Active</FormLabel>
                  </FormItem>
                )} />
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <SubmitButton pending={submitting}>{editing ? "Save" : "Create"}</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
