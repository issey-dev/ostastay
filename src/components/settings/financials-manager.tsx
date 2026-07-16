"use client"

import { useState, useEffect } from "react"
import { Plus, Percent, ReceiptText, ShieldAlert, Save, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

export function FinancialsManager() {
  const [taxProfiles, setTaxProfiles] = useState<any[]>([])
  const [chargeCodes, setChargeCodes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Maldives Tax Engine State
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    greenTaxEnabled: true,
    greenTaxAmount: 6.00,
    greenTaxExemptAge: 2,
    tgstEnabled: true,
    tgstRate: 16.00,
    serviceChargeEnabled: true,
    serviceChargeRate: 10.00,
    pricesIncludeTaxes: true
  })

  // Modals state
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false)
  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Edit / Delete states for Taxes
  const [isTaxEditMode, setIsTaxEditMode] = useState(false)
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null)
  const [isTaxDeleteDialogOpen, setIsTaxDeleteDialogOpen] = useState(false)
  const [deletingTaxId, setDeletingTaxId] = useState<string | null>(null)

  // Edit / Delete states for Charge Codes
  const [isChargeEditMode, setIsChargeEditMode] = useState(false)
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null)
  const [isChargeDeleteDialogOpen, setIsChargeDeleteDialogOpen] = useState(false)
  const [deletingChargeId, setDeletingChargeId] = useState<string | null>(null)

  // Forms
  const [taxForm, setTaxForm] = useState({ name: "", description: "", ratePercent: "", effectiveFrom: new Date().toISOString().split('T')[0] })
  const [chargeForm, setChargeForm] = useState({ code: "", description: "", taxProfileId: "" })

  const enterpriseId = "00000000-0000-0000-0000-000000000000" // Demo

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [taxRes, ccRes, settingsRes] = await Promise.all([
        fetch(`/api/taxes?enterpriseId=${enterpriseId}`),
        fetch(`/api/charge-codes?enterpriseId=${enterpriseId}`),
        fetch(`/api/tenant-settings`)
      ])
      if (taxRes.ok) setTaxProfiles(await taxRes.json())
      if (ccRes.ok) setChargeCodes(await ccRes.json())
      if (settingsRes.ok) {
        const data = await settingsRes.json()
        setSettingsForm({
          greenTaxEnabled: data.greenTaxEnabled !== undefined ? data.greenTaxEnabled : true,
          greenTaxAmount: data.greenTaxAmount !== undefined ? data.greenTaxAmount : 6.00,
          greenTaxExemptAge: data.greenTaxExemptAge !== undefined ? data.greenTaxExemptAge : 2,
          tgstEnabled: data.tgstEnabled !== undefined ? data.tgstEnabled : true,
          tgstRate: data.tgstRate !== undefined ? data.tgstRate : 16.00,
          serviceChargeEnabled: data.serviceChargeEnabled !== undefined ? data.serviceChargeEnabled : true,
          serviceChargeRate: data.serviceChargeRate !== undefined ? data.serviceChargeRate : 10.00,
          pricesIncludeTaxes: data.pricesIncludeTaxes !== undefined ? data.pricesIncludeTaxes : true
        })
      }
    } catch (error) {
      console.error("Failed to fetch financials data", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/tenant-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm)
      })
      if (res.ok) {
        alert("Maldives Tax Settings saved successfully!")
      } else {
        alert("Failed to save settings.")
      }
    } catch (e) {
      console.error(e)
      alert("Failed to save settings.")
    } finally {
      setSavingSettings(false)
    }
  }

  // --- TAX PROFILES ---

  const resetTaxForm = () => {
    setTaxForm({ name: "", description: "", ratePercent: "", effectiveFrom: new Date().toISOString().split('T')[0] })
    setIsTaxEditMode(false)
    setEditingTaxId(null)
  }

  const openTaxEdit = (tax: any) => {
    setTaxForm({
      name: tax.name,
      description: tax.description || "",
      ratePercent: tax.rates?.[0]?.ratePercent?.toString() || "",
      effectiveFrom: new Date().toISOString().split('T')[0]
    })
    setIsTaxEditMode(true)
    setEditingTaxId(tax.id)
    setIsTaxModalOpen(true)
  }

  const handleCreateOrUpdateTaxProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const url = isTaxEditMode ? `/api/taxes/${editingTaxId}` : `/api/taxes`
      const method = isTaxEditMode ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...taxForm, enterpriseId })
      })
      if (res.ok) {
        setIsTaxModalOpen(false)
        resetTaxForm()
        fetchData()
      } else {
        const error = await res.json()
        alert(error.error || "Failed to save tax profile")
      }
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTax = async () => {
    if (!deletingTaxId) return
    try {
      const res = await fetch(`/api/taxes/${deletingTaxId}`, { method: "DELETE" })
      if (res.ok) {
        setIsTaxDeleteDialogOpen(false)
        setDeletingTaxId(null)
        fetchData()
      } else {
        const error = await res.json()
        alert(error.error || "Failed to delete Tax Profile")
      }
    } catch (e) {
      console.error(e)
    }
  }

  // --- CHARGE CODES ---

  const resetChargeForm = () => {
    setChargeForm({ code: "", description: "", taxProfileId: "" })
    setIsChargeEditMode(false)
    setEditingChargeId(null)
  }

  const openChargeEdit = (code: any) => {
    setChargeForm({
      code: code.code,
      description: code.description,
      taxProfileId: code.taxProfileId || (code.taxProfile?.id) || ""
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
        body: JSON.stringify({ ...chargeForm, enterpriseId })
      })
      if (res.ok) {
        setIsChargeModalOpen(false)
        resetChargeForm()
        fetchData()
      } else {
        const error = await res.json()
        alert(error.error || "Failed to save charge code")
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
        alert(error.error || "Failed to delete Charge Code")
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-slate-500">Loading Financial Configurations...</div>
  }

  return (
    <div className="w-full">
      <Tabs defaultValue="maldives-taxes" className="w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <TabsList className="bg-slate-100/50">
            <TabsTrigger value="maldives-taxes"><ShieldAlert className="w-4 h-4 mr-2"/> Maldives Tax Engine</TabsTrigger>
            <TabsTrigger value="tax-profiles"><Percent className="w-4 h-4 mr-2"/> Custom Tax Profiles</TabsTrigger>
            <TabsTrigger value="charge-codes"><ReceiptText className="w-4 h-4 mr-2"/> Charge Codes</TabsTrigger>
          </TabsList>
          
          <div className="space-x-2">
            <Dialog open={isTaxModalOpen} onOpenChange={(open) => {
              setIsTaxModalOpen(open)
              if (!open) resetTaxForm()
            }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-indigo-600 border-indigo-200 hover:bg-indigo-50">
                  <Plus className="w-4 h-4 mr-2" /> Add Tax Profile
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{isTaxEditMode ? "Edit Tax Profile" : "Add Tax Profile"}</DialogTitle>
                  <DialogDescription>
                    {isTaxEditMode 
                      ? "Update the tax profile name. You can also specify a new rate that will be recorded as the latest effective rate." 
                      : "Create a new custom tax bracket."}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateOrUpdateTaxProfile} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Profile Name *</Label>
                    <Input required placeholder="e.g. State VAT" value={taxForm.name} onChange={e => setTaxForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input placeholder="Optional details..." value={taxForm.description} onChange={e => setTaxForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{isTaxEditMode ? "New Rate Percent (%) (Optional)" : "Initial Rate (%) *"}</Label>
                      <Input type="number" step="0.01" min="0" required={!isTaxEditMode} placeholder="8.5" value={taxForm.ratePercent} onChange={e => setTaxForm(p => ({ ...p, ratePercent: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>{isTaxEditMode ? "New Rate Effective From" : "Effective Date *"}</Label>
                      <Input type="date" required={!isTaxEditMode} disabled={isTaxEditMode} value={taxForm.effectiveFrom} onChange={e => setTaxForm(p => ({ ...p, effectiveFrom: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex justify-end space-x-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsTaxModalOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={submitting}>Save</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={isChargeModalOpen} onOpenChange={(open) => {
              setIsChargeModalOpen(open)
              if (!open) resetChargeForm()
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
                  <Plus className="w-4 h-4 mr-2" /> Add Charge Code
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{isChargeEditMode ? "Edit Charge Code" : "Add Charge Code"}</DialogTitle>
                  <DialogDescription>Create a new billing code and link it to a tax profile.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateOrUpdateChargeCode} className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Code Identifier *</Label>
                      <Input required placeholder="e.g. RM, MB, REST" className="uppercase" value={chargeForm.code} onChange={e => setChargeForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tax Profile *</Label>
                      <Select required value={chargeForm.taxProfileId} onValueChange={v => setChargeForm(p => ({ ...p, taxProfileId: v ?? "" }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Profile">
                            {chargeForm.taxProfileId ? taxProfiles.find(t => t.id === chargeForm.taxProfileId)?.name : "Select Profile"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {taxProfiles.map(tp => (
                            <SelectItem key={tp.id} value={tp.id}>{tp.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description *</Label>
                    <Input required placeholder="e.g. Room Rate, Mini Bar" value={chargeForm.description} onChange={e => setChargeForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="flex justify-end space-x-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsChargeModalOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={submitting}>Save</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Delete Tax Modal */}
        <Dialog open={isTaxDeleteDialogOpen} onOpenChange={setIsTaxDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Tax Profile</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this tax profile? This action will permanently remove it and its historical rates.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsTaxDeleteDialogOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={handleDeleteTax}>Delete Permanently</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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

        <TabsContent value="maldives-taxes" className="m-0 border rounded-lg bg-white overflow-hidden shadow-sm p-6">
          <form onSubmit={handleSaveSettings} className="space-y-8">
            {/* Maldives Green Tax Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-600" /> Maldives Green Tax (MIRA Compliance)
              </h3>
              
              <div className="grid gap-6 bg-slate-50 p-6 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="greenTaxEnabled" 
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    checked={settingsForm.greenTaxEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, greenTaxEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="greenTaxEnabled" className="font-semibold text-slate-800 text-sm cursor-pointer select-none">
                    Enable Automatic Nightly Green Tax Calculation & Posting
                  </Label>
                </div>

                {settingsForm.greenTaxEnabled && (
                  <div className="grid gap-6 sm:grid-cols-2 border-t pt-4 mt-2">
                    <div className="space-y-2">
                      <Label>Green Tax Amount (per guest/day) in USD</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-slate-400">$</span>
                        <Input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          className="pl-7"
                          required
                          value={settingsForm.greenTaxAmount} 
                          onChange={e => setSettingsForm(p => ({ ...p, greenTaxAmount: parseFloat(e.target.value) || 0 }))} 
                        />
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Standard rules: <strong>$6.00</strong> for inhabited island guesthouses ($\le 50$ rooms), or <strong>$12.00</strong> for resorts.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Age Exemption Threshold (in years)</Label>
                      <Input 
                        type="number" 
                        min="0" 
                        required
                        value={settingsForm.greenTaxExemptAge} 
                        onChange={e => setSettingsForm(p => ({ ...p, greenTaxExemptAge: parseInt(e.target.value) || 0 }))} 
                      />
                      <p className="text-[11px] text-slate-500">
                        Guests below this age are completely exempt. (MIRA regulations exempt infants under <strong>2</strong> years of age).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Maldives Taxes & Service Charge Settings */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-600" /> Maldives TGST & Service Charge (MIRA Compliance)
              </h3>
              
              <div className="grid gap-6 bg-slate-50 p-6 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="tgstEnabled" 
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    checked={settingsForm.tgstEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, tgstEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="tgstEnabled" className="font-semibold text-slate-800 text-sm cursor-pointer select-none">
                    Enable Automatic Nightly TGST Calculation
                  </Label>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <input 
                    type="checkbox" 
                    id="serviceChargeEnabled" 
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    checked={settingsForm.serviceChargeEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, serviceChargeEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="serviceChargeEnabled" className="font-semibold text-slate-800 text-sm cursor-pointer select-none">
                    Enable Automatic Nightly Service Charge (SC) Calculation
                  </Label>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 border-t pt-4 mt-2">
                  {settingsForm.tgstEnabled && (
                    <div className="space-y-2">
                      <Label>TGST Rate (%)</Label>
                      <div className="relative">
                        <Input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          required
                          value={settingsForm.tgstRate} 
                          onChange={e => setSettingsForm(p => ({ ...p, tgstRate: parseFloat(e.target.value) || 0 }))} 
                        />
                        <span className="absolute right-3 top-2 text-slate-400">%</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Standard TGST rate for Tourism Sector is <strong>16%</strong> (increasing to 17% in 2025).
                      </p>
                    </div>
                  )}

                  {settingsForm.serviceChargeEnabled && (
                    <div className="space-y-2">
                      <Label>Service Charge Rate (%)</Label>
                      <div className="relative">
                        <Input 
                          type="number" 
                          step="0.01" 
                          min="10" 
                          required
                          value={settingsForm.serviceChargeRate} 
                          onChange={e => setSettingsForm(p => ({ ...p, serviceChargeRate: parseFloat(e.target.value) || 0 }))} 
                        />
                        <span className="absolute right-3 top-2 text-slate-400">%</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Maldives Law requires a minimum of <strong>10%</strong> Service Charge.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 border-t pt-4 mt-2">
                  <input 
                    type="checkbox" 
                    id="pricesIncludeTaxes" 
                    className="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                    checked={settingsForm.pricesIncludeTaxes}
                    onChange={e => setSettingsForm(p => ({ ...p, pricesIncludeTaxes: e.target.checked }))}
                  />
                  <Label htmlFor="pricesIncludeTaxes" className="font-semibold text-slate-800 text-sm cursor-pointer select-none">
                    Prices Include Taxes (Inclusive vs Exclusive &quot;++&quot; Pricing)
                  </Label>
                </div>
                <p className="text-[11px] text-slate-500 -mt-4 ml-7">
                  If enabled, the Night Audit will reverse-calculate the SC and TGST out of your standard room rates, so the total matches the rate plan exactly. If disabled, taxes are added ON TOP of the room rate.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button type="submit" disabled={savingSettings} className="bg-indigo-600 hover:bg-indigo-700">
                <Save className="w-4 h-4 mr-2" /> 
                {savingSettings ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="tax-profiles" className="m-0 border rounded-lg bg-white overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow>
                <TableHead>Profile Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Current Active Rate</TableHead>
                <TableHead>Effective Since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxProfiles.map(tp => {
                const activeRate = tp.rates?.[0]
                return (
                  <TableRow key={tp.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium">{tp.name}</TableCell>
                    <TableCell className="text-slate-500">{tp.description || "-"}</TableCell>
                    <TableCell>
                      {activeRate ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          {activeRate.ratePercent.toFixed(2)}%
                        </Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">No Rates</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {activeRate ? new Date(activeRate.effectiveFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : "-"}
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" className="text-indigo-600 hover:bg-indigo-50" onClick={() => openTaxEdit(tp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => {
                          setDeletingTaxId(tp.id)
                          setIsTaxDeleteDialogOpen(true)
                        }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {taxProfiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-500">No custom tax profiles configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="charge-codes" className="m-0 border rounded-lg bg-white overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Assigned Tax Profile</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chargeCodes.map(cc => (
                <TableRow key={cc.id} className="hover:bg-slate-50/50">
                  <TableCell className="font-mono font-medium text-slate-700">{cc.code}</TableCell>
                  <TableCell>{cc.description}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">{cc.taxProfile?.name || "Unknown"}</Badge>
                  </TableCell>
                  <TableCell className="text-right px-6">
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" className="text-indigo-600 hover:bg-indigo-50" onClick={() => openChargeEdit(cc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-rose-600 hover:bg-rose-50" onClick={() => {
                        setDeletingChargeId(cc.id)
                        setIsChargeDeleteDialogOpen(true)
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {chargeCodes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-500">No charge codes configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  )
}
