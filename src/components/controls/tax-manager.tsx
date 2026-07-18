"use client"

import { useState, useEffect } from "react"
import { Plus, Percent, ShieldAlert, Save, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

// Splits the old combined "Tax Profiles & Charge Codes" section — this half is Tax
// only (Maldives Tax config + Custom Tax profiles). Charge Codes now live in their own
// ControlsCard (src/components/controls/charge-codes-manager.tsx), since they're
// grouped by category for reporting and only ever reference a Tax profile, not the
// other way around.
export function TaxManager() {
  const [taxProfiles, setTaxProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Maldives Tax State
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    greenTaxEnabled: true,
    greenTaxAdultAmount: 12.00,
    greenTaxChildAmount: 6.00,
    greenTaxExemptAge: 2,
    tgstEnabled: true,
    tgstRate: 17.00,
    serviceChargeEnabled: true,
    serviceChargeRate: 10.00,
  })

  // Modal state
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Edit / Delete states for Taxes
  const [isTaxEditMode, setIsTaxEditMode] = useState(false)
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null)
  const [isTaxDeleteDialogOpen, setIsTaxDeleteDialogOpen] = useState(false)
  const [deletingTaxId, setDeletingTaxId] = useState<string | null>(null)

  const [taxForm, setTaxForm] = useState({ name: "", description: "", ratePercent: "", effectiveFrom: new Date().toISOString().split('T')[0] })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [taxRes, settingsRes] = await Promise.all([
        fetch(`/api/taxes`),
        fetch(`/api/tenant-settings`)
      ])
      if (taxRes.ok) setTaxProfiles(await taxRes.json())
      if (settingsRes.ok) {
        const data = await settingsRes.json()
        setSettingsForm({
          greenTaxEnabled: data.greenTaxEnabled !== undefined ? data.greenTaxEnabled : true,
          greenTaxAdultAmount: data.greenTaxAdultAmount !== undefined ? data.greenTaxAdultAmount : 12.00,
          greenTaxChildAmount: data.greenTaxChildAmount !== undefined ? data.greenTaxChildAmount : 6.00,
          greenTaxExemptAge: data.greenTaxExemptAge !== undefined ? data.greenTaxExemptAge : 2,
          tgstEnabled: data.tgstEnabled !== undefined ? data.tgstEnabled : true,
          tgstRate: data.tgstRate !== undefined ? data.tgstRate : 17.00,
          serviceChargeEnabled: data.serviceChargeEnabled !== undefined ? data.serviceChargeEnabled : true,
          serviceChargeRate: data.serviceChargeRate !== undefined ? data.serviceChargeRate : 10.00,
        })
      }
    } catch (error) {
      console.error("Failed to fetch tax data", error)
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
        alert("Maldives Tax settings saved successfully!")
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
        body: JSON.stringify(taxForm)
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
        alert(error.error || "Failed to delete Custom Tax profile")
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="w-full">
      <Tabs defaultValue="maldives-tax" className="w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="maldives-tax"><ShieldAlert className="w-4 h-4 mr-2"/> Maldives Tax</TabsTrigger>
            <TabsTrigger value="custom-tax"><Percent className="w-4 h-4 mr-2"/> Custom Tax</TabsTrigger>
          </TabsList>

          <Dialog open={isTaxModalOpen} onOpenChange={(open) => {
            setIsTaxModalOpen(open)
            if (!open) resetTaxForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-primary border-border hover:bg-muted">
                <Plus className="w-4 h-4 mr-2" /> Add Custom Tax
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{isTaxEditMode ? "Edit Custom Tax" : "Add Custom Tax"}</DialogTitle>
                <DialogDescription>
                  {isTaxEditMode
                    ? "Update the tax profile name. You can also specify a new rate that will be recorded as the latest effective rate."
                    : "Create a new custom tax bracket, for use instead of the default Maldives Tax on specific charge codes."}
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
        </div>

        {/* Delete Custom Tax Modal */}
        <Dialog open={isTaxDeleteDialogOpen} onOpenChange={setIsTaxDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Custom Tax</DialogTitle>
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

        <TabsContent value="maldives-tax" className="m-0 border rounded-lg bg-card overflow-hidden shadow-sm p-6">
          <form onSubmit={handleSaveSettings} className="space-y-8">
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-3 border border-border">
              Calculation order is fixed: Service Charge is a percentage of the base amount, then GST is a percentage
              of (base + Service Charge). Example on a $100 base: SVC 10% = $10.00, GST 17% of $110.00 = $18.70.
              Whether these are added on top of your rates or backed out of them is controlled per-property under
              Controls &gt; General &gt; Property Information (&quot;Prices Include Taxes&quot;).
            </p>

            {/* Maldives Green Tax Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-success" /> Maldives Green Tax (MIRA Compliance)
              </h3>

              <div className="grid gap-6 bg-muted p-6 rounded-xl border border-border">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="greenTaxEnabled"
                    className="h-4 w-4 text-primary border-border rounded focus:ring-ring cursor-pointer"
                    checked={settingsForm.greenTaxEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, greenTaxEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="greenTaxEnabled" className="font-semibold text-foreground text-sm cursor-pointer select-none">
                    Enable Automatic Nightly Green Tax Calculation & Posting
                  </Label>
                </div>

                {settingsForm.greenTaxEnabled && (
                  <div className="grid gap-6 sm:grid-cols-3 border-t pt-4 mt-2">
                    <div className="space-y-2">
                      <Label>Adult Rate (per adult/night) in USD</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="pl-7"
                          required
                          value={settingsForm.greenTaxAdultAmount}
                          onChange={e => setSettingsForm(p => ({ ...p, greenTaxAdultAmount: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Child Rate (per child/night) in USD</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="pl-7"
                          required
                          value={settingsForm.greenTaxChildAmount}
                          onChange={e => setSettingsForm(p => ({ ...p, greenTaxChildAmount: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
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
                      <p className="text-[11px] text-muted-foreground">
                        Guests below this age are completely exempt. (MIRA regulations exempt infants under <strong>2</strong> years of age).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Maldives GST & Service Charge Settings */}
            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-success" /> Maldives GST & Service Charge (MIRA Compliance)
              </h3>

              <div className="grid gap-6 bg-muted p-6 rounded-xl border border-border">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="tgstEnabled"
                    className="h-4 w-4 text-primary border-border rounded focus:ring-ring cursor-pointer"
                    checked={settingsForm.tgstEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, tgstEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="tgstEnabled" className="font-semibold text-foreground text-sm cursor-pointer select-none">
                    Enable Automatic Nightly GST Calculation
                  </Label>
                </div>

                <div className="flex items-center gap-3 mt-2">
                  <input
                    type="checkbox"
                    id="serviceChargeEnabled"
                    className="h-4 w-4 text-primary border-border rounded focus:ring-ring cursor-pointer"
                    checked={settingsForm.serviceChargeEnabled}
                    onChange={e => setSettingsForm(p => ({ ...p, serviceChargeEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="serviceChargeEnabled" className="font-semibold text-foreground text-sm cursor-pointer select-none">
                    Enable Automatic Nightly Service Charge (SC) Calculation
                  </Label>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 border-t pt-4 mt-2">
                  {settingsForm.tgstEnabled && (
                    <div className="space-y-2">
                      <Label>GST Rate (%)</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={settingsForm.tgstRate}
                          onChange={e => setSettingsForm(p => ({ ...p, tgstRate: parseFloat(e.target.value) || 0 }))}
                        />
                        <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Standard GST rate for the Tourism Sector is <strong>17%</strong>. Calculated on Base + Service Charge.
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
                        <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Maldives Law requires a minimum of <strong>10%</strong> Service Charge.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button type="submit" disabled={savingSettings}>
                <Save className="w-4 h-4 mr-2" />
                {savingSettings ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="custom-tax" className="m-0 border rounded-lg bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/80">
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
                  <TableRow key={tp.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{tp.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tp.description || "-"}</TableCell>
                    <TableCell>
                      {activeRate ? (
                        <Badge variant="outline" className="bg-success-muted text-success border-success/30">
                          {activeRate.ratePercent.toFixed(2)}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">No Rates</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {activeRate ? new Date(activeRate.effectiveFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : "-"}
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openTaxEdit(tp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted" onClick={() => {
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
                  <TableCell colSpan={5} className="py-0">
                    <EmptyState icon={Percent} title="No custom tax profiles configured" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  )
}
