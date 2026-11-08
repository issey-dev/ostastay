import Link from "next/link"
import { ShieldCheck, CalendarClock, History } from "@/components/icons"
import { StatusBadge } from "@/components/ui/status-badge"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { WidgetReveal } from "@/components/dashboard/motion-kit"
import { TodayInbox } from "@/components/osta/today-inbox"
import { TodayKpis } from "@/components/osta/today-kpis"
import { getOstaToday } from "@/lib/osta/attention"
import { getOstaEnterpriseId } from "@/lib/scope"
import { prisma } from "@/lib/db"

// The Osta console's landing page. It used to be six counters; it is now a work page:
// everything waiting on Osta in one list with the action on each row (TodayInbox), the
// portfolio figures above it, and what is coming up (renewals, live support sessions)
// beside it. The list itself is computed in src/lib/osta/attention.ts, which also feeds
// the sidebar's counts.

function formatMoney(amountsByCurrency: Record<string, number>): string {
  const entries = Object.entries(amountsByCurrency).filter(([, amount]) => amount !== 0)
  if (entries.length === 0) return "0.00"
  return entries
    .map(([currency, amount]) => `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" · ")
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit" })
const fmtMonth = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short" }).toUpperCase()
const fmtTime = (d: Date, now: Date) =>
  d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })

function timeLeft(iso: string, now: Date) {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000))
  if (mins < 60) return `${mins} min left`
  const h = Math.floor(mins / 60)
  return h < 48 ? `${h} h ${mins % 60} min left` : `${Math.floor(h / 24)} days left`
}

function Panel({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border shadow-elevation-1">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {href && <Link href={href} className="ml-auto text-xs text-primary hover:underline">{linkLabel}</Link>}
      </div>
      {children}
    </section>
  )
}

export default async function OstaTodayPage() {
  const now = new Date()
  const ostaId = await getOstaEnterpriseId()
  const [{ inbox, kpis, renewals, liveGrants }, activity] = await Promise.all([
    getOstaToday(now),
    // Osta's own trail: what the console's staff did (sign-ins left out).
    prisma.userActivityLog.findMany({
      where: { enterpriseId: ostaId, module: { not: "AUTH" } },
      select: { id: true, createdAt: true, userName: true, description: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ])

  const attention = inbox.length
  const dateLine = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const needs = attention === 0 ? "nothing needs you" : `${attention} thing${attention === 1 ? " needs" : "s need"} you`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        tabTitle="Today · Osta"
        description={`${dateLine} · ${needs} across ${kpis.enterpriseCount} enterprise${kpis.enterpriseCount === 1 ? "" : "s"}`}
        hint="Everything waiting on Osta across every enterprise, with the action on each row. The counts in the sidebar come from the same list."
      />

      <TodayKpis
        k={{
          ...kpis,
          mrr: formatMoney(kpis.mrrByCurrency),
          receivables: formatMoney(kpis.receivablesByCurrency),
        }}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <WidgetReveal index={0}>
            <TodayInbox items={inbox} now={now.getTime()} />
          </WidgetReveal>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <WidgetReveal index={1}>
            <Panel title="Renewals" href="/osta/billing" linkLabel="Billing">
              {renewals.length === 0 ? (
                <div className="border-t px-4 py-3"><EmptyState size="inline" icon={CalendarClock} title="No licence ends in the next 60 days" /></div>
              ) : (
                <ul className="divide-y border-t">
                  {renewals.map((r) => (
                    <li key={r.enterpriseId}>
                      <Link href={`/osta/enterprises/${r.enterpriseId}?tab=billing`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                        <span className="w-10 shrink-0 text-center leading-tight">
                          <span className="block font-mono text-[10px] text-muted-foreground">{fmtMonth(r.date)}</span>
                          <span className="block text-lg font-bold tabular-nums">{fmtDay(r.date)}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{r.enterpriseName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {r.state === "GRACE"
                              ? "Access locks at end of grace"
                              : r.monthlyPrice
                                ? `${r.currency} ${r.monthlyPrice.toLocaleString("en-US")} / month`
                                : "Licence expires"}
                          </span>
                        </span>
                        <StatusBadge label={r.state === "GRACE" ? "Grace" : "Active"} status={r.state} dot />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </WidgetReveal>

          <WidgetReveal index={2}>
            <Panel title="Support access" href="/osta/support-access" linkLabel="Request access">
              {liveGrants.length === 0 ? (
                <div className="border-t px-4 py-3"><EmptyState size="inline" icon={ShieldCheck} title="No live support sessions" /></div>
              ) : (
                <ul className="divide-y border-t">
                  {liveGrants.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                      <StatusBadge label="Live" tone="info" dot />
                      <span className="min-w-0 flex-1">
                        <Link href={`/osta/enterprises/${g.enterpriseId}`} className="block truncate text-sm font-semibold hover:underline">{g.enterpriseName}</Link>
                        <span className="block truncate text-xs text-muted-foreground">{timeLeft(g.expiresAt, now)}{g.reason ? ` · ${g.reason}` : ""}</span>
                      </span>
                      <Link href="/osta/support-access" className="text-xs text-primary hover:underline">Enter</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </WidgetReveal>

          <WidgetReveal index={3}>
            <Panel title="Recent activity">
              {activity.length === 0 ? (
                <div className="border-t px-4 py-3"><EmptyState size="inline" icon={History} title="Nothing recorded yet" /></div>
              ) : (
                <ul className="divide-y border-t">
                  {activity.map((a) => (
                    <li key={a.id} className="flex gap-3 px-4 py-2.5">
                      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{fmtTime(a.createdAt, now)}</span>
                      <span className="min-w-0 flex-1 text-[13px]">
                        {a.userName && <b className="font-semibold">{a.userName} </b>}
                        <span className="text-muted-foreground">{a.description}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </WidgetReveal>
        </div>
      </div>
    </div>
  )
}
