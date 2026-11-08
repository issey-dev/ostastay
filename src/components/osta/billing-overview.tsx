"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ReceiptText } from "@/components/icons"
import { FilterBar } from "@/components/ui/filter-bar"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUrlState } from "@/lib/use-url-state"
import { cn } from "@/lib/utils"
import type { BillingInvoice, EnterpriseBilling } from "@/lib/osta/billing"
import { fmtMoney } from "@/lib/osta/format"

// The tables of the Osta Billing overview (src/app/osta/billing/page.tsx). Read-only:
// every row opens the enterprise's Billing tab, where invoices are issued and paid.

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—"

const VIEWS = ["invoices", "payments", "enterprises"] as const
type View = (typeof VIEWS)[number]
const STATUS = ["all", "unpaid", "overdue", "paid", "void"] as const
type Status = (typeof STATUS)[number]
const STATUS_LABEL: Record<Status, string> = { all: "All", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", void: "Void" }

const billingHref = (enterpriseId: string) => `/osta/enterprises/${enterpriseId}?tab=billing`

function InvoiceStatus({ i }: { i: BillingInvoice }) {
  if (i.status === "PAID") return <StatusBadge label="Paid" tone="success" dot />
  if (i.status === "VOID") return <StatusBadge label="Void" tone="neutral" dot />
  return i.overdue ? <StatusBadge label="Overdue" tone="danger" dot /> : <StatusBadge label="Unpaid" tone="warning" dot />
}

const inStatus = (i: BillingInvoice, s: Status) =>
  s === "all" ||
  (s === "unpaid" && i.status === "ISSUED") ||
  (s === "overdue" && i.overdue) ||
  (s === "paid" && i.status === "PAID") ||
  (s === "void" && i.status === "VOID")

export function BillingTables({ invoices, enterprises }: { invoices: BillingInvoice[]; enterprises: EnterpriseBilling[] }) {
  const router = useRouter()
  const [view, setView] = useUrlState<View>("view", "invoices", VIEWS)
  const [status, setStatus] = useUrlState<Status>("status", "all", STATUS)
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const match = (...s: (string | null)[]) => !needle || s.some((x) => x?.toLowerCase().includes(needle))

  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s, invoices.filter((i) => inStatus(i, s)).length])) as Record<Status, number>, [invoices])
  const payments = useMemo(() => invoices.filter((i) => i.status === "PAID" && i.paidAt).sort((a, b) => b.paidAt!.localeCompare(a.paidAt!)), [invoices])

  const invoiceRows = invoices.filter((i) => inStatus(i, status) && match(i.invoiceNo, i.enterpriseName))
  const paymentRows = payments.filter((i) => match(i.invoiceNo, i.enterpriseName, i.receiptNo, i.paymentReference))
  const enterpriseRows = enterprises.filter((e) => match(e.enterpriseName))

  const invoiceCols: ListColumn<BillingInvoice>[] = [
    { key: "no", header: "Invoice", primary: true, sortValue: (i) => i.invoiceNo, cell: (i) => <span className="font-mono">{i.invoiceNo}</span> },
    { key: "ent", header: "Enterprise", sortValue: (i) => i.enterpriseName, cell: (i) => i.enterpriseName },
    { key: "period", header: "Period", sortValue: (i) => i.periodStart, csv: (i) => `${i.periodStart.slice(0, 10)} to ${i.periodEnd.slice(0, 10)}`, cell: (i) => <span className="whitespace-nowrap">{fmtDate(i.periodStart)} → {fmtDate(i.periodEnd)}</span> },
    { key: "issued", header: "Issued", sortValue: (i) => i.issuedAt, cell: (i) => <span className="whitespace-nowrap">{fmtDate(i.issuedAt)}</span> },
    { key: "due", header: "Due", sortValue: (i) => i.dueAt ?? "", cell: (i) => <span className={cn("whitespace-nowrap", i.overdue && "font-semibold text-destructive")}>{fmtDate(i.dueAt)}</span> },
    { key: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount, cell: (i) => <span className={cn("whitespace-nowrap tabular-nums", i.status === "VOID" && "text-muted-foreground line-through")}>{fmtMoney(i.amount, i.currency)}</span> },
    { key: "status", header: "Status", sortValue: (i) => (i.overdue ? "OVERDUE" : i.status), cell: (i) => <InvoiceStatus i={i} /> },
  ]

  const paymentCols: ListColumn<BillingInvoice>[] = [
    { key: "paid", header: "Paid", primary: true, sortValue: (i) => i.paidAt, cell: (i) => <span className="whitespace-nowrap">{fmtDate(i.paidAt)}</span> },
    { key: "ent", header: "Enterprise", sortValue: (i) => i.enterpriseName, cell: (i) => i.enterpriseName },
    { key: "receipt", header: "Receipt", sortValue: (i) => i.receiptNo ?? "", cell: (i) => <span className="font-mono">{i.receiptNo ?? "—"}</span> },
    { key: "no", header: "For invoice", sortValue: (i) => i.invoiceNo, cell: (i) => <span className="font-mono">{i.invoiceNo}</span> },
    { key: "ref", header: "Reference", sortValue: (i) => i.paymentReference ?? "", cell: (i) => i.paymentReference ?? <span className="text-muted-foreground">—</span> },
    { key: "amount", header: "Amount", align: "right", sortValue: (i) => i.amount, cell: (i) => <span className="whitespace-nowrap tabular-nums">{fmtMoney(i.amount, i.currency)}</span> },
  ]

  const LICENCE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
    ACTIVE: { label: "Active", tone: "success" },
    GRACE: { label: "Grace", tone: "warning" },
    EXPIRED: { label: "Expired", tone: "danger" },
    REVOKED: { label: "Revoked", tone: "danger" },
    UNLICENSED: { label: "No licence", tone: "neutral" },
  }
  const enterpriseCols: ListColumn<EnterpriseBilling>[] = [
    { key: "ent", header: "Enterprise", primary: true, sortValue: (e) => e.enterpriseName, cell: (e) => e.enterpriseName },
    { key: "licence", header: "Licence", sortValue: (e) => e.licenseState, cell: (e) => <StatusBadge label={LICENCE[e.licenseState]?.label ?? e.licenseState} tone={LICENCE[e.licenseState]?.tone ?? "neutral"} dot /> },
    { key: "expires", header: "Expires", sortValue: (e) => e.expiresAt ?? "", cell: (e) => <span className="whitespace-nowrap">{e.expiresAt ? fmtDate(e.expiresAt) : "No expiry"}</span> },
    { key: "monthly", header: "Monthly", align: "right", sortValue: (e) => e.monthly ?? 0, cell: (e) => (e.monthly ? <span className="whitespace-nowrap tabular-nums">{fmtMoney(e.monthly, e.currency)}</span> : <span className="text-muted-foreground">Not set</span>) },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      sortValue: (e) => e.outstanding,
      cell: (e) =>
        e.outstanding === 0 ? <span className="text-muted-foreground">—</span> : (
          <span className={cn("whitespace-nowrap tabular-nums", e.overdue > 0 && "font-semibold text-destructive")}>
            {fmtMoney(e.outstanding, e.currency)}
            {e.overdue > 0 && <span className="ml-1 text-xs font-normal">· overdue</span>}
          </span>
        ),
    },
    { key: "ytd", header: "Paid this year", align: "right", sortValue: (e) => e.paidThisYear, cell: (e) => (e.paidThisYear ? <span className="whitespace-nowrap tabular-nums">{fmtMoney(e.paidThisYear, e.currency)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: "last", header: "Last payment", sortValue: (e) => e.lastPaidAt ?? "", cell: (e) => <span className="whitespace-nowrap">{fmtDate(e.lastPaidAt)}</span> },
  ]

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList variant="line" className="h-10 w-full justify-start overflow-x-auto data-horizontal:h-10">
          <TabsTrigger value="invoices" className="flex-none">Invoices <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{invoices.length}</span></TabsTrigger>
          <TabsTrigger value="payments" className="flex-none">Payments recorded <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{payments.length}</span></TabsTrigger>
          <TabsTrigger value="enterprises" className="flex-none">By enterprise <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{enterprises.length}</span></TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        {view === "invoices" &&
          STATUS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cn(
                "h-8 border px-3 text-sm",
                status === s ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                s === "overdue" && counts.overdue > 0 && status !== s && "border-destructive/50 text-destructive"
              )}
            >
              {STATUS_LABEL[s]} <span className="ml-1 font-mono text-[11px] opacity-70 tabular-nums">{counts[s]}</span>
            </button>
          ))}
        <div className="min-w-56 flex-1">
          <FilterBar
            search={{ value: q, onChange: setQ, placeholder: view === "enterprises" ? "Enterprise" : "Invoice no., enterprise, receipt" }}
            activeCount={q ? 1 : 0}
            onClear={() => setQ("")}
          />
        </div>
      </div>

      {view === "invoices" && (
        <ListTable
          rows={invoiceRows}
          columns={invoiceCols}
          rowKey={(i) => i.id}
          rowHref={(i) => billingHref(i.enterpriseId)}
          defaultSort={{ key: "issued", dir: "desc" }}
          exportName="invoices"
          empty={{ icon: ReceiptText, title: invoices.length === 0 ? "No invoices yet" : "No invoices match", description: invoices.length === 0 ? "Issue one from an enterprise's Billing tab." : undefined }}
          mobile={
            <MobileCardList>
              {invoiceRows.map((i) => (
                <MobileCard key={i.id} onClick={() => router.push(billingHref(i.enterpriseId))} title={i.invoiceNo} subtitle={i.enterpriseName} badge={<InvoiceStatus i={i} />} meta={[{ label: "Amount", value: fmtMoney(i.amount, i.currency) }, { label: "Due", value: fmtDate(i.dueAt) }]} />
              ))}
            </MobileCardList>
          }
        />
      )}
      {view === "payments" && (
        <ListTable
          rows={paymentRows}
          columns={paymentCols}
          rowKey={(i) => i.id}
          rowHref={(i) => billingHref(i.enterpriseId)}
          defaultSort={{ key: "paid", dir: "desc" }}
          exportName="payments"
          empty={{ icon: ReceiptText, title: payments.length === 0 ? "No payments recorded yet" : "No payments match", description: payments.length === 0 ? "Mark an invoice paid on the enterprise's Billing tab." : undefined }}
        />
      )}
      {view === "enterprises" && (
        <ListTable
          rows={enterpriseRows}
          columns={enterpriseCols}
          rowKey={(e) => e.enterpriseId}
          rowHref={(e) => billingHref(e.enterpriseId)}
          defaultSort={{ key: "outstanding", dir: "desc" }}
          exportName="billing-by-enterprise"
          empty={{ icon: ReceiptText, title: "No customer enterprises yet" }}
        />
      )}
    </div>
  )
}
