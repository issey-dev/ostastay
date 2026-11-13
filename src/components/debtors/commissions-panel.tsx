"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Percent } from "@/components/icons"
import { usePermissions } from "@/hooks/use-permissions"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { SETTLEMENT_MODE_LABELS, isSettlementMode } from "@/lib/booking-markers"

// Debtors › Commissions (Agent Portal plan A-19, §8). The commission ledger for this
// property: what each agent earned at check-out, on the room rate without service charge and
// tax. NETTED rows were credited on the agent's own invoice; ACCRUED rows are owed to the
// agent: approve them, then record a payout or an offset against the agent's invoices.

type Row = {
  id: string
  profileId: string
  profileName: string
  reservation: { confirmationNo: string; agentRef: string | null } | null
  baseAmount: number
  rate: number
  amount: number
  mode: string
  status: string
  businessDate: string
}

const STATUS_TONE: Record<string, string> = { ACCRUED: "PENDING", APPROVED: "APPROVED", PAID: "PAID", NETTED: "INACTIVE", REVERSED: "VOID" }
const money = (n: number) => n.toFixed(2)

export function CommissionsPanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [status, setStatus] = useState("OPEN")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [method, setMethod] = useState("BANK_TRANSFER")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  const { has, can } = usePermissions()
  const canPay = can("DEBTORS", "update") && has("debtors.payCommission")

  const load = useCallback(async () => {
    const res = await fetch(`/api/debtors/commissions?propertyId=${propertyId}`)
    setRows(res.ok ? await res.json() : [])
    setSelected(new Set())
  }, [propertyId])
  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(
    () => (rows ?? []).filter((r) => (status === "OPEN" ? r.status === "ACCRUED" || r.status === "APPROVED" : status === "ALL" ? true : r.status === status)),
    [rows, status]
  )
  const owed = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) if (r.status === "ACCRUED" || r.status === "APPROVED") m.set(r.profileName, (m.get(r.profileName) ?? 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])
  const picked = shown.filter((r) => selected.has(r.id))
  const oneAgent = new Set(picked.map((r) => r.profileId)).size === 1
  const pickedTotal = picked.reduce((s, r) => s + r.amount, 0)

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch("/api/debtors/commissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyId, ...body }) })
      if (!res.ok) {
        toast.error(await apiError(res, "That didn't work."))
        return false
      }
      toast.success(ok)
      load()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <Skeleton className="h-48 w-full" />
  return (
    <div className="space-y-4">
      {owed.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {owed.map(([name, total]) => (
            <div key={name} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Owed to {name}</p>
              <p className="text-lg font-semibold tabular-nums">{money(total)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-52">
          <SearchableSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "OPEN", label: "To pay (accrued and approved)" },
              { value: "ACCRUED", label: "Accrued" },
              { value: "APPROVED", label: "Approved" },
              { value: "PAID", label: "Paid" },
              { value: "NETTED", label: "Netted on invoices" },
              { value: "REVERSED", label: "Reversed" },
              { value: "ALL", label: "All" },
            ]}
          />
        </div>
        {canPay && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || !picked.some((r) => r.status === "ACCRUED")} onClick={() => post({ action: "approve", ids: picked.map((r) => r.id) }, "Approved")}>
              Approve
            </Button>
            <Button size="sm" disabled={busy || picked.length === 0 || !oneAgent} onClick={() => setPaying(true)} title={!oneAgent && picked.length ? "Pay one agent at a time" : undefined}>
              Pay or offset{picked.length ? ` (${money(pickedTotal)})` : ""}
            </Button>
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Percent} title="No commission here" description="Commission is recorded when a booking from a travel agent or source checks out." />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              {canPay && (r.status === "ACCRUED" || r.status === "APPROVED") ? (
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={(v) => setSelected((p) => { const n = new Set(p); if (v) n.add(r.id); else n.delete(r.id); return n })}
                  aria-label={`Select ${r.reservation?.confirmationNo ?? r.id}`}
                />
              ) : (
                <span className="w-4" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.profileName}</p>
                <p className="text-xs text-muted-foreground">
                  {r.reservation?.confirmationNo}
                  {r.reservation?.agentRef ? ` · ${r.reservation.agentRef}` : ""} · {format(new Date(r.businessDate), "d MMM yyyy")} ·{" "}
                  {isSettlementMode(r.mode) ? SETTLEMENT_MODE_LABELS[r.mode] : r.mode}
                </p>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{r.rate}% of {money(r.baseAmount)}</span>
              <span className="w-20 text-right font-semibold tabular-nums">{money(r.amount)}</span>
              <StatusBadge label={r.status.charAt(0) + r.status.slice(1).toLowerCase()} status={STATUS_TONE[r.status] ?? r.status} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent size="sm" mobile="sheet">
          <DialogHeader>
            <DialogTitle>Pay {money(pickedTotal)} to {picked[0]?.profileName}</DialogTitle>
            <DialogDescription>Record how the commission was settled. Offset means it was taken off what the agent owes on their invoices.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>Method</Label>
              <SearchableSelect
                value={method}
                onChange={setMethod}
                options={[
                  { value: "BANK_TRANSFER", label: "Bank transfer" },
                  { value: "CASH", label: "Cash" },
                  { value: "CHEQUE", label: "Cheque" },
                  { value: "OFFSET", label: "Offset against the agent's invoices" },
                ]}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cm-ref">Reference</Label>
              <Input id="cm-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(false)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await post({ action: "pay", ids: picked.map((r) => r.id), method, reference }, "Commission recorded as paid")) {
                  setPaying(false)
                  setReference("")
                }
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
