"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Printer, FileText, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"

type DateItem = { businessDate: string; generatedAt: string }
type ReportsPayload = {
  businessDate: string
  labels: Record<string, string>
  order: string[]
  reports: Record<string, any>
}

const n2 = (v: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function EodReportsPage() {
  const { currentProperty } = useProperty()
  const [dates, setDates] = useState<DateItem[]>([])
  const [selected, setSelected] = useState<string>("")
  const [payload, setPayload] = useState<ReportsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingReports, setLoadingReports] = useState(false)

  const isoDay = (iso: string) => iso.slice(0, 10)

  useEffect(() => {
    if (!currentProperty) return
    setLoading(true)
    fetch(`/api/eod/reports?propertyId=${currentProperty.id}`)
      .then((r) => r.json())
      .then((d) => {
        const list: DateItem[] = d.dates ?? []
        setDates(list)
        if (list.length > 0) setSelected(isoDay(list[0].businessDate))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentProperty])

  const loadReports = useCallback(async (day: string) => {
    if (!currentProperty || !day) return
    setLoadingReports(true)
    try {
      const res = await fetch(`/api/eod/reports?propertyId=${currentProperty.id}&date=${day}`)
      if (res.ok) setPayload(await res.json())
      else setPayload(null)
    } finally {
      setLoadingReports(false)
    }
  }, [currentProperty])

  useEffect(() => { if (selected) loadReports(selected) }, [selected, loadReports])

  const dateOptions = useMemo(
    () => dates.map((d) => ({ value: isoDay(d.businessDate), label: format(new Date(d.businessDate), "EEEE, dd MMM yyyy") })),
    [dates]
  )

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 print:hidden">
        <div>
          <Link href="../night-audit" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> End of Day
          </Link>
          <h2 className="text-3xl font-bold tracking-tight">EOD Report Archive</h2>
          <p className="text-muted-foreground">Frozen snapshots of each closed business date's reports.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-64">
            <SearchableSelect
              value={selected}
              onChange={(v) => setSelected(v ?? "")}
              placeholder="Select date..."
              options={dateOptions}
            />
          </div>
          <Button variant="outline" onClick={() => window.print()} disabled={!payload}>
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
        </div>
      </div>

      {dates.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No reports yet. They are generated during the End-of-Day reports step.</p>
        </div>
      )}

      {loadingReports && <Skeleton className="h-64 rounded-xl" />}

      {!loadingReports && payload && (
        <div className="space-y-8">
          <div className="hidden print:block">
            <h1 className="text-2xl font-bold">{currentProperty?.name}</h1>
            <p className="text-sm">Business date: {format(new Date(payload.businessDate), "EEEE, dd MMM yyyy")}</p>
          </div>
          {payload.order.map((type) => (
            <ReportBlock key={type} title={payload.labels[type] ?? type} type={type} data={payload.reports[type]} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReportBlock({ title, type, data }: { title: string; type: string; data: any }) {
  if (!data) return null
  return (
    <section className="rounded-xl border border-border bg-card p-6 print:border-0 print:p-0 print:break-inside-avoid">
      <h3 className="text-lg font-semibold mb-4 pb-2 border-b border-border">{title}</h3>
      {type === "TRIAL_BALANCE" && <TrialBalance d={data} />}
      {type === "GUEST_LEDGER" && <LedgerTable d={data} kind="guest" />}
      {type === "AR_LEDGER" && <LedgerTable d={data} kind="ar" />}
      {type === "DEPOSIT_LEDGER" && <DepositLedger d={data} />}
      {type === "CASHIER_SUMMARY" && <CashierSummary d={data} />}
      {type === "MANAGER_FLASH" && <ManagerFlash d={data} />}
    </section>
  )
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`py-2 px-2 text-xs font-medium text-muted-foreground ${right ? "text-right" : "text-left"}`}>{children}</th>
)
const Td = ({ children, right, bold }: { children?: React.ReactNode; right?: boolean; bold?: boolean }) => (
  <td className={`py-1.5 px-2 text-sm ${right ? "text-right tabular-nums" : ""} ${bold ? "font-semibold" : ""}`}>{children}</td>
)
const Empty = ({ msg }: { msg: string }) => <p className="text-sm text-muted-foreground py-2">{msg}</p>

function TrialBalance({ d }: { d: any }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Debits — charges posted</p>
        <table className="w-full">
          <thead><tr className="border-b border-border"><Th>Category</Th><Th right>Amount</Th><Th right>Tax</Th><Th right>Total</Th></tr></thead>
          <tbody>
            {d.charges.byCategory.length === 0 && <tr><td colSpan={4}><Empty msg="No charges posted." /></td></tr>}
            {d.charges.byCategory.map((c: any) => (
              <tr key={c.category} className="border-b border-border/50">
                <Td>{c.category}</Td><Td right>{n2(c.amount)}</Td><Td right>{n2(c.tax + c.serviceCharge)}</Td><Td right>{n2(c.total)}</Td>
              </tr>
            ))}
            <tr><Td bold>Total debits</Td><Td></Td><Td></Td><Td right bold>{n2(d.charges.total)}</Td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">Credits — payments received</p>
        <table className="w-full">
          <thead><tr className="border-b border-border"><Th>Method</Th><Th right>Received</Th><Th right>Refunded</Th><Th right>Net</Th></tr></thead>
          <tbody>
            {d.payments.byMethod.length === 0 && <tr><td colSpan={4}><Empty msg="No payments received." /></td></tr>}
            {d.payments.byMethod.map((m: any) => (
              <tr key={m.method} className="border-b border-border/50">
                <Td>{m.method}</Td><Td right>{n2(m.received)}</Td><Td right>{n2(m.refunded)}</Td><Td right>{n2(m.net)}</Td>
              </tr>
            ))}
            <tr><Td bold>Total credits</Td><Td></Td><Td></Td><Td right bold>{n2(d.payments.total)}</Td></tr>
          </tbody>
        </table>
        <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-1">Closing ledger positions</p>
          <div className="flex justify-between"><span>Guest Ledger</span><span className="tabular-nums font-medium">{n2(d.ledgers.guestLedger)}</span></div>
          <div className="flex justify-between"><span>AR Ledger</span><span className="tabular-nums font-medium">{n2(d.ledgers.arLedger)}</span></div>
          <div className="flex justify-between"><span>Deposit Ledger</span><span className="tabular-nums font-medium">{n2(d.ledgers.depositLedger)}</span></div>
        </div>
      </div>
    </div>
  )
}

function LedgerTable({ d, kind }: { d: any; kind: "guest" | "ar" }) {
  if (d.rows.length === 0) return <Empty msg={kind === "guest" ? "No open in-house folios." : "No outstanding debtor balances."} />
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border">
          <Th>Confirmation</Th>
          {kind === "ar" ? <Th>Account</Th> : <Th>Room</Th>}
          <Th>Guest</Th><Th right>Charges</Th><Th right>Payments</Th><Th right>Balance</Th>
        </tr>
      </thead>
      <tbody>
        {d.rows.map((r: any) => (
          <tr key={r.folioId} className="border-b border-border/50">
            <Td>{r.confirmationNo ?? "—"}</Td>
            {kind === "ar" ? <Td>{r.account}</Td> : <Td>{r.room}</Td>}
            <Td>{r.guest}</Td><Td right>{n2(r.charges)}</Td><Td right>{n2(r.payments)}</Td><Td right bold>{n2(r.balance)}</Td>
          </tr>
        ))}
        <tr>
          <Td bold>Total</Td><Td></Td><Td></Td>
          <Td right bold>{n2(d.totals.charges)}</Td><Td right bold>{n2(d.totals.payments)}</Td><Td right bold>{n2(d.totals.balance)}</Td>
        </tr>
      </tbody>
    </table>
  )
}

function DepositLedger({ d }: { d: any }) {
  if (d.rows.length === 0) return <Empty msg="No pre-arrival deposits held." />
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border"><Th>Confirmation</Th><Th>Guest</Th><Th>Arrival</Th><Th right>Deposit</Th><Th right>Charges</Th><Th right>Credit held</Th></tr>
      </thead>
      <tbody>
        {d.rows.map((r: any) => (
          <tr key={r.folioId} className="border-b border-border/50">
            <Td>{r.confirmationNo ?? "—"}</Td><Td>{r.guest}</Td>
            <Td>{r.arrivalDate ? format(new Date(r.arrivalDate), "dd MMM yyyy") : "—"}</Td>
            <Td right>{n2(r.deposit)}</Td><Td right>{n2(r.charges)}</Td><Td right bold>{n2(r.creditHeld)}</Td>
          </tr>
        ))}
        <tr>
          <Td bold>Total</Td><Td></Td><Td></Td>
          <Td right bold>{n2(d.totals.deposit)}</Td><Td right bold>{n2(d.totals.charges)}</Td><Td right bold>{n2(d.totals.creditHeld)}</Td>
        </tr>
      </tbody>
    </table>
  )
}

function CashierSummary({ d }: { d: any }) {
  if (d.rows.length === 0) return <Empty msg="No collections recorded for the day." />
  return (
    <div className="space-y-4">
      {d.rows.map((r: any) => (
        <div key={r.userId} className="rounded-lg border border-border/70 p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="font-medium text-sm">{r.user}</span>
            <span className="text-sm tabular-nums font-semibold">Net {n2(r.net)}</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border"><Th>Method</Th><Th right>Received</Th><Th right>Refunded</Th><Th right>Net</Th></tr></thead>
            <tbody>
              {r.byMethod.map((m: any) => (
                <tr key={m.method} className="border-b border-border/50">
                  <Td>{m.method}</Td><Td right>{n2(m.received)}</Td><Td right>{n2(m.refunded)}</Td><Td right>{n2(m.net)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-2 text-sm font-semibold">
        <span>Total collections</span><span className="tabular-nums">{n2(d.totals.net)}</span>
      </div>
    </div>
  )
}

function ManagerFlash({ d }: { d: any }) {
  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Occupancy" value={`${n2(d.occupancy.occupancyPct)}%`} />
        <Stat label="Rooms occupied" value={`${d.occupancy.roomsOccupied} / ${d.occupancy.roomsAvailable}`} />
        <Stat label="ADR" value={n2(d.occupancy.adr)} />
        <Stat label="RevPAR" value={n2(d.occupancy.revPar)} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Revenue by category</p>
          <table className="w-full">
            <thead><tr className="border-b border-border"><Th>Category</Th><Th right>Total</Th></tr></thead>
            <tbody>
              {d.revenue.byCategory.length === 0 && <tr><td colSpan={2}><Empty msg="No revenue posted." /></td></tr>}
              {d.revenue.byCategory.map((c: any) => (
                <tr key={c.category} className="border-b border-border/50"><Td>{c.category}</Td><Td right>{n2(c.total)}</Td></tr>
              ))}
              <tr><Td bold>Total revenue</Td><Td right bold>{n2(d.revenue.total)}</Td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Activity</p>
          <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Arrivals</span><span className="tabular-nums font-medium">{d.activity.arrivals}</span></div>
            <div className="flex justify-between"><span>Departures</span><span className="tabular-nums font-medium">{d.activity.departures}</span></div>
            <div className="flex justify-between"><span>No-shows</span><span className="tabular-nums font-medium">{d.activity.noShows}</span></div>
            <div className="flex justify-between"><span>In-house</span><span className="tabular-nums font-medium">{d.activity.inHouse}</span></div>
          </div>
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Room revenue</span><span className="tabular-nums font-medium">{n2(d.revenue.roomRevenue)}</span></div>
            <div className="flex justify-between"><span>Other revenue</span><span className="tabular-nums font-medium">{n2(d.revenue.otherRevenue)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
