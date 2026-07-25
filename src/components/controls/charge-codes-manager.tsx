"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, Receipt } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "@/lib/toast"

// Payment is intentionally absent — payment types live in Payment Methods, not here.
const CATEGORIES = [
  { value: "ROOM", label: "Room" },
  { value: "FOOD_BEVERAGE", label: "Food & Beverage" },
  { value: "TRANSPORTATION", label: "Transportation" },
  { value: "OTHERS", label: "Others" },
  { value: "TAX", label: "Tax" },
  { value: "SYSTEM", label: "System" },
  // For lines that shouldn't count as room/F&B/etc. revenue — e.g. a Travel Agent
  // Commission credit posted at checkout (see EnterpriseSettings.commissionChargeCodeId).
  { value: "NON_REVENUE", label: "Non-Revenue" },
]
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]))

// Split out of the old combined "Tax Profiles & Charge Codes" section — Charge Codes
// get their own card since they're grouped by category (for reporting) and only ever
// reference Tax config, not the other way around. See tax-manager.tsx for Tax itself.
export function ChargeCodesManager() {
  const [chargeCodes, setChargeCodes] = useState<any[]>([])
  const [taxProfiles, setTaxProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL")

  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isChargeEditMode, setIsChargeEditMode] = useState(false)
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null)
  const [isChargeDeleteDialogOpen, setIsChargeDeleteDialogOpen] = useState(false)
  const [deletingChargeId, setDeletingChargeId] = useState<string | null>(null)

  const [chargeForm, setChargeForm] = useState({
    code: "",
    description: "",
    category: "",
    useDefaultTax: true,
    taxProfileId: "",
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [ccRes, taxRes] = await Promise.all([
        fetch(`/api/charge-codes`),
        fetch(`/api/taxes`),
      ])
      if (ccRes.ok) setChargeCodes(await ccRes.json())
      if (taxRes.ok) setTaxProfiles(await taxRes.json())
    } catch (error) {
      console.error("Failed to fetch charge codes", error)
    } finally {
      setLoading(false)
    }
  }

  const resetChargeForm = () => {
    setChargeForm({ code: "", description: "", category: "", useDefaultTax: true, taxProfileId: "" })
    setIsChargeEditMode(false)
    setEditingChargeId(null)
  }

  const openChargeEdit = (code: any) => {
    setChargeForm({
      code: code.code,
      description: code.description,
      category: code.category || "OTHERS",
      useDefaultTax: code.useDefaultTax,
      taxProfileId: code.taxProfileId || code.taxProfile?.id || "",
    })
    setIsChargeEditMode(true)
    setEditingChargeId(code.id)
    setIsChargeModalOpen(true)
  }

  const handleCreateOrUpdateChargeCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const url = isChargeEditMode ? `/api/charge-codes/${editingChargeId}` : `/api/charge-codes`
      const method = isChargeEditMode ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chargeForm)
      })
      if (res.ok) {
        setIsChargeModalOpen(false)
        resetChargeForm()
        fetchData()
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to save charge code")
      }
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteCharge = async () => {
    if (!deletingChargeId) return
    try {
      const res = await fetch(`/api/charge-codes/${deletingChargeId}`, { method: "DELETE" })
      if (res.ok) {
        setIsChargeDeleteDialogOpen(false)
        setDeletingChargeId(null)
        fetchData()
      } else {
        const error = await res.json()
        toast.error(error.error || "Failed to delete Charge Code")
      }
    } catch (e) {
      console.error(e)
    }
  }

  const filteredCodes = categoryFilter === "ALL" ? chargeCodes : chargeCodes.filter(cc => cc.category === categoryFilter)
  // First-column (Code) sorting, asc<->desc — applied after the category filter.
  const { sorted: sortedCodes, sort } = useTableSort(filteredCodes, { code: (cc) => cc.code }, "code")

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading charge codes...</div>
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-2 w-56">
          <Label className="text-xs text-muted-foreground">Filter by Category</Label>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "ALL")}>
            <SelectTrigger>
              <SelectValue>{categoryFilter === "ALL" ? "All Categories" : CATEGORY_LABELS[categoryFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isChargeModalOpen} onOpenChange={(open) => {
          setIsChargeModalOpen(open)
          if (!open) resetChargeForm()
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-2" /> Add Charge Code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isChargeEditMode ? "Edit Charge Code" : "Add Charge Code"}</DialogTitle>
              <DialogDescription>Create a new billing code, grouped by category for reporting.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateOrUpdateChargeCode} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code Identifier *</Label>
                  <Input required placeholder="e.g. RM, MB, REST" className="uppercase" value={chargeForm.code} onChange={e => setChargeForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                </div>
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select required value={chargeForm.category} onValueChange={v => setChargeForm(p => ({ ...p, category: v ?? "" }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Category">
                        {chargeForm.category ? CATEGORY_LABELS[chargeForm.category] : "Select Category"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description *</Label>
                <Input required placeholder="e.g. Room Rate, Mini Bar" value={chargeForm.description} onChange={e => setChargeForm(p => ({ ...p, description: e.target.value }))} />
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Tax</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="taxMode"
                      checked={chargeForm.useDefaultTax}
                      onChange={() => setChargeForm(p => ({ ...p, useDefaultTax: true, taxProfileId: "" }))}
                    />
                    Default (Maldives Tax)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="taxMode"
                      checked={!chargeForm.useDefaultTax}
                      onChange={() => setChargeForm(p => ({ ...p, useDefaultTax: false }))}
                    />
                    Custom Tax
                  </label>
                </div>
                {!chargeForm.useDefaultTax && (
                  <Select required value={chargeForm.taxProfileId} onValueChange={v => setChargeForm(p => ({ ...p, taxProfileId: v ?? "" }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Custom Tax">
                        {chargeForm.taxProfileId ? taxProfiles.find(t => t.id === chargeForm.taxProfileId)?.name : "Select Custom Tax"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {taxProfiles.map(tp => (
                        <SelectItem key={tp.id} value={tp.id}>{tp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {taxProfiles.length === 0 && !chargeForm.useDefaultTax && (
                  <p className="text-xs text-muted-foreground">No Custom Tax profiles yet — add one under Tax &gt; Custom Tax first.</p>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsChargeModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>Save</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Delete Charge Code Modal */}
      <Dialog open={isChargeDeleteDialogOpen} onOpenChange={setIsChargeDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Charge Code</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this charge code? It cannot be deleted if active transactions are linked to it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsChargeDeleteDialogOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteCharge}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ControlsSectionBody>
        <Table>
          <TableHeader className="bg-muted/80">
            <TableRow>
              <SortableTableHead columnKey="code" sort={sort}>Code</SortableTableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Tax</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCodes.map(cc => (
              <TableRow key={cc.id} className="hover:bg-muted/50">
                <TableCell className="font-mono font-medium text-foreground">{cc.code}</TableCell>
                <TableCell>{cc.description}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">{CATEGORY_LABELS[cc.category] || cc.category}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-normal">
                    {cc.useDefaultTax ? "Default (Maldives Tax)" : cc.taxProfile?.name || "Custom Tax"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right px-6">
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openChargeEdit(cc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted" onClick={() => {
                      setDeletingChargeId(cc.id)
                      setIsChargeDeleteDialogOpen(true)
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredCodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-0">
                  <EmptyState icon={Receipt} title="No charge codes configured" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ControlsSectionBody>
    </div>
  )
}
