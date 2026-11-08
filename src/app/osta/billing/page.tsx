import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { WidgetReveal } from "@/components/dashboard/motion-kit"
import { BillingTables } from "@/components/osta/billing-overview"
import { getBillingOverview } from "@/lib/osta/billing"
import { fmtMoney, fmtMoneyByCurrency } from "@/lib/osta/format"
import { cn } from "@/lib/utils"

// Osta → Billing: one read-only place for the money side (owner, 2026-11-08). What is
// owed, what came in, what should be invoiced next. Issuing an invoice and recording a
// payment stay on the enterprise's Billing tab — every row here links there.

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

function Kpi({ label, value, sub, tone, href }: { label: string; value: string; sub?: React.ReactNode; tone?: "danger"; href?: string }) {
  const body = (
    <>
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tone === "danger" && "text-destructive")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </>
  )
  const cls = cn("block border bg-card p-4 shadow-elevation-1", tone === "danger" && "border-destructive/50", href && "hover:bg-muted/40")
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

export default async function OstaBillingPage() {
  const data = await getBillingOverview()
  const k = data.kpis
  const monthName = new Date(data.now).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        tabTitle="Billing · Osta"
        description="Invoices, payments and what is due next, across every enterprise."
        hint={<>Read-only. To issue an invoice or record a payment, open the enterprise and use its Billing tab — every row here links there.</>}
      />

      <WidgetReveal index={0}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Outstanding" value={fmtMoneyByCurrency(k.outstanding)} sub={`${k.outstandingCount} unpaid ${k.outstandingCount === 1 ? "invoice" : "invoices"}`} href="/osta/billing?status=unpaid" />
          <Kpi
            label="Overdue"
            value={fmtMoneyByCurrency(k.overdue)}
            tone={k.overdueCount > 0 ? "danger" : undefined}
            sub={k.overdueCount > 0 ? `${k.overdueCount} past the due date` : "nothing past due"}
            href="/osta/billing?status=overdue"
          />
          <Kpi label={`Collected · ${monthName}`} value={fmtMoneyByCurrency(k.collectedMonth)} sub={<>last month {fmtMoneyByCurrency(k.collectedPrevMonth)}</>} href="/osta/billing?view=payments" />
          <Kpi label={`Invoiced · ${monthName}`} value={fmtMoneyByCurrency(k.invoicedMonth)} sub="issued this month, not void" />
          <Kpi label="Monthly recurring" value={fmtMoneyByCurrency(k.mrr)} sub="active and grace licences" href="/osta/billing?view=enterprises" />
        </div>
      </WidgetReveal>

      <WidgetReveal index={1}>
        <section className="border bg-card shadow-elevation-1">
          <div className="flex items-center gap-3 border-b px-4 py-3 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
            <h2 className="text-base font-semibold">Up next to invoice</h2>
            <span className="text-xs text-muted-foreground">monthly periods starting in the next 30 days that have no invoice yet</span>
          </div>
          {data.upcoming.length === 0 ? (
            <div className="p-4">
              <EmptyState size="inline" title="Nothing to invoice in the next 30 days." />
            </div>
          ) : (
            <ul className="divide-y">
              {data.upcoming.map((u) => (
                <li key={u.enterpriseId}>
                  <Link href={`/osta/enterprises/${u.enterpriseId}?tab=billing`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/50">
                    <span className="min-w-40 flex-1 font-medium">{u.enterpriseName}</span>
                    <span className="whitespace-nowrap text-muted-foreground">{fmtDate(u.periodStart)} → {fmtDate(u.periodEnd)}</span>
                    <span className="w-32 text-right whitespace-nowrap tabular-nums">{fmtMoney(u.amount, u.currency)}</span>
                    <span className="w-24 text-right">{u.due ? <StatusBadge label="Due now" tone="warning" dot /> : <StatusBadge label="Upcoming" tone="neutral" dot />}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </WidgetReveal>

      <BillingTables invoices={data.invoices} enterprises={data.enterprises} />
    </div>
  )
}
