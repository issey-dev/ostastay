"use client"

import { useState, useEffect } from "react"
import { Plus, Percent, ShieldAlert, Pencil, Trash2, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ControlsSectionBody } from "@/components/controls/controls-section-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { useConfirm } from "@/components/providers/confirm-provider"
import { StatusBadge } from "@/components/ui/status-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { SectionSaveFooter, type SaveStatus } from "@/components/controls/save-status"
import { MIN_SERVICE_CHARGE_RATE } from "@/lib/tax-calc"

type TaxLineForm = { name: string; ratePercent: string; calculateOn: "BASE" | "COMPOUND" }
const BLANK_TAX_LINE = (): TaxLineForm => ({ name: "", ratePercent: "", calculateOn: "BASE" })

// Splits the old combined "Tax Profiles & Charge Codes" section — this half is Tax
// only (Maldives Tax config + Custom Tax profiles). Charge Codes now live in their own
// ControlsCard (src/components/controls/charge-codes-manager.tsx), since they're
// grouped by category for reporting and only ever reference a Tax profile, not the
// other way around.
//
// Whether each Maldives levy is POSTED at Night Audit (Green Tax, GST, Service Charge) is
// switched on the property's Night Audit page; this form holds only the values (rates,
// amounts, the Green Tax rules) and never sends those switches, so saving here can never
// undo a change made there.
// `currency` is the property's own currency. Green Tax is posted in it with NO conversion
// (src/lib/posting/run-generates.ts GREEN_TAX reads these amounts straight onto the folio),
// so the rates are labelled — and must be entered — in that currency, not a fixed "USD".
export function TaxManager({ propertyId, nightAuditHref, currency = "USD" }: { propertyId: string; nightAuditHref?: string; currency?: string }) {
  const confirm = useConfirm()
  const [taxProfiles, setTaxProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Maldives Tax State
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState<SaveStatus>("idle")
  const [postedNightly, setPostedNightly] = useState({ greenTax: true, tgst: true, serviceCharge: true })
  const [settingsForm, setSettingsForm] = useState({
    greenTaxAdultAmount: 12.00,
    greenTaxChildAmount: 6.00,
    greenTaxExemptAge: 2,
    greenTaxStayBasis: "ACTUAL",
    tgstRate: 17.00,
    serviceChargeRate: 10.00,
  })

  // Modal state
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Edit / Delete states for Taxes
  const [isTaxEditMode, setIsTaxEditMode] = useState(false)
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null)

  const [taxForm, setTaxForm] = useState({ name: "", description: "", rates: [BLANK_TAX_LINE()] })

  useEffect(() => {
    fetchData()
  }, [propertyId])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [taxRes, settingsRes] = await Promise.all([
        fetch(`/api/taxes?propertyId=${propertyId}`),
        fetch(`/api/properties/${propertyId}/settings`)
      ])
      if (taxRes.ok) setTaxProfiles(await taxRes.json())
      if (settingsRes.ok) {
        const data = await settingsRes.json()
        setPostedNightly({
          greenTax: data.greenTaxEnabled !== false,
          tgst: data.tgstEnabled !== false,
          serviceCharge: data.serviceChargeEnabled !== false,
        })
        setSettingsForm({
          greenTaxAdultAmount: data.greenTaxAdultAmount !== undefined ? data.greenTaxAdultAmount : 12.00,
          greenTaxChildAmount: data.greenTaxChildAmount !== undefined ? data.greenTaxChildAmount : 6.00,
          greenTaxExemptAge: data.greenTaxExemptAge !== undefined ? data.greenTaxExemptAge : 2,
          greenTaxStayBasis: data.greenTaxStayBasis === "STANDARD" ? "STANDARD" : "ACTUAL",
          tgstRate: data.tgstRate !== undefined ? data.tgstRate : 17.00,
          serviceChargeRate: data.serviceChargeRate !== undefined ? data.serviceChargeRate : 10.00,
        })
        setSettingsStatus("idle")
      }
    } catch (error) {
      console.error("Failed to fetch tax data", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (serviceChargeTooLow) return
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm)
      })
      if (res.ok) {
        setSettingsStatus("saved")
        toast.success("Maldives Tax saved")
      } else {
        toast.error(await apiError(res, "Couldn't save Maldives Tax. Try again."))
      }
    } catch (e) {
      console.error(e)
      toast.error("Couldn't save Maldives Tax. Try again.")
    } finally {
      setSavingSettings(false)
    }
  }

  const serviceChargeTooLow = !(settingsForm.serviceChargeRate >= MIN_SERVICE_CHARGE_RATE)

  // Every edit to the Maldives Tax form goes through here so the section footer knows it's dirty.
  const editSettings = (fn: (p: typeof settingsForm) => typeof settingsForm) => {
    setSettingsForm(fn)
    setSettingsStatus("dirty")
  }

  const resetTaxForm = () => {
    setTaxForm({ name: "", description: "", rates: [BLANK_TAX_LINE()] })
    setIsTaxEditMode(false)
    setEditingTaxId(null)
  }

  const openTaxEdit = (tax: any) => {
    setTaxForm({
      name: tax.name,
      description: tax.description || "",
      rates: tax.rates && tax.rates.length > 0
        ? tax.rates.map((r: any) => ({
            name: r.name || "Tax",
            ratePercent: r.ratePercent?.toString() ?? "",
            calculateOn: r.calculateOn === "COMPOUND" ? "COMPOUND" : "BASE",
          }))
        : [BLANK_TAX_LINE()]
    })
    setIsTaxEditMode(true)
    setEditingTaxId(tax.id)
    setIsTaxModalOpen(true)
  }

  const addTaxLine = () => setTaxForm(p => ({ ...p, rates: [...p.rates, BLANK_TAX_LINE()] }))
  const removeTaxLine = (index: number) => setTaxForm(p => ({ ...p, rates: p.rates.filter((_, i) => i !== index) }))
  const updateTaxLine = (index: number, patch: Partial<TaxLineForm>) =>
    setTaxForm(p => ({ ...p, rates: p.rates.map((line, i) => (i === index ? { ...line, ...patch } : line)) }))

  const handleCreateOrUpdateTaxProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const url = isTaxEditMode ? `/api/taxes/${editingTaxId}` : `/api/taxes`
      const method = isTaxEditMode ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isTaxEditMode ? taxForm : { ...taxForm, propertyId })
      })
      if (res.ok) {
        setIsTaxModalOpen(false)
        resetTaxForm()
        toast.success("Custom tax saved")
        fetchData()
      } else {
        toast.error(await apiError(res, "Couldn't save the custom tax. Try again."))
      }
    } catch (error) {
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTax = async (deletingTaxId: string) => {
    const ok = await confirm({
      title: "Delete custom tax?",
      description: "Are you sure you want to delete this tax profile? This action will permanently remove it and its historical rates.",
      confirmLabel: "Delete permanently",
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/taxes/${deletingTaxId}`, { method: "DELETE" })
      if (res.ok) {
        toast.success("Custom tax deleted")
        fetchData()
      } else {
        // e.g. the 409 "used by 3 charge codes" refusal.
        toast.error(await apiError(res, "Couldn't delete the custom tax. Try again."))
      }
    } catch (e) {
      console.error(e)
      toast.error("Couldn't delete the custom tax. Try again.")
    }
  }

  // First-column (Profile Name) sorting, asc<->desc.
  const { sorted: sortedTaxProfiles, sort } = useTableSort(taxProfiles, { name: (tp) => tp.name }, "name")

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
          <TabsList className="bg-muted">
            <TabsTrigger value="maldives-tax"><ShieldAlert className="w-4 h-4 mr-2"/> Maldives Tax</TabsTrigger>
            <TabsTrigger value="custom-tax"><Percent className="w-4 h-4 mr-2"/> Custom tax</TabsTrigger>
          </TabsList>

          <Dialog open={isTaxModalOpen} onOpenChange={(open) => {
            setIsTaxModalOpen(open)
            if (!open) resetTaxForm()
          }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-primary border-border hover:bg-muted">
                <Plus className="w-4 h-4 mr-2" /> Add custom tax
              </Button>
            </DialogTrigger>
            <DialogContent size="md">
              <DialogHeader>
                <DialogTitle>{isTaxEditMode ? "Edit custom tax" : "Add custom tax"}</DialogTitle>
                <DialogDescription>
                  A profile can hold one or more tax lines, applied together on any charge code
                  that uses it instead of the default Maldives Tax. Each line is either a flat
                  percentage of the subtotal (&quot;On Subtotal&quot;) or a percentage of the running total
                  so far (&quot;On Subtotal + Prior Lines&quot;) — the same relationship Service Charge and
                  GST already have.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateOrUpdateTaxProfile} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Profile name *</Label>
                  <Input required placeholder="e.g. State VAT" value={taxForm.name} onChange={e => setTaxForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input placeholder="Optional details..." value={taxForm.description} onChange={e => setTaxForm(p => ({ ...p, description: e.target.value }))} />
                </div>

                <div className="space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <Label>Tax lines * <span className="text-muted-foreground font-normal">(applied in this order)</span></Label>
                    <Button type="button" variant="ghost" size="sm" onClick={addTaxLine}>
                      <Plus className="w-4 h-4 mr-1" /> Add line
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {taxForm.rates.map((line, index) => (
                      <div key={index} className="flex flex-col gap-2 p-3 border rounded-md bg-muted sm:flex-row sm:items-start">
                        <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_auto]">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Input
                              required
                              placeholder="Line name, e.g. State Tax"
                              value={line.name}
                              onChange={e => updateTaxLine(index, { name: e.target.value })}
                            />
                            <div className="relative">
                              <Input
                                type="number" step="0.01" min="0" required
                                placeholder="Rate %"
                                value={line.ratePercent}
                                onChange={e => updateTaxLine(index, { ratePercent: e.target.value })}
                              />
                              <span className="absolute right-3 top-2 text-muted-foreground text-sm">%</span>
                            </div>
                          </div>
                          <Select value={line.calculateOn} onValueChange={v => updateTaxLine(index, { calculateOn: (v ?? "BASE") as "BASE" | "COMPOUND" })}>
                            <SelectTrigger className="w-full sm:w-56">
                              <SelectValue>{line.calculateOn === "COMPOUND" ? "On subtotal + prior lines" : "On subtotal"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="BASE">On subtotal</SelectItem>
                              <SelectItem value="COMPOUND">On subtotal + prior lines</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {taxForm.rates.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted shrink-0 self-end sm:self-start" onClick={() => removeTaxLine(index)}>
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsTaxModalOpen(false)}>Cancel</Button>
                  <SubmitButton pending={submitting}>{isTaxEditMode ? "Save" : "Create"}</SubmitButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <TabsContent value="maldives-tax" className="m-0">
          <form onSubmit={handleSaveSettings} className="space-y-8">
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-3 border border-border">
              Calculation order is fixed: Service Charge is a percentage of the base amount, then GST is a percentage
              of (base + Service Charge). Example on a $100 base: SVC 10% = $10.00, GST 17% of $110.00 = $18.70.
              Whether these are added on top of your rates or backed out of them is set by &quot;Prices Include
              Taxes&quot; on this page; whether each is posted at Night Audit is switched on the Night Audit page.
            </p>

            {/* Maldives Green Tax Settings */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-success" /> Maldives Green Tax (MIRA Compliance)
              </h3>

              <div className="grid gap-6">
                <PostedNightly on={postedNightly.greenTax} levy="Green Tax" href={nightAuditHref} />

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Adult rate (per adult/night) in {currency}</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-xs leading-5 text-muted-foreground">{currency}</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="pl-12"
                          required
                          value={settingsForm.greenTaxAdultAmount}
                          onChange={e => editSettings(p => ({ ...p, greenTaxAdultAmount: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Child rate (per child/night) in {currency}</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-2 text-xs leading-5 text-muted-foreground">{currency}</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="pl-12"
                          required
                          value={settingsForm.greenTaxChildAmount}
                          onChange={e => editSettings(p => ({ ...p, greenTaxChildAmount: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Age exemption threshold (in years)</Label>
                      <Input
                        type="number"
                        min="0"
                        required
                        value={settingsForm.greenTaxExemptAge}
                        onChange={e => editSettings(p => ({ ...p, greenTaxExemptAge: parseInt(e.target.value) || 0 }))}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Guests below this age are completely exempt. (MIRA regulations exempt infants under <strong>2</strong> years of age).
                      </p>
                    </div>

                    <p className="text-[11px] text-muted-foreground md:col-span-2 lg:col-span-3">
                      Posted in this property&apos;s currency ({currency}) exactly as entered — no exchange conversion is applied.
                      MIRA sets Green Tax in USD, so a property whose currency is not USD enters the equivalent amount.
                    </p>

                    <div className="space-y-2 md:col-span-2">
                      <div className="flex items-start gap-3">
                        <Switch
                          id="greenTaxStayBasis"
                          checked={settingsForm.greenTaxStayBasis === "STANDARD"}
                          onCheckedChange={(on) => editSettings(p => ({ ...p, greenTaxStayBasis: on ? "STANDARD" : "ACTUAL" }))}
                        />
                        <div>
                          <Label htmlFor="greenTaxStayBasis" className="cursor-pointer">Measure the 12-hour stay on standard check-in/check-out times</Label>
                          <p className="text-[11px] text-muted-foreground">
                            A guest staying under 12 hours gets no Green Tax registration number. Off: measured from the guest&apos;s <strong>actual</strong> check-in time. On: measured from the property&apos;s standard check-in time to its standard check-out time.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            </div>

            {/* Maldives GST & Service Charge Settings */}
            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-success" /> Maldives GST & Service Charge (MIRA Compliance)
              </h3>

              <div className="grid gap-6">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <PostedNightly on={postedNightly.tgst} levy="GST" href={nightAuditHref} />
                  <PostedNightly on={postedNightly.serviceCharge} levy="Service Charge" href={nightAuditHref} />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>GST rate (%)</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={settingsForm.tgstRate}
                          onChange={e => editSettings(p => ({ ...p, tgstRate: parseFloat(e.target.value) || 0 }))}
                        />
                        <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Standard GST rate for the Tourism Sector is <strong>17%</strong>. Calculated on Base + Service Charge.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Service Charge rate (%)</Label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="0.01"
                          min={MIN_SERVICE_CHARGE_RATE}
                          max="100"
                          required
                          aria-invalid={serviceChargeTooLow || undefined}
                          value={settingsForm.serviceChargeRate}
                          onChange={e => editSettings(p => ({ ...p, serviceChargeRate: parseFloat(e.target.value) || 0 }))}
                        />
                        <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                      </div>
                      {serviceChargeTooLow ? (
                        <p className="text-[11px] font-medium text-destructive" role="alert">
                          Must be at least {MIN_SERVICE_CHARGE_RATE}%. To not charge Service Charge at all, switch its posting off on the Night Audit page.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Maldives Law requires a minimum of <strong>{MIN_SERVICE_CHARGE_RATE}%</strong> Service Charge. Not charging it? Switch its posting off on the Night Audit page.
                        </p>
                      )}
                    </div>
                </div>
              </div>
            </div>

            <SectionSaveFooter status={settingsStatus} saving={savingSettings} disabled={serviceChargeTooLow} />
          </form>
        </TabsContent>

        <TabsContent value="custom-tax" className="m-0">
          <ControlsSectionBody>
          {/* Phone view — a card per tax profile: name up top, its lines as chips, then
              edit/delete as full-width/icon actions. */}
          <MobileCardList className="p-4" empty={<EmptyState icon={Percent} title="No custom tax profiles configured" />}>
            {sortedTaxProfiles.map(tp => {
              const lines = [...(tp.rates || [])].sort((a: any, b: any) => a.order - b.order)
              return (
                <MobileCard
                  key={tp.id}
                  title={tp.name}
                  subtitle={tp.description || undefined}
                  onClick={() => openTaxEdit(tp)}
                  actions={
                    <>
                      <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => openTaxEdit(tp)}>
                        <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                      </Button>
                      <Button
                        variant="outline" size="icon"
                        className="h-9 w-9 shrink-0 text-destructive border-destructive/40 hover:bg-destructive-muted"
                        aria-label="Delete"
                        onClick={() => handleDeleteTax(tp.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  }
                >
                  {lines.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {lines.map((r: any) => (
                        <StatusBadge key={r.id} tone="success" className="font-normal" label={`${r.name} ${r.ratePercent.toFixed(2)}%${r.calculateOn === "COMPOUND" ? " (compound)" : ""}`} />
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">No lines</span>
                  )}
                </MobileCard>
              )
            })}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/80">
              <TableRow>
                <SortableTableHead columnKey="name" sort={sort}>Profile name</SortableTableHead>
                <TableHead>Description</TableHead>
                <TableHead>Tax lines</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTaxProfiles.map(tp => {
                const lines = [...(tp.rates || [])].sort((a: any, b: any) => a.order - b.order)
                return (
                  <TableRow key={tp.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">{tp.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tp.description || "-"}</TableCell>
                    <TableCell>
                      {lines.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {lines.map((r: any) => (
                            <StatusBadge key={r.id} tone="success" className="font-normal" label={`${r.name} ${r.ratePercent.toFixed(2)}%${r.calculateOn === "COMPOUND" ? " (compound)" : ""}`} />
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">No lines</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" className="text-primary hover:bg-muted" onClick={() => openTaxEdit(tp)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted" onClick={() => handleDeleteTax(tp.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {taxProfiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-0">
                    <EmptyState icon={Percent} title="No custom tax profiles configured" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
          </ControlsSectionBody>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Read-only here: whether this levy is posted nightly is switched on the Night Audit page.
function PostedNightly({ on, levy, href }: { on: boolean; levy: string; href?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge tone={on ? "success" : "neutral"} label={on ? "Posted nightly" : "Not posted"} />
      <span className="text-muted-foreground">
        {levy} is {on ? "posted" : "not posted"} at Night Audit —{" "}
        {href ? <a href={href} className="text-primary hover:underline">change under Night Audit</a> : "changed under Night Audit"}.
      </span>
    </p>
  )
}
