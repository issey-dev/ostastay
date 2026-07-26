"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Pencil, Trash2, Store } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { OutletChargeCodePicker, type ChargeCodeOption } from "@/components/controls/outlet-charge-code-picker"
import { toast } from "@/lib/toast"

const OUTLET_TYPES = [
  { value: "SPA", label: "Spa" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "BAR", label: "Bar" },
  { value: "RETAIL", label: "Retail" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "RECREATION", label: "Recreation" },
  { value: "OTHER", label: "Other" },
]
const OUTLET_TYPE_LABELS: Record<string, string> = Object.fromEntries(OUTLET_TYPES.map((t) => [t.value, t.label]))

type PropertyOption = { id: string; name: string }
type TaxProfileOption = { id: string; name: string }

const BLANK_FORM = () => ({
  name: "",
  description: "",
  outletType: "OTHER",
  isActive: true,
  taxOverrideMode: "NONE" as "NONE" | "DEFAULT_ENGINE" | "CUSTOM",
  taxProfileId: "",
  chargeCodeIds: [] as string[],
})

// Controls > Outlets — Spa/Restaurant/Bar/etc, each with an optional top-level tax
// override and a curated pool of the enterprise's existing charge codes. Sits next to
// FacilityAmenitiesManager (relocated here from Inventory) per the app owner's request.
export function OutletsManager() {
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [propertyId, setPropertyId] = useState("")
  const [outlets, setOutlets] = useState<any[]>([])
  const [taxProfiles, setTaxProfiles] = useState<TaxProfileOption[]>([])
  const [chargeCodes, setChargeCodes] = useState<ChargeCodeOption[]>([])
  const [loading, setLoading] = useState(true)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [form, setForm] = useState(BLANK_FORM())

  useEffect(() => {
    fetch("/api/properties")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProperties(data)
          if (data.length > 0) setPropertyId(data[0].id)
        }
      })
    fetch("/api/taxes")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setTaxProfiles(data) })
    fetch("/api/charge-codes")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setChargeCodes(data) })
  }, [])

  const fetchOutlets = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/outlets?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setOutlets(data) })
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchOutlets() }, [fetchOutlets])

  const resetForm = () => {
    setForm(BLANK_FORM())
    setIsEditMode(false)
    setEditingId(null)
  }

  const openEdit = (outlet: any) => {
    setForm({
      name: outlet.name,
      description: outlet.description || "",
      outletType: outlet.outletType,
      isActive: outlet.isActive,
      taxOverrideMode: outlet.taxOverrideMode,
      taxProfileId: outlet.taxProfileId || "",
      chargeCodeIds: (outlet.chargeCodes || []).map((oc: any) => oc.chargeCodeId),
    })
    setIsEditMode(true)
    setEditingId(outlet.id)
    setIsModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const url = isEditMode ? `/api/outlets/${editingId}` : "/api/outlets"
      const method = isEditMode ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, propertyId }),
      })
      if (res.ok) {
        setIsModalOpen(false)
        resetForm()
        fetchOutlets()
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to save outlet")
      }
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    setDeleteError(null)
    try {
      const res = await fetch(`/api/outlets/${deletingId}`, { method: "DELETE" })
      if (res.ok) {
        setIsDeleteDialogOpen(false)
        setDeletingId(null)
        fetchOutlets()
      } else {
        const error = await res.json()
        setDeleteError(error.error || "Failed to delete outlet")
      }
    } catch (e) {
      console.error(e)
    }
  }

  // First-column (Name) sorting, asc<->desc.
  const { sorted: sortedOutlets, sort } = useTableSort(outlets, { name: (o) => o.name }, "name")

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2 max-w-xs w-full">
          <Label className="text-xs text-muted-foreground">Property</Label>
          <SearchableSelect
            value={propertyId}
            onChange={(v) => setPropertyId(v ?? "")}
            placeholder="Select property"
            options={properties.map((p) => ({ label: p.name, value: p.id }))}
          />
        </div>

        <Dialog open={isModalOpen} onOpenChange={(open) => { setIsModalOpen(open); if (!open) resetForm() }}>
          <DialogTrigger asChild>
            <Button size="sm" className="shadow-sm" disabled={!propertyId}>
              <Plus className="w-4 h-4 mr-2" /> Add Outlet
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{isEditMode ? "Edit Outlet" : "Add Outlet"}</DialogTitle>
              <DialogDescription>
                A revenue-generating point of sale — Spa, Restaurant, Bar, etc. Curate which
                charge codes it exposes, and optionally override tax handling for everything
                sold through it.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input required placeholder="e.g. Ocean Spa" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.outletType} onValueChange={(v) => setForm((p) => ({ ...p, outletType: v ?? "OTHER" }))}>
                    <SelectTrigger><SelectValue>{OUTLET_TYPE_LABELS[form.outletType]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {OUTLET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input placeholder="Optional details..." value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Tax Override <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">
                  When set, every charge posted through this outlet uses this tax handling
                  instead of the charge code&apos;s own — whether that code is on the default
                  engine or its own Custom Tax profile.
                </p>
                <Select value={form.taxOverrideMode} onValueChange={(v) => setForm((p) => ({ ...p, taxOverrideMode: (v ?? "NONE") as any }))}>
                  <SelectTrigger>
                    <SelectValue>
                      {form.taxOverrideMode === "NONE" ? "No override — use each charge code's own tax"
                        : form.taxOverrideMode === "DEFAULT_ENGINE" ? "Force default Maldives Tax engine"
                        : "Force a specific Custom Tax profile"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No override — use each charge code&apos;s own tax</SelectItem>
                    <SelectItem value="DEFAULT_ENGINE">Force default Maldives Tax engine</SelectItem>
                    <SelectItem value="CUSTOM">Force a specific Custom Tax profile</SelectItem>
                  </SelectContent>
                </Select>
                {form.taxOverrideMode === "CUSTOM" && (
                  <SearchableSelect
                    required
                    options={taxProfiles.map((tp) => ({ label: tp.name, value: tp.id }))}
                    value={form.taxProfileId}
                    onChange={(v) => setForm((p) => ({ ...p, taxProfileId: v }))}
                    placeholder="Select Custom Tax profile..."
                  />
                )}
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Charge Codes</Label>
                <OutletChargeCodePicker
                  allChargeCodes={chargeCodes}
                  selectedIds={form.chargeCodeIds}
                  onChange={(next) => setForm((p) => ({ ...p, chargeCodeIds: next }))}
                />
              </div>

              {isEditMode && (
                <div className="flex items-center gap-2 border-t pt-4">
                  <input
                    type="checkbox"
                    id="outletActive"
                    className="h-4 w-4"
                    checked={form.isActive}
                    onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                  />
                  <Label htmlFor="outletActive" className="cursor-pointer select-none font-normal">Active</Label>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>Save</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => { setIsDeleteDialogOpen(open); if (!open) setDeleteError(null) }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Outlet</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this outlet? This is only possible if it has no
              posted revenue — otherwise, deactivate it instead.
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <ControlsSectionBody>
          <Table>
            <TableHeader className="bg-muted/80">
              <TableRow>
                <SortableTableHead columnKey="name" sort={sort}>Name</SortableTableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tax Override</TableHead>
                <TableHead>Charge Codes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOutlets.map((o) => (
                <TableRow key={o.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell><Badge variant="outline" className="font-normal">{OUTLET_TYPE_LABELS[o.outletType] || o.outletType}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.taxOverrideMode === "NONE" ? "—" : o.taxOverrideMode === "DEFAULT_ENGINE" ? "Default engine" : o.taxProfile?.name || "Custom"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{(o.chargeCodes || []).length}</TableCell>
                  <TableCell>
                    <Badge variant={o.isActive ? "outline" : "secondary"} className={o.isActive ? "bg-success-muted text-success border-success/30" : ""}>
                      {o.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right px-6">
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openEdit(o)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted" onClick={() => { setDeletingId(o.id); setIsDeleteDialogOpen(true) }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {outlets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    <EmptyState icon={Store} title="No outlets configured for this property" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ControlsSectionBody>
      )}
    </div>
  )
}
