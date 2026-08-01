"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import type { DateRange } from "react-day-picker"
import { KeyRound, Building2, FileText, Printer, Receipt } from "@/components/icons"
import { toast } from "@/lib/toast"

// Osta's licensing console, reworked 2026-07-31 (owner decisions): tier pricing is GONE
// — the license price is entered manually, the license carries a lifecycle
// (active/expiry/grace/revoked), and the counted attributes are per-property CAPS
// (room types / rooms / channels — PM excluded), not price inputs. Module access is
// also gone from this screen entirely ("not controlled by us") — module availability
// is the tenant's own role matrix; Osta's levers are license validity and the caps.

type EnterpriseRow = {
  id: string
  name: string
  slug: string
  license: { tier: string; maxProperties: number } | null
  _count: { properties: number; users: number }
}

type License = {
  tier: string
  maxProperties: number
  notes: string | null
  propertyCount: number
  status: string
  validFrom: string | null
  expiresAt: string | null
  graceDays: number
  monthlyPrice: number | null
  priceCurrency: string
  state: "ACTIVE" | "GRACE" | "EXPIRED" | "REVOKED" | "UNLICENSED"
  graceEndsAt: string | null
}

type AllowanceRow = {
  propertyId: string
  name: string
  code: string
  status: string
  allowance: { maxRoomTypes: number | null; maxRooms: number | null; maxChannels: number | null } | null
  usage: { roomTypes: number; rooms: number; channelLinks: number }
}

type Invoice = {
  id: string
  invoiceNo: string
  periodStart: string
  periodEnd: string
  amount: number
  currency: string
  status: string
  issuedAt: string
  dueAt: string | null
  paidAt: string | null
  receiptNo: string | null
}

const STATE_BADGE: Record<License["state"], { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-success-muted text-success" },
  GRACE: { label: "In grace period", className: "bg-warning-muted text-warning" },
  EXPIRED: { label: "Expired", className: "bg-destructive-muted text-destructive" },
  REVOKED: { label: "Revoked", className: "bg-destructive-muted text-destructive" },
  UNLICENSED: { label: "No license row", className: "bg-muted text-muted-foreground" },
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"

export function LicensingManager() {
  const [enterprises, setEnterprises] = useState<EnterpriseRow[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [license, setLicense] = useState<License | null>(null)
  const [form, setForm] = useState({
    maxProperties: "1",
    notes: "",
    validFrom: "",
    expiresAt: "",
    graceDays: "7",
    monthlyPrice: "",
    priceCurrency: "USD",
  })
  const [allowances, setAllowances] = useState<AllowanceRow[]>([])
  const [allowanceEdits, setAllowanceEdits] = useState<Record<string, { maxRoomTypes: string; maxRooms: string; maxChannels: string }>>({})
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invForm, setInvForm] = useState<{ period: DateRange | undefined; amount: string; discount: string; currency: string; dueAt: string; notes: string }>({ period: undefined, amount: "", discount: "", currency: "USD", dueAt: "", notes: "" })
  const [payingId, setPayingId] = useState<string | null>(null)
  const [paymentRef, setPaymentRef] = useState("")
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchEnterprises = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/enterprises")
      if (res.ok) {
        const data: EnterpriseRow[] = await res.json()
        setEnterprises(data)
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchEnterprises() }, [fetchEnterprises])

  const fetchLicense = useCallback(async (enterpriseId: string) => {
    const res = await fetch(`/api/licenses?enterpriseId=${enterpriseId}`)
    if (res.ok) {
      const data: License = await res.json()
      setLicense(data)
      setForm({
        maxProperties: String(data.maxProperties),
        notes: data.notes ?? "",
        validFrom: data.validFrom ? data.validFrom.slice(0, 10) : "",
        expiresAt: data.expiresAt ? data.expiresAt.slice(0, 10) : "",
        graceDays: String(data.graceDays),
        monthlyPrice: data.monthlyPrice !== null ? String(data.monthlyPrice) : "",
        priceCurrency: data.priceCurrency,
      })
    }
  }, [])

  const fetchAllowances = useCallback(async (enterpriseId: string) => {
    const res = await fetch(`/api/licenses/allowances?enterpriseId=${enterpriseId}`)
    if (res.ok) {
      const rows: AllowanceRow[] = await res.json()
      setAllowances(rows)
      setAllowanceEdits(
        Object.fromEntries(
          rows.map((r) => [
            r.propertyId,
            {
              maxRoomTypes: r.allowance?.maxRoomTypes != null ? String(r.allowance.maxRoomTypes) : "",
              maxRooms: r.allowance?.maxRooms != null ? String(r.allowance.maxRooms) : "",
              maxChannels: r.allowance?.maxChannels != null ? String(r.allowance.maxChannels) : "",
            },
          ])
        )
      )
    }
  }, [])

  const fetchInvoices = useCallback(async (enterpriseId: string) => {
    const res = await fetch(`/api/osta/license-invoices?enterpriseId=${enterpriseId}`)
    if (res.ok) setInvoices(await res.json())
  }, [])

  useEffect(() => {
    if (selectedId) {
      setConfirmRevoke(false)
      fetchLicense(selectedId)
      fetchAllowances(selectedId)
      fetchInvoices(selectedId)
    }
  }, [selectedId, fetchLicense, fetchAllowances, fetchInvoices])

  const patchLicense = async (payload: Record<string, unknown>) => {
    setSaving(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/licenses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: selectedId, ...payload }),
      })
      if (res.ok) {
        await Promise.all([fetchLicense(selectedId), fetchEnterprises()])
        return true
      }
      const err = await res.json()
      setErrorMsg(err.error || "Failed to save license")
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSaveLicense = async () => {
    const ok = await patchLicense({
      maxProperties: parseInt(form.maxProperties),
      notes: form.notes,
      validFrom: form.validFrom || null,
      expiresAt: form.expiresAt || null,
      graceDays: parseInt(form.graceDays),
      monthlyPrice: form.monthlyPrice === "" ? null : parseFloat(form.monthlyPrice),
      priceCurrency: form.priceCurrency,
    })
    if (ok) toast.success("License saved")
  }

  const handleRevokeToggle = async () => {
    if (license?.status === "REVOKED") {
      if (await patchLicense({ status: "ACTIVE" })) toast.success("License reactivated")
      return
    }
    if (!confirmRevoke) {
      setConfirmRevoke(true)
      return
    }
    setConfirmRevoke(false)
    if (await patchLicense({ status: "REVOKED" })) toast.success("License revoked — enterprise users are locked out")
  }

  const handleSaveAllowance = async (propertyId: string) => {
    const edit = allowanceEdits[propertyId]
    if (!edit) return
    const res = await fetch("/api/licenses/allowances", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        maxRoomTypes: edit.maxRoomTypes === "" ? null : parseInt(edit.maxRoomTypes),
        maxRooms: edit.maxRooms === "" ? null : parseInt(edit.maxRooms),
        maxChannels: edit.maxChannels === "" ? null : parseInt(edit.maxChannels),
      }),
    })
    if (res.ok) {
      toast.success("Allowances saved")
      fetchAllowances(selectedId)
    } else {
      const err = await res.json()
      toast.error(err.error || "Failed to save allowances")
    }
  }

  const handleIssueInvoice = async () => {
    if (!invForm.period?.from || !invForm.period?.to || !invForm.amount) {
      toast.error("Billing period and amount are required")
      return
    }
    const res = await fetch("/api/osta/license-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enterpriseId: selectedId,
        periodStart: invForm.period.from.toISOString(),
        periodEnd: invForm.period.to.toISOString(),
        amount: parseFloat(invForm.amount),
        discountAmount: invForm.discount === "" ? 0 : parseFloat(invForm.discount),
        currency: invForm.currency,
        dueAt: invForm.dueAt || null,
        notes: invForm.notes || null,
      }),
    })
    if (res.ok) {
      toast.success("Invoice issued")
      setInvForm({ period: undefined, amount: "", discount: "", currency: invForm.currency, dueAt: "", notes: "" })
      fetchInvoices(selectedId)
    } else {
      const err = await res.json()
      toast.error(err.error || "Failed to issue invoice")
    }
  }

  const handleMarkPaid = async (id: string) => {
    const res = await fetch(`/api/osta/license-invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markPaid", paymentReference: paymentRef || null }),
    })
    if (res.ok) {
      toast.success("Payment recorded")
      setPayingId(null)
      setPaymentRef("")
      fetchInvoices(selectedId)
    } else {
      const err = await res.json()
      toast.error(err.error || "Failed to record payment")
    }
  }

  const handleVoid = async (id: string) => {
    const res = await fetch(`/api/osta/license-invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "void" }),
    })
    if (res.ok) {
      toast.success("Invoice voided")
      fetchInvoices(selectedId)
    } else {
      const err = await res.json()
      toast.error(err.error || "Failed to void invoice")
    }
  }

  const selected = enterprises.find((e) => e.id === selectedId)

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading enterprises...</div>

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1"><Building2 className="w-4 h-4" /> Enterprise</label>
        <Select value={selectedId} onValueChange={(v) => setSelectedId(v ?? "")}>
          <SelectTrigger className="max-w-md"><SelectValue placeholder="Select an enterprise">{selected?.name}</SelectValue></SelectTrigger>
          <SelectContent>
            {enterprises.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name} ({e.slug})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {enterprises.length === 0 && <p className="text-sm text-muted-foreground">No customer enterprises exist yet.</p>}
      </div>

      {selected && license && (
        <>
          {/* ------------------------------ License ------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> License
                <Badge variant="secondary" className={STATE_BADGE[license.state].className}>{STATE_BADGE[license.state].label}</Badge>
              </CardTitle>
              <CardDescription>
                {selected.name} is using {license.propertyCount} of {license.maxProperties} allowed propert{license.maxProperties === 1 ? "y" : "ies"}.
                {license.state === "GRACE" && license.graceEndsAt && <> Grace period ends <strong>{fmtDate(license.graceEndsAt)}</strong> — users still sign in with a payment warning until then.</>}
                {license.state === "EXPIRED" && <> Users are locked out at sign-in.</>}
                {license.state === "REVOKED" && <> Users are locked out at sign-in.</>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMsg && <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md">{errorMsg}</div>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Monthly Price</label>
                  <div className="flex gap-2">
                    <Input type="number" min={0} step="0.01" className="flex-1" value={form.monthlyPrice} placeholder="Not set"
                      onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} />
                    <Input className="w-20" value={form.priceCurrency} onChange={(e) => setForm({ ...form, priceCurrency: e.target.value.toUpperCase() })} />
                  </div>
                  <p className="text-xs text-muted-foreground">Set manually per enterprise — the attribute caps below restrict, they don&apos;t price.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Valid From</label>
                  <DatePicker value={form.validFrom || null} onChange={(d) => setForm({ ...form, validFrom: d })} placeholder="Not set" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Expires</label>
                  <DatePicker value={form.expiresAt || null} onChange={(d) => setForm({ ...form, expiresAt: d })} placeholder="No expiry" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Grace Period (days)</label>
                  <Input type="number" min={0} value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Properties</label>
                  <Input type="number" min={0} value={form.maxProperties} onChange={(e) => setForm({ ...form, maxProperties: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal note about this license (optional)" />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleSaveLicense} disabled={saving}>
                  {saving ? "Saving..." : "Save License"}
                </Button>
                <Button
                  variant={license.status === "REVOKED" ? "outline" : "destructive"}
                  onClick={handleRevokeToggle}
                  disabled={saving}
                  onBlur={() => setConfirmRevoke(false)}
                >
                  {license.status === "REVOKED" ? "Reactivate License" : confirmRevoke ? "Confirm revoke — locks users out now" : "Revoke License"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ------------------------ Per-property allowances ------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Property Allowances</CardTitle>
              <CardDescription>
                Per-property caps on room types, rooms and channel connections — enforced at creation time.
                Blank = unlimited, 0 = disallowed. PM (pseudo) room types and their rooms never count, and PM
                room types can&apos;t be mapped to channels at all.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {allowances.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">This enterprise has no properties yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Property</th>
                      <th className="py-2 pr-4">Room Types</th>
                      <th className="py-2 pr-4">Rooms</th>
                      <th className="py-2 pr-4">Channels</th>
                      <th className="py-2">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowances.map((row) => {
                      const edit = allowanceEdits[row.propertyId] ?? { maxRoomTypes: "", maxRooms: "", maxChannels: "" }
                      const cell = (usage: number, cap: string, field: keyof typeof edit) => (
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-muted-foreground w-10">{usage} /</span>
                          <Input
                            className="w-20 h-8"
                            type="number" min={0} placeholder="∞"
                            value={cap}
                            onChange={(e) => setAllowanceEdits((prev) => ({ ...prev, [row.propertyId]: { ...edit, [field]: e.target.value } }))}
                          />
                        </div>
                      )
                      return (
                        <tr key={row.propertyId} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">{row.code}</div>
                          </td>
                          <td className="py-2 pr-4">{cell(row.usage.roomTypes, edit.maxRoomTypes, "maxRoomTypes")}</td>
                          <td className="py-2 pr-4">{cell(row.usage.rooms, edit.maxRooms, "maxRooms")}</td>
                          <td className="py-2 pr-4">{cell(row.usage.channelLinks, edit.maxChannels, "maxChannels")}</td>
                          <td className="py-2 text-right">
                            <Button size="sm" variant="outline" onClick={() => handleSaveAllowance(row.propertyId)}>Save</Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* ------------------------------ Invoices ------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><FileText className="w-4 h-4" /> License Invoices</CardTitle>
              <CardDescription>
                Issued under Osta&apos;s own stationery (set up in Controls). Marking an invoice paid stamps the
                payment date and issues a receipt number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto_auto_auto] items-end">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Billing Period</label>
                  <DateRangePicker value={invForm.period} onChange={(r) => setInvForm({ ...invForm, period: r })} placeholder="Select period" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Amount (net)</label>
                  <Input type="number" min={0} step="0.01" className="w-28" value={invForm.amount} onChange={(e) => setInvForm({ ...invForm, amount: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Discount</label>
                  <Input type="number" min={0} step="0.01" className="w-24" value={invForm.discount} placeholder="0" onChange={(e) => setInvForm({ ...invForm, discount: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Currency</label>
                  <Input className="w-20" value={invForm.currency} onChange={(e) => setInvForm({ ...invForm, currency: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Due</label>
                  <DatePicker value={invForm.dueAt || null} onChange={(d) => setInvForm({ ...invForm, dueAt: d })} placeholder="Optional" />
                </div>
                <Button onClick={handleIssueInvoice}>Issue Invoice</Button>
              </div>

              {invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No invoices issued to this enterprise yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4">Invoice</th>
                        <th className="py-2 pr-4">Period</th>
                        <th className="py-2 pr-4 text-right">Amount</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Paid</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="border-b last:border-0 align-top">
                          <td className="py-2 pr-4">
                            <div className="font-medium tabular-nums">{inv.invoiceNo}</div>
                            <div className="text-xs text-muted-foreground">Issued {fmtDate(inv.issuedAt)}{inv.dueAt && <> · due {fmtDate(inv.dueAt)}</>}</div>
                          </td>
                          <td className="py-2 pr-4 whitespace-nowrap">{fmtDate(inv.periodStart)} → {fmtDate(inv.periodEnd)}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{inv.currency} {inv.amount.toFixed(2)}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="secondary" className={
                              inv.status === "PAID" ? "bg-success-muted text-success"
                                : inv.status === "VOID" ? "bg-muted text-muted-foreground"
                                : "bg-info-muted text-info"
                            }>
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">
                            {inv.paidAt ? (
                              <div>
                                <div className="tabular-nums">{fmtDate(inv.paidAt)}</div>
                                {inv.receiptNo && <div className="text-xs text-muted-foreground tabular-nums">{inv.receiptNo}</div>}
                              </div>
                            ) : "—"}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {payingId === inv.id ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Input className="w-36 h-8" placeholder="Payment ref (optional)" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
                                <Button size="sm" onClick={() => handleMarkPaid(inv.id)}>Confirm</Button>
                                <Button size="sm" variant="outline" onClick={() => { setPayingId(null); setPaymentRef("") }}>Cancel</Button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <Button size="sm" variant="outline" aria-label={`Print invoice ${inv.invoiceNo}`} title="Print invoice" onClick={() => window.open(`/osta/license-invoices/${inv.id}/print`, "_blank")}>
                                  <Printer className="h-3.5 w-3.5" />
                                </Button>
                                {inv.status === "PAID" && (
                                  <Button size="sm" variant="outline" aria-label={`Print receipt ${inv.receiptNo ?? ""}`} title="Print payment receipt" onClick={() => window.open(`/osta/license-invoices/${inv.id}/print?doc=receipt`, "_blank")}>
                                    <Receipt className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {inv.status === "ISSUED" && (
                                  <>
                                    <Button size="sm" onClick={() => setPayingId(inv.id)}>Mark Paid</Button>
                                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => handleVoid(inv.id)}>Void</Button>
                                  </>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

        </>
      )}
    </div>
  )
}
