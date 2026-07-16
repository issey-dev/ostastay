"use client"

import { useState, useEffect } from "react"
import { Plus, Edit2, Trash2, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

const DEMO_ENTERPRISE_ID = "00000000-0000-0000-0000-000000000000"

type PaymentMethod = {
  id: string
  name: string
  type: string
  isActive: boolean
}

export function PaymentMethodsManager() {
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
      const res = await fetch(`/api/payment-methods?enterpriseId=${DEMO_ENTERPRISE_ID}`)
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
          body: JSON.stringify({ ...formData, enterpriseId: DEMO_ENTERPRISE_ID })
        })
      }
      setIsDialogOpen(false)
      fetchMethods()
    } catch (e) {
      console.error("Failed to save", e)
      alert("Failed to save payment method.")
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this payment method? This action cannot be undone.")) return
    try {
      await fetch(`/api/payment-methods/${id}`, { method: "DELETE" })
      fetchMethods()
    } catch (e) {
      console.error(e)
      alert("Failed to delete payment method.")
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Payment Methods</h3>
          <p className="text-sm text-slate-500">Configure accepted payment methods like Cash, Credit Cards, or Bank Transfers.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" /> Add Method
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">Loading...</TableCell></TableRow>
            ) : methods.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">No payment methods configured.</TableCell></TableRow>
            ) : (
              methods.map(method => (
                <TableRow key={method.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center">
                      <CreditCard className="w-4 h-4 text-slate-400 mr-2" />
                      {method.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-slate-50">{method.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch 
                      checked={method.isActive} 
                      onCheckedChange={() => handleToggleActive(method.id, method.isActive)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(method)}>
                      <Edit2 className="w-4 h-4 text-slate-500" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(method.id)}>
                      <Trash2 className="w-4 h-4 text-rose-500" />
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
              <Label>Method Name <span className="text-rose-500">*</span></Label>
              <Input required placeholder="e.g. Visa, Master Card, Cash" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Payment Type <span className="text-rose-500">*</span></Label>
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
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
