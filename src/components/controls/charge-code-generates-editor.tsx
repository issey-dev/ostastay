"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2, ArrowRightCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import {
  GENERATE_METHODS,
  GENERATE_METHOD_LABELS,
  CALCULATE_ON,
  CALCULATE_ON_LABELS,
  type GenerateMethod,
  type CalculateOn,
} from "@/lib/posting/run-generates"
import { canGenerateTax } from "@/lib/posting/charge-tree"
import type { ChargeCodeRow } from "@/components/controls/charge-codes-manager"

type GenerateRowView = {
  id: string
  generatedCodeId: string
  generatedCode: { id: string; code: string; description: string; postingType: string; isActive: boolean }
  method: string
  value: number
  calculateOn: string
  basisGenerateId: string | null
  sortOrder: number
  isActive: boolean
}

// The generates cascade for one charge code. Rows fire in ascending order, and a later
// row can compound on an earlier one's output — which is what makes a tax-on-tax bucket
// expressible as config rather than code.
export function ChargeCodeGeneratesEditor({
  chargeCode,
  allCodes,
}: {
  chargeCode: ChargeCodeRow
  allCodes: ChargeCodeRow[]
}) {
  const [rows, setRows] = useState<GenerateRowView[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    generatedCodeId: "",
    method: "PERCENT" as GenerateMethod,
    value: "",
    calculateOn: "NET" as CalculateOn,
    basisGenerateId: "",
    sortOrder: "10",
  })

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/charge-codes/${chargeCode.id}/generates`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [chargeCode.id])

  useEffect(() => { fetchRows() }, [fetchRows])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch(`/api/charge-codes/${chargeCode.id}/generates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          value: Number(form.value) || 0,
          sortOrder: Number(form.sortOrder) || 10,
          basisGenerateId: form.calculateOn === "ANOTHER_GENERATE" ? form.basisGenerateId : null,
        }),
      })
      if (res.ok) {
        setAdding(false)
        setForm({ generatedCodeId: "", method: "PERCENT", value: "", calculateOn: "NET", basisGenerateId: "", sortOrder: "10" })
        fetchRows()
      } else {
        toast.error((await res.json().catch(() => null))?.error || "Failed to add generate")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const toggleActive = async (row: GenerateRowView) => {
    const res = await fetch(`/api/charge-codes/${chargeCode.id}/generates/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    })
    if (res.ok) fetchRows()
    else toast.error((await res.json().catch(() => null))?.error || "Failed to update")
  }

  const remove = async (row: GenerateRowView) => {
    const res = await fetch(`/api/charge-codes/${chargeCode.id}/generates/${row.id}`, { method: "DELETE" })
    if (res.ok) fetchRows()
    else toast.error((await res.json().catch(() => null))?.error || "Failed to delete")
  }

  // Tax only ever generates on a sale. On a payment, refund, deposit, commission or
  // adjustment the tax methods aren't offered and tax codes aren't offered as targets —
  // that money has already been taxed. The API refuses these too, so the UI is a
  // courtesy rather than the guard.
  const taxAllowed = canGenerateTax(chargeCode.postingType)
  const availableMethods = GENERATE_METHODS.filter(
    (m) => taxAllowed || (m !== "SERVICE_CHARGE" && m !== "GST" && m !== "GREEN_TAX")
  )

  // Never offer the code itself, nor a target it already generates.
  const taken = new Set(rows.map((r) => r.generatedCodeId))
  const targetOptions = allCodes
    .filter((c) => c.id !== chargeCode.id && !taken.has(c.id) && c.isActive)
    .filter((c) => taxAllowed || c.postingType !== "TAX")
    .map((c) => ({ label: `${c.code} — ${c.description}`, value: c.id }))

  const describeAmount = (r: GenerateRowView) => {
    // The three Tax-config methods carry no rate of their own — they route what the one
    // default Maldives rule already resolved, which is exactly why every group can have
    // its own codes without any of them drifting.
    if (r.method === "SERVICE_CHARGE") return "Service Charge, from Tax config"
    if (r.method === "GST") return "GST, from Tax config"
    if (r.method === "GREEN_TAX") return "Green Tax, from Tax config"
    if (r.method === "FLAT") return `${r.value.toFixed(2)} flat`
    if (r.method === "PER_PERSON_PER_NIGHT") return `${r.value.toFixed(2)} / person / night`
    const basis = r.calculateOn === "ANOTHER_GENERATE"
      ? rows.find((x) => x.id === r.basisGenerateId)?.generatedCode.code ?? "—"
      : r.calculateOn === "GROSS" ? "gross" : "net"
    return `${r.value}% of ${basis}`
  }

  if (loading) return <Skeleton className="h-32 rounded-lg" />

  // SERVICE_CHARGE / GST / GREEN_TAX all read the enterprise's Maldives Tax config, so
  // there is no rate to type here — only the destination code matters.
  const fromTaxConfig = form.method === "SERVICE_CHARGE" || form.method === "GST" || form.method === "GREEN_TAX"
  const valueApplies = !fromTaxConfig
  const basisApplies = form.method === "PERCENT"

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/80">
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Generates</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                <TableCell className="text-muted-foreground text-sm">{r.sortOrder}</TableCell>
                <TableCell>
                  <span className="font-mono font-medium">{r.generatedCode.code}</span>
                  <span className="text-muted-foreground text-sm ml-2">{r.generatedCode.description}</span>
                  {!r.isActive && <Badge variant="outline" className="ml-2 font-normal">Off</Badge>}
                </TableCell>
                <TableCell className="text-sm">{describeAmount(r)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(r)}>
                      {r.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-muted" onClick={() => remove(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-0">
                  <EmptyState icon={ArrowRightCircle} title="This code generates nothing" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!taxAllowed && (
        <p className="text-xs text-muted-foreground">
          This is not a sale, so tax can&apos;t be generated on it — a payment, refund,
          deposit, commission or adjustment moves money that has already been taxed.
        </p>
      )}

      {!adding ? (
        <Button variant="outline" size="sm" onClick={() => { setForm((p) => ({ ...p, method: availableMethods[0] })); setAdding(true) }}>
          <Plus className="w-4 h-4 mr-2" /> Add Generate
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Generates *</Label>
              <SearchableSelect
                required
                value={form.generatedCodeId}
                onChange={(v) => setForm((p) => ({ ...p, generatedCodeId: v ?? "" }))}
                placeholder="Select charge code..."
                options={targetOptions}
              />
            </div>
            <div className="space-y-2">
              <Label>Method *</Label>
              <Select value={form.method} onValueChange={(v) => setForm((p) => ({ ...p, method: (v ?? "PERCENT") as GenerateMethod }))}>
                <SelectTrigger><SelectValue>{GENERATE_METHOD_LABELS[form.method]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {availableMethods.map((m) => <SelectItem key={m} value={m}>{GENERATE_METHOD_LABELS[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {valueApplies && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{form.method === "PERCENT" ? "Rate (%)" : "Amount"} *</Label>
                <Input
                  type="number" step="0.01" min="0" required
                  value={form.value}
                  onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                />
              </div>
              {basisApplies && (
                <div className="space-y-2">
                  <Label>Calculate On *</Label>
                  <Select value={form.calculateOn} onValueChange={(v) => setForm((p) => ({ ...p, calculateOn: (v ?? "NET") as CalculateOn }))}>
                    <SelectTrigger><SelectValue>{CALCULATE_ON_LABELS[form.calculateOn]}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {CALCULATE_ON.map((c) => (
                        <SelectItem key={c} value={c} disabled={c === "ANOTHER_GENERATE" && rows.length === 0}>
                          {CALCULATE_ON_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {basisApplies && form.calculateOn === "ANOTHER_GENERATE" && (
            <div className="space-y-2">
              <Label>Compound On *</Label>
              <SearchableSelect
                required
                value={form.basisGenerateId}
                onChange={(v) => setForm((p) => ({ ...p, basisGenerateId: v ?? "" }))}
                placeholder="Select an earlier generate..."
                options={rows.map((r) => ({ label: `${r.generatedCode.code} — ${r.generatedCode.description}`, value: r.id }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Make sure this row&apos;s order number is higher than the one it compounds on —
                a basis that hasn&apos;t run yet contributes nothing.
              </p>
            </div>
          )}

          {fromTaxConfig && (
            <p className="text-xs text-muted-foreground">
              This reads its rate — and whether it applies at all — from Finance &gt; Tax
              &gt; Maldives Tax. Nothing to enter here: pick the destination code and the
              amount follows the property&apos;s one tax rule, so every group stays in step
              while still posting to its own code.
            </p>
          )}

          <div className="space-y-2 max-w-[8rem]">
            <Label>Order</Label>
            <Input type="number" min="0" value={form.sortOrder} onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting}>Add</Button>
          </div>
        </form>
      )}
    </div>
  )
}
