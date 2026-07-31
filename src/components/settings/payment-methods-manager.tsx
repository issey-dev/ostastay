"use client"

import { useState, useEffect } from "react"
import { Plus, Edit2, Trash2, CreditCard } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { ControlsCard } from "@/components/controls/controls-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "@/lib/toast"
import { useConfirm } from "@/components/providers/confirm-provider"

type PaymentMethod = {
  id: string
  name: string
  type: string
  isActive: boolean
}

export function PaymentMethodsManager({ title, description }: { title: string; description?: string }) {
  const confirm = useConfirm()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: "", type: "CARD", isActive: true })

  useEffect(() => {
    fetchMethods()
  }, [])

  const fetchMethods = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payment-methods`)
      if (res.ok) setMethods(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDialog = (method?: PaymentMethod) => {
    if (method) {
      setEditingId(method.id)
      setFormData({ name: method.name, type: method.type, isActive: method.isActive })
    } else {
      setEditingId(null)
      setFormData({ name: "", type: "CARD", isActive: true })
    }
    setIsDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingId) {
        await fetch(`/api/payment-methods/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData)
        })
      } else {
        await fetch(`/api/payment-methods`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData)
        })
      }
      setIsDialogOpen(false)
      fetchMethods()
    } catch (e) {
      console.error("Failed to save", e)
      toast.error("Failed to save payment method.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this payment method?", description: "This action cannot be undone.", confirmLabel: "Delete", destructive: true }))) return
    try {
      await fetch(`/api/payment-methods/${id}`, { method: "DELETE" })
      fetchMethods()
    } catch (e) {
      console.error(e)
      toast.error("Failed to delete payment method.")
    }
  }

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await fetch(`/api/payment-methods/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentStatus })
      })
      fetchMethods()
    } catch (e) {
      console.error(e)
    }
  }

  // First-column (Name) sorting, asc<->desc.
  const { sorted: sortedMethods, sort } = useTableSort(methods, { name: (m) => m.name }, "name")

  return (
    <ControlsCard
      title={title}
      description={description}
      action={
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="w-4 h-4 mr-2" /> Add Method
        </Button>
      }
    >
      <div className="-mx-6 -mb-6 border-t border-border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <SortableTableHead columnKey="name" sort={sort}>Name</SortableTableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : methods.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-0">
                <EmptyState icon={CreditCard} title="No payment methods configured" />
              </TableCell></TableRow>
            ) : (
              sortedMethods.map(method => (
                <TableRow key={method.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center">
                      <CreditCard className="w-4 h-4 text-muted-foreground mr-2" />
                      {method.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-muted">{method.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch 
                      checked={method.isActive} 
                      onCheckedChange={() => handleToggleActive(method.id, method.isActive)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label="Edit payment method" onClick={() => handleOpenDialog(method)}>
                      <Edit2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete payment method" onClick={() => handleDelete(method.id)}>
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
            <DialogTitle>{editingId ? "Edit Payment Method" : "Add Payment Method"}</DialogTitle>
            <DialogDescription>Configure the details for this payment method.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Method Name <span className="text-destructive">*</span></Label>
              <Input required placeholder="e.g. Visa, Master Card, Cash" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Payment Type <span className="text-destructive">*</span></Label>
              <Select required value={formData.type} onValueChange={v => setFormData(p => ({ ...p, type: v ?? "" }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Type">
                    {formData.type || "Select Type"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">CASH</SelectItem>
                  <SelectItem value="CARD">CARD</SelectItem>
                  <SelectItem value="TRANSFER">TRANSFER</SelectItem>
                  <SelectItem value="CITY_LEDGER">CITY LEDGER</SelectItem>
                  <SelectItem value="CHEQUE">CHEQUE</SelectItem>
                  <SelectItem value="VOUCHER">VOUCHER</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2">
              <Label className="flex-1">Active Status</Label>
              <Switch checked={formData.isActive} onCheckedChange={v => setFormData(p => ({ ...p, isActive: v }))} />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button type="submit" className="">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </ControlsCard>
  )
}
