"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Activity, RefreshCw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { InlineLoading } from "@/components/ui/inline-loading"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sparkline, hueFor } from "@/components/dashboard/charts"
import { WidgetReveal } from "@/components/dashboard/motion-kit"
import { DbHealthDashboard, type DbHealthView } from "@/components/osta/db-health-dashboard"
import { ScopePicker, type PickerEnterprise } from "@/components/osta/monitoring/scope-picker"
import { StackedColumns } from "@/components/osta/monitoring/stacked-columns"
import { cn } from "@/lib/utils"

// The Osta Monitoring page (formerly DB Health). One scope (all enterprises, one
// enterprise, or one property) and one time range drive everything; both live in the URL
// (?range=&enterprise=&property=&tab=) so Back and refresh keep them. The Overview comes
// from /api/osta/monitoring (per-minute rollups, 1h / 24h / 7d); the other tabs are the
// detail sections of the former DB Health page, scoped the same way.
//
// No timer: it re-fetches when the browser tab comes back into view (if older than 30s)
// or on Refresh — an open monitoring tab must not hit the server on its own.

const RANGES = ["1h", "24h", "7d"] as const
type Range = (typeof RANGES)[number]
const TABS = ["overview", "database", "channel", "jobs", "storage"] as const
type Tab = (typeof TABS)[number]
const TAB_VIEW: Record<Exclude<Tab, "overview">, DbHealthView> = { database: "queries", channel: "api", jobs: "jobs", storage: "storage" }

type Row = {
  key: string
  label: string
  scopeable: boolean
  ops: number
  avgMs: number | null
  p95: number | null
  spark: number[]
  channel: { kind: "osta"; calls: number; failures: number } | { kind: "enterprise"; running: boolean } | null
  jobs: { runs: number; failures: number } | null
}

type Overview = {
  range: Range
  bucketMs: number
  buckets: number[]
  scope: { enterpriseId: string | null; propertyId: string | null; enterpriseName: string | null; propertyName: string | null }
  series: { key: string; label: string; values: number[] }[]
  kpis: {
    ops: number
    opsPrev: number
    avgMs: number | null
    p95: number | null
    engineErrors: number | null
    engineWarnings: number | null
    channelCalls: number
    channelFailures: number
    jobRuns: number
    jobFailures: number
    dbSizeBytes: number
    opsSpark: number[]
    p95Spark: (number | null)[]
    errSpark: number[]
    chanFailSpark: number[]
  }
  rows: Row[]
  liveOps: { name: string; count: number; avgMs: number; maxMs: number }[]
  attention: { tone: "warning" | "danger"; tag: string; text: string; scope?: { enterprise: string; property?: string } }[]
  slowQueries: { ms: number; query: string }[]
  picker: PickerEnterprise[]
}

const OTHER_FILL = "color-mix(in oklch, var(--muted-foreground) 40%, transparent)"
const SYSTEM_FILL = "color-mix(in oklch, var(--muted-foreground) 75%, transparent)"
const compact = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString())
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`)
const p95Label = (ms: number | null) => (ms === null ? "—" : `≤ ${ms.toLocaleString()} ms`)

export function MonitoringDashboard() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const range = (RANGES as readonly string[]).includes(params.get("range") ?? "") ? (params.get("range") as Range) : "24h"
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview"
  const enterpriseId = params.get("enterprise") ?? ""
  const propertyId = enterpriseId ? params.get("property") ?? "" : ""

  // One replace for several keys (scope changes both enterprise and property at once).
  const setParams = React.useCallback(
    (next: Record<string, string>) => {
      const sp = new URLSearchParams(window.location.search)
      const defaults: Record<string, string> = { range: "24h", tab: "overview", enterprise: "", property: "" }
      for (const [k, v] of Object.entries(next)) {
        if (!v || v === defaults[k]) sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname]
  )
  const setScope = (e: string, p: string) => setParams({ enterprise: e, property: p })

  const [data, setData] = React.useState<Overview | null>(null)
  const [error, setError] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadedAt, setLoadedAt] = React.useState<number | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)
  // Display clock for "Updated x ago" (see the 15 s tick below).
  const [now, setNow] = React.useState(0)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const sp = new URLSearchParams({ range })
      if (enterpriseId) sp.set("enterprise", enterpriseId)
      if (propertyId) sp.set("property", propertyId)
      const res = await fetch(`/api/osta/monitoring?${sp}`)
      if (!res.ok) throw new Error("failed")
      setData(await res.json())
      const at = Date.now()
      setLoadedAt(at)
      setNow(at)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [range, enterpriseId, propertyId])

  React.useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Back in view after a while → fresh numbers. No interval.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedAt && Date.now() - loadedAt > 30_000) setRefreshKey((k) => k + 1)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [loadedAt])

  // "Updated 2 min ago" ticks on the client only — it never fetches.
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  const ago = loadedAt ? Math.max(0, Math.round((Math.max(now, loadedAt) - loadedAt) / 1000)) : null

  const status = !data
    ? null
    : data.attention.some((a) => a.tone === "danger")
      ? { label: "Needs a look", tone: "danger" as const }
      : data.attention.length
        ? { label: "Slow spots", tone: "warning" as const }
        : { label: "Healthy", tone: "success" as const }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitoring"
        tabTitle="Monitoring · Osta"
        hint="Database load, slow spots, channel-manager calls (connections Uppsolut runs) and background jobs, for every enterprise or one at a time."
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {status && <StatusBadge label={status.label} tone={status.tone} dot />}
            <span className="text-xs text-muted-foreground">
              {loading ? "Updating…" : ago === null ? "" : ago < 15 ? "Updated just now" : `Updated ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)} min`} ago`}
            </span>
          </span>
        }
        actions={
          <>
            <ScopePicker enterprises={data?.picker ?? []} enterpriseId={enterpriseId} propertyId={propertyId} onChange={setScope} />
            <div role="group" aria-label="Time range" className="inline-flex border">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={range === r}
                  onClick={() => setParams({ range: r })}
                  className={cn("h-9 px-3 text-sm font-medium transition-colors", range === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {r}
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v as string })}>
        <TabsList variant="line" className="h-10 w-full justify-start overflow-x-auto border-b data-horizontal:h-10">
          <TabsTrigger value="overview" className="flex-none">Overview</TabsTrigger>
          <TabsTrigger value="database" className="flex-none">Database</TabsTrigger>
          <TabsTrigger value="channel" className="flex-none">Channel API</TabsTrigger>
          <TabsTrigger value="jobs" className="flex-none">Background jobs</TabsTrigger>
          <TabsTrigger value="storage" className="flex-none">Storage</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "overview" ? (
        error && !data ? (
          <ErrorState title="Couldn't load monitoring" onRetry={() => setRefreshKey((k) => k + 1)} />
        ) : !data ? (
          <InlineLoading lines={6} label="Loading monitoring" />
        ) : (
          <OverviewTab data={data} onScope={setScope} onTab={(t) => setParams({ tab: t })} />
        )
      ) : (
        <DbHealthDashboard view={TAB_VIEW[tab]} enterpriseId={enterpriseId} propertyId={propertyId} refreshKey={refreshKey} />
      )}
    </div>
  )
}

function OverviewTab({ data, onScope, onTab }: { data: Overview; onScope: (e: string, p: string) => void; onTab: (t: Tab) => void }) {
  const { kpis, scope } = data
  const scoped = !!scope.enterpriseId
  const delta = kpis.opsPrev > 0 ? Math.round(((kpis.ops - kpis.opsPrev) / kpis.opsPrev) * 100) : null
  const fmtBucket = (ms: number) => {
    const d = new Date(ms)
    return data.range === "7d"
      ? d.toLocaleDateString("en-GB", { weekday: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  }
  // Real enterprises/properties get the categorical hues; "Other" and the no-tenant
  // traffic (sign-in, public pages, system) are greys, so they never look like a customer.
  let hue = 0
  const series = data.series.map((s) => ({
    ...s,
    color: s.key === "__other__" ? OTHER_FILL : s.key === "__none__" ? SYSTEM_FILL : hueFor(hue++),
  }))
  const nothing = kpis.ops === 0 && kpis.channelCalls === 0 && kpis.jobRuns === 0

  const cards: { label: string; value: string; sub: React.ReactNode; spark: number[]; color: string; tab: Tab; alert?: boolean }[] = [
    {
      label: "DB operations",
      value: compact(kpis.ops),
      sub: delta === null ? "no earlier period yet" : <span className={delta > 25 ? "text-warning" : undefined}>{delta >= 0 ? "+" : ""}{delta}% vs previous {data.range}</span>,
      spark: kpis.opsSpark,
      color: "var(--chart-1)",
      tab: "database",
    },
    {
      label: "Query time · p95",
      value: p95Label(kpis.p95),
      // A few very slow operations (e.g. the first queries after a restart) can lift the
      // average above the p95 — say so, or the two numbers read as a contradiction.
      sub:
        kpis.avgMs === null
          ? "no operations"
          : kpis.p95 !== null && kpis.avgMs > kpis.p95
            ? `a few slow ones lift the average to ${kpis.avgMs} ms`
            : `average ${kpis.avgMs} ms`,
      spark: kpis.p95Spark.map((v) => v ?? 0),
      color: "var(--chart-2)",
      tab: "database",
      alert: (kpis.p95 ?? 0) >= 250,
    },
    ...(kpis.engineErrors === null
      ? []
      : [{
          label: "Engine errors",
          value: String(kpis.engineErrors),
          sub: `${kpis.engineWarnings ?? 0} warning${kpis.engineWarnings === 1 ? "" : "s"}`,
          spark: kpis.errSpark,
          color: "var(--destructive)",
          tab: "database" as Tab,
          alert: kpis.engineErrors > 0,
        }]),
    {
      label: "Channel API · failures",
      value: kpis.channelCalls ? `${((kpis.channelFailures / kpis.channelCalls) * 100).toFixed(1)}%` : "—",
      sub: kpis.channelCalls ? `${kpis.channelFailures} of ${kpis.channelCalls.toLocaleString()} calls` : "no calls by Uppsolut-run links",
      spark: kpis.chanFailSpark,
      color: "var(--chart-4)",
      tab: "channel",
      alert: kpis.channelFailures > 0,
    },
    {
      label: "Background jobs",
      value: kpis.jobRuns ? `${kpis.jobRuns - kpis.jobFailures}/${kpis.jobRuns}` : "—",
      sub: kpis.jobRuns === 0 ? "none ran" : kpis.jobFailures ? <span className="text-destructive">{kpis.jobFailures} failed</span> : "all succeeded",
      spark: [],
      color: "var(--chart-3)",
      tab: "jobs",
      alert: kpis.jobFailures > 0,
    },
    ...(scoped
      ? []
      : [{ label: "Database size", value: bytes(kpis.dbSizeBytes), sub: "whole platform", spark: [], color: "var(--chart-5)", tab: "storage" as Tab }]),
  ]

  const columns: ListColumn<Row>[] = [
    { key: "label", header: scoped ? "Property" : "Enterprise", sortValue: (r) => r.label, cell: (r) => <span className={cn("font-medium", !r.scopeable && "text-muted-foreground")}>{r.label}</span> },
    { key: "load", header: `Load · ${data.range}`, cell: (r) => (r.ops ? <Sparkline values={r.spark} width={120} height={22} color="var(--chart-1)" /> : <span className="text-muted-foreground">—</span>) },
    { key: "ops", header: "Ops", align: "right", sortValue: (r) => r.ops, cell: (r) => r.ops.toLocaleString() },
    { key: "p95", header: "p95", align: "right", sortValue: (r) => r.p95 ?? -1, cell: (r) => <span className={cn("whitespace-nowrap", (r.p95 ?? 0) >= 250 && "font-semibold text-warning")}>{p95Label(r.p95)}</span> },
    { key: "avg", header: "Avg", align: "right", sortValue: (r) => r.avgMs ?? -1, cell: (r) => (r.avgMs === null ? "—" : <span className="whitespace-nowrap">{r.avgMs} ms</span>) },
    {
      key: "channel",
      header: "Channel",
      cell: (r) =>
        !r.channel ? <span className="text-muted-foreground">—</span>
        : r.channel.kind === "enterprise" ? <StatusBadge label={r.channel.running ? "Own account · running" : "Own account · not running"} tone="neutral" dot />
        : r.channel.failures ? <StatusBadge label={`${r.channel.failures} failed`} tone="danger" dot />
        : <StatusBadge label="OK" tone="success" dot />,
    },
    ...(scoped
      ? []
      : [{
          key: "jobs",
          header: "Jobs",
          cell: (r: Row) => (!r.jobs ? <span className="text-muted-foreground">—</span> : <StatusBadge label={`${r.jobs.runs - r.jobs.failures}/${r.jobs.runs}`} tone={r.jobs.failures ? "danger" : "success"} dot />),
        }]),
  ]

  return (
    <div className="space-y-5">
      {nothing && (
        <div className="border bg-card p-4">
          <EmptyState
            size="inline"
            icon={Activity}
            title="Nothing recorded in this range yet"
            description="Load history is collected per minute from the moment this version runs, and kept for 8 days."
          />
        </div>
      )}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c, i) => (
          <WidgetReveal key={c.label} index={i}>
            <button
              type="button"
              onClick={() => onTab(c.tab)}
              className={cn("flex h-full w-full flex-col border bg-card p-3.5 text-left shadow-elevation-1 transition-colors hover:bg-muted/40", c.alert && "border-destructive/40")}
            >
              <span className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">{c.label}</span>
              <span className={cn("mt-2 text-2xl font-bold tabular-nums", c.alert && "text-destructive")}>{c.value}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{c.sub}</span>
              <span className="mt-auto pt-2">{c.spark.some((v) => v > 0) ? <Sparkline values={c.spark} fluid height={28} color={c.color} /> : <span className="block h-7" />}</span>
            </button>
          </WidgetReveal>
        ))}
      </section>

      <WidgetReveal index={2}>
        <section className="border bg-card shadow-elevation-1" aria-labelledby="load-h">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <h2 id="load-h" className="text-base font-semibold">
              Database load {scope.propertyId ? `· ${scope.propertyName}` : scoped ? "by property" : "by enterprise"}
            </h2>
            <span className="text-xs text-muted-foreground">operations per {data.bucketMs >= 3_600_000 ? `${data.bucketMs / 3_600_000} h` : `${data.bucketMs / 60_000} min`}</span>
            <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
              {series.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2.5" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          <div className="px-4 pb-3">
            <StackedColumns series={series} buckets={data.buckets} formatBucket={fmtBucket} ariaLabel={`Database operations over the last ${data.range}`} />
          </div>
        </section>
      </WidgetReveal>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {scope.propertyId ? (
            <section className="border bg-card shadow-elevation-1" aria-labelledby="live-h">
              <div className="flex flex-wrap items-baseline gap-2 border-b px-4 py-3">
                <h2 id="live-h" className="text-base font-semibold">Busiest operations</h2>
                <span className="text-xs text-muted-foreground">this server, since its last restart</span>
              </div>
              {data.liveOps.length === 0 ? (
                <div className="p-4"><EmptyState size="inline" title="No operations for this property since the last restart" /></div>
              ) : (
                <ul className="divide-y text-sm">
                  {data.liveOps.map((o) => (
                    <li key={o.name} className="flex items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{o.name}</span>
                      <span className="tabular-nums">{o.count.toLocaleString()}×</span>
                      <span className="w-20 text-right text-muted-foreground tabular-nums">{o.avgMs} ms avg</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{scoped ? "Click a property to focus on it." : "Click an enterprise to focus the whole page on it."}</p>
              <ListTable
                rows={data.rows}
                columns={columns}
                rowKey={(r) => r.key}
                onRowClick={(r) => {
                  if (!r.scopeable) return
                  if (scoped) onScope(scope.enterpriseId!, r.key)
                  else onScope(r.key, "")
                }}
                defaultSort={{ key: "ops", dir: "desc" }}
                exportName={scoped ? "monitoring-properties" : "monitoring-enterprises"}
                empty={{ title: "No activity in this range" }}
              />
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className="border bg-card shadow-elevation-1" aria-labelledby="att-h">
            <h2 id="att-h" className="border-b px-4 py-3 text-base font-semibold">Worth a look</h2>
            {data.attention.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing stands out in this range.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.attention.map((a, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      disabled={!a.scope}
                      onClick={() => a.scope && onScope(a.scope.enterprise, a.scope.property ?? "")}
                      className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left enabled:hover:bg-muted/50"
                    >
                      <StatusBadge label={a.tag} tone={a.tone} dot className="mt-0.5" />
                      <span className="flex-1">{a.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!scoped && data.slowQueries.length > 0 && (
            <section className="border bg-card shadow-elevation-1" aria-labelledby="slow-h">
              <div className="flex items-center border-b px-4 py-3">
                <h2 id="slow-h" className="text-base font-semibold">Slowest statements</h2>
                <button type="button" onClick={() => onTab("database")} className="ml-auto text-xs text-primary hover:underline">Database tab</button>
              </div>
              <ul className="divide-y font-mono text-[11.5px]">
                {data.slowQueries.map((q, i) => (
                  <li key={i} className="flex gap-3 px-4 py-2">
                    <span className={cn("w-14 shrink-0 tabular-nums", q.ms >= 250 ? "text-destructive" : q.ms >= 100 ? "text-warning" : undefined)}>{q.ms} ms</span>
                    <span className="min-w-0 truncate text-muted-foreground" title={q.query}>{q.query}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">This server, since its last restart.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
