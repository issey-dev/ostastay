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
  code: "",
  address: "",
  email: "",
  phone: "",
  taxNo: "",
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
      code: outlet.code || "",
      address: outlet.address || "",
      email: outlet.email || "",
      phone: outlet.phone || "",
      taxNo: outlet.taxNo || "",
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
          <DialogContent className="max-w-7xl sm:max-w-7xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isEditMode ? "Edit Outlet" : "Add Outlet"}</DialogTitle>
              <DialogDescription>
                A revenue-generating point of sale — Spa, Restaurant, Bar, etc. Its own details
                appear on walk-in bills raised on its behalf; the financial side curates which
                charge codes it exposes and how tax is handled.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:divide-x md:divide-border">
                {/* Left — Outlet Information */}
                <div className="space-y-4 md:pr-6">
                  <h3 className="text-sm font-semibold text-foreground">Outlet Information</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <Label>Code *</Label>
                    <Input
                      required
                      placeholder="e.g. SPA"
                      value={form.code}
                      maxLength={8}
                      onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      2–8 letters/digits. Prefixes this outlet&apos;s sales-check numbers (e.g. {form.code ? form.code : "SPA"}-00001).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Address</Label>
                    <Input placeholder="Outlet address (shown on walk-in bills)" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" placeholder="outlet@example.com" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input placeholder="+960 ..." value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Tax No</Label>
                    <Input placeholder="Tax registration number" value={form.taxNo} onChange={(e) => setForm((p) => ({ ...p, taxNo: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input placeholder="Optional details..." value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
                  </div>
                </div>

                {/* Right — Financial Information */}
                <div className="space-y-4 md:pl-6">
                  <h3 className="text-sm font-semibold text-foreground">Financial Information</h3>
                  <div className="space-y-2">
                    <Label>Tax Rule</Label>
                    <p className="text-xs text-muted-foreground">
                      Choose <span className="font-medium">Default</span> to let each charge code keep its own
                      tax, or <span className="font-medium">Custom</span> to force one handling for everything
                      sold through this outlet.
                    </p>
                    <Select value={form.taxOverrideMode} onValueChange={(v) => setForm((p) => ({ ...p, taxOverrideMode: (v ?? "NONE") as any }))}>
                      <SelectTrigger>
                        <SelectValue>
                          {form.taxOverrideMode === "NONE" ? "Default — each charge code's own tax"
                            : form.taxOverrideMode === "DEFAULT_ENGINE" ? "Custom — force default Maldives Tax engine"
                            : "Custom — force a specific Tax profile"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Default — each charge code&apos;s own tax</SelectItem>
                        <SelectItem value="DEFAULT_ENGINE">Custom — force default Maldives Tax engine</SelectItem>
                        <SelectItem value="CUSTOM">Custom — force a specific Tax profile</SelectItem>
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
                </div>
              </div>

              <div className="flex justify-end space-x-2 border-t pt-4">
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
          {/* Phone view — one card per outlet: name/status up top, type/tax/codes as a
              small fact grid, then edit/delete as full-width/icon actions. */}
          <div className="md:hidden">
            {outlets.length === 0 ? (
              <div className="p-4"><EmptyState icon={Store} title="No outlets configured for this property" /></div>
            ) : (
              <div className="space-y-3 p-4">
                {sortedOutlets.map((o) => (
                  <div key={o.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{o.name}</p>
                        {o.code
                          ? <span className="font-mono text-xs text-muted-foreground">{o.code}</span>
                          : <span className="text-xs text-warning">Set a code</span>}
                      </div>
                      <Badge variant={o.isActive ? "outline" : "secondary"} className={`shrink-0 ${o.isActive ? "bg-success-muted text-success border-success/30" : ""}`}>
                        {o.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="font-normal">{OUTLET_TYPE_LABELS[o.outletType] || o.outletType}</Badge>
                      <span>{o.taxOverrideMode === "NONE" ? "Default tax" : o.taxOverrideMode === "DEFAULT_ENGINE" ? "Default engine" : o.taxProfile?.name || "Custom tax"}</span>
                      <span>{(o.chargeCodes || []).length} charge codes</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openEdit(o)}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                      </Button>
                      <Button
                        variant="outline" size="icon"
                        className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive-muted"
                        aria-label="Delete outlet"
                        onClick={() => { setDeletingId(o.id); setIsDeleteDialogOpen(true) }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/80">
              <TableRow>
                <SortableTableHead columnKey="name" sort={sort}>Name</SortableTableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tax Rule</TableHead>
                <TableHead>Charge Codes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOutlets.map((o) => (
                <TableRow key={o.id} className="hover:bg-muted/50">
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>
                    {o.code
                      ? <span className="font-mono text-xs">{o.code}</span>
                      : <span className="text-xs text-warning">Set a code</span>}
                  </TableCell>
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
                  <TableCell colSpan={7} className="py-0">
                    <EmptyState icon={Store} title="No outlets configured for this property" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </ControlsSectionBody>
      )}
    </div>
  )
}
