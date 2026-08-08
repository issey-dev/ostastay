"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { RefreshCw, AlertTriangle } from "@/components/icons"
import { InfoHint } from "@/components/ui/info-hint"

type TenantOpRow = {
  enterpriseId: string | null
  propertyId: string | null
  model: string
  operation: string
  count: number
  avgMs: number
  maxMs: number
  totalMs: number
}

type DbHealth = {
  rowCounts: Record<string, number>
  migrationStatus: { appliedCount: number; onDiskCount: number; inSync: boolean; lastApplied: string | null }
  dbFileSizeBytes: number | null
  storage: {
    engine: "sqlite" | "postgresql" | "unknown"
    pageSize: number | null
    pageCount: number | null
    freelistCount: number | null
    totalBytes: number | null
    freeBytes: number | null
    tables: Array<{ name: string; bytes: number; percent: number; indexBytes: number | null }> | null
  }
  queryStats: Array<{ query: string; count: number; avgMs: number; maxMs: number; totalMs: number }>
  slowestQueries: Array<{ query: string; duration: number; timestamp: number }>
  recentEngineEvents: Array<{ level: "error" | "warn"; message: string; timestamp: number }>
  bufferInfo: { queryEventCount: number; bufferCapacity: number; oldestTimestamp: number | null }
  tenantOps: TenantOpRow[]
  tenantOpsBufferInfo: { eventCount: number; bufferCapacity: number; oldestTimestamp: number | null }
  channelApi: {
    windowDays: number
    truncated: boolean
    totals: { calls: number; failures: number; calls24h: number; failures24h: number }
    byOperation: Array<{
      enterpriseId: string
      operation: string
      direction: string
      count: number
      failures: number
      avgLatencyMs: number | null
      maxLatencyMs: number | null
    }>
    recentFailures: Array<{
      enterpriseId: string
      connectionName: string
      operation: string
      httpStatus: number | null
      errorMessage: string | null
      createdAt: string
    }>
  }
  jobs: Array<{
    enterpriseId: string
    jobName: string
    runs: number
    failures: number
    lastStatus: string
    lastStartedAt: string
    lastDurationMs: number | null
    lastError: string | null
  }>
  enterprises: Array<{ id: string; name: string; type: string }>
  properties: Array<{ id: string; name: string; enterpriseId: string }>
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "N/A"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function DbHealthDashboard() {
  const [data, setData] = useState<DbHealth | null>(null)
  const [loading, setLoading] = useState(true)
  // Queries-tab filters. "" = all. Property list narrows to the chosen enterprise.
  const [entFilter, setEntFilter] = useState("")
  const [propFilter, setPropFilter] = useState("")
  // API-tab enterprise filter, independent of the Queries tab's.
  const [apiEntFilter, setApiEntFilter] = useState("")

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/osta/db-health")
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  const entName = useCallback(
    (id: string | null) => (id === null ? "(unauthenticated)" : data?.enterprises.find((e) => e.id === id)?.name ?? id.slice(0, 8)),
    [data]
  )
  const propName = useCallback(
    (id: string | null) => (id === null ? "—" : data?.properties.find((p) => p.id === id)?.name ?? id.slice(0, 8)),
    [data]
  )

  const filteredOps = useMemo(() => {
    if (!data) return []
    return data.tenantOps.filter(
      (r) => (!entFilter || r.enterpriseId === entFilter) && (!propFilter || r.propertyId === propFilter)
    )
  }, [data, entFilter, propFilter])

  // With no filter the interesting question is "who is loading the DB" — group by
  // tenant. With a filter it's "what are they running" — group by model.operation.
  const tenantSummary = useMemo(() => {
    const groups = new Map<string, { enterpriseId: string | null; propertyId: string | null; count: number; totalMs: number }>()
    for (const r of filteredOps) {
      const key = `${r.enterpriseId}|${r.propertyId}`
      const g = groups.get(key) ?? { enterpriseId: r.enterpriseId, propertyId: r.propertyId, count: 0, totalMs: 0 }
      g.count += r.count
      g.totalMs += r.totalMs
      groups.set(key, g)
    }
    return Array.from(groups.values()).sort((a, b) => b.totalMs - a.totalMs)
  }, [filteredOps])

  const opBreakdown = useMemo(() => {
    const groups = new Map<string, { model: string; operation: string; count: number; totalMs: number; maxMs: number }>()
    for (const r of filteredOps) {
      const key = `${r.model}|${r.operation}`
      const g = groups.get(key) ?? { model: r.model, operation: r.operation, count: 0, totalMs: 0, maxMs: 0 }
      g.count += r.count
      g.totalMs += r.totalMs
      g.maxMs = Math.max(g.maxMs, r.maxMs)
      groups.set(key, g)
    }
    return Array.from(groups.values()).sort((a, b) => b.totalMs - a.totalMs).slice(0, 25)
  }, [filteredOps])

  const filteredChannelOps = useMemo(() => {
    if (!data) return []
    return data.channelApi.byOperation.filter((r) => !apiEntFilter || r.enterpriseId === apiEntFilter)
  }, [data, apiEntFilter])

  const filteredJobs = useMemo(() => {
    if (!data) return []
    return data.jobs.filter((r) => !apiEntFilter || r.enterpriseId === apiEntFilter)
  }, [data, apiEntFilter])

  if (loading && !data) return <p className="text-sm text-muted-foreground italic">Loading...</p>
  if (!data) return <p className="text-sm text-destructive">Failed to load database health.</p>

  const entOptions = [
    { label: "All enterprises", value: "" },
    ...data.enterprises.map((e) => ({ label: e.type === "INTERNAL" ? `${e.name} (internal)` : e.name, value: e.id })),
  ]
  const propOptions = [
    { label: "All properties", value: "" },
    ...data.properties
      .filter((p) => !entFilter || p.enterpriseId === entFilter)
      .map((p) => ({ label: p.name, value: p.id })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="storage">
        <TabsList>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="queries">Queries</TabsTrigger>
          <TabsTrigger value="api">API & Channels</TabsTrigger>
        </TabsList>

        {/* ============================== STORAGE ============================== */}
        <TabsContent value="storage" className="space-y-6 pt-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* Development runs SQLite and production PostgreSQL, so every card below
                states which engine it is describing rather than implying one. */}
            <StatCard
              label="Database Size"
              value={
                data.storage.engine === "sqlite"
                  ? formatBytes(data.dbFileSizeBytes)
                  : data.storage.totalBytes !== null
                    ? formatBytes(data.storage.totalBytes)
                    : "N/A"
              }
              sub={
                data.storage.engine === "sqlite"
                  ? "Local SQLite file on disk"
                  : data.storage.engine === "postgresql"
                    ? "pg_database_size()"
                    : "Unrecognised database engine"
              }
            />
            <StatCard
              label="Allocated Pages"
              value={data.storage.totalBytes !== null ? formatBytes(data.storage.totalBytes) : "N/A"}
              sub={data.storage.pageCount !== null ? `${data.storage.pageCount.toLocaleString()} pages × ${data.storage.pageSize} B` : undefined}
            />
            <StatCard
              label="Reclaimable"
              value={data.storage.freeBytes !== null ? formatBytes(data.storage.freeBytes) : "N/A"}
              sub={
                data.storage.engine === "postgresql"
                  ? `${(data.storage.freelistCount ?? 0).toLocaleString()} dead tuples — a VACUUM FULL would release these (estimated)`
                  : "Freelist pages a VACUUM would release"
              }
            />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Migrations</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-2 tabular-nums">
                  {data.migrationStatus.appliedCount} / {data.migrationStatus.onDiskCount}
                  <Badge variant="secondary" className={data.migrationStatus.inSync ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}>
                    {data.migrationStatus.inSync ? "In sync" : "Out of sync"}
                  </Badge>
                </div>
                {data.migrationStatus.lastApplied && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">Last: {data.migrationStatus.lastApplied}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Storage by Table</CardTitle>
              <CardDescription>
                {data.storage.engine === "postgresql"
                  ? "Total size per table (heap + indexes + TOAST), with the index-only share broken out."
                  : "Bytes actually used per table, with indexes listed separately."}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.storage.tables === null ? (
                <p className="text-sm text-muted-foreground italic">
                  {data.storage.engine === "sqlite"
                    ? "Per-table breakdown unavailable — this SQLite build has no dbstat virtual table."
                    : "Per-table breakdown unavailable — the database role cannot read the catalog."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Table</th>
                      <th className="py-1.5 pr-4 text-right">Size</th>
                      {data.storage.engine === "postgresql" && <th className="py-1.5 pr-4 text-right">Indexes</th>}
                      <th className="py-1.5 pr-4 text-right">Share</th>
                      <th className="py-1.5 w-1/3">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.storage.tables.map((t) => (
                      <tr key={t.name} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-xs">{t.name}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{formatBytes(t.bytes)}</td>
                        {data.storage.engine === "postgresql" && (
                          <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                            {t.indexBytes !== null ? formatBytes(t.indexBytes) : "—"}
                          </td>
                        )}
                        <td className="py-1.5 pr-4 text-right tabular-nums">{t.percent}%</td>
                        <td className="py-1.5">
                          <div className="h-2 bg-muted w-full">
                            <div className="h-2 bg-info" style={{ width: `${Math.min(100, t.percent)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            Row Counts
            <InfoHint label="Row Counts">A fixed, hand-picked list of the heaviest tables — not every model.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-3 md:grid-cols-4 gap-4">
                {Object.entries(data.rowCounts).map(([table, count]) => (
                  <div key={table} className="flex flex-col">
                    <span className="text-xs text-muted-foreground capitalize">{table}</span>
                    <span className="text-lg font-semibold tabular-nums">{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================== QUERIES ============================== */}
        <TabsContent value="queries" className="space-y-6 pt-4">
          <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-sm text-warning flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Query metrics reflect <strong>this server instance only</strong>, since the last restart — {data.tenantOpsBufferInfo.eventCount} of {data.tenantOpsBufferInfo.bufferCapacity} operation slots and {data.bufferInfo.queryEventCount} of {data.bufferInfo.bufferCapacity} SQL slots used. Not a historical trend.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Enterprise</p>
              <SearchableSelect
                value={entFilter}
                onChange={(v) => { setEntFilter(v); setPropFilter("") }}
                placeholder="All enterprises"
                options={entOptions}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Property</p>
              <SearchableSelect
                value={propFilter}
                onChange={setPropFilter}
                placeholder="All properties"
                options={propOptions}
              />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            DB Load by Enterprise / Property
            <InfoHint label="DB Load by Enterprise / Property">Prisma operations attributed to the session that ran them. Unauthenticated work (login, public eRegistration) shows separately.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {tenantSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No operations recorded yet{entFilter || propFilter ? " for this filter" : ""}.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Enterprise</th>
                      <th className="py-1.5 pr-4">Property</th>
                      <th className="py-1.5 pr-4 text-right">Operations</th>
                      <th className="py-1.5 text-right">Total DB Time (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantSummary.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4">{entName(t.enterpriseId)}</td>
                        <td className="py-1.5 pr-4">{propName(t.propertyId)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{t.count.toLocaleString()}</td>
                        <td className="py-1.5 text-right tabular-nums">{Math.round(t.totalMs).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Operations{entFilter || propFilter ? " (filtered)" : ""}
              <InfoHint>By model and operation, heaviest total time first.</InfoHint>
            </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {opBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nothing recorded for this filter.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Operation</th>
                      <th className="py-1.5 pr-4 text-right">Count</th>
                      <th className="py-1.5 pr-4 text-right">Max (ms)</th>
                      <th className="py-1.5 text-right">Total (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opBreakdown.map((o, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-xs">{o.model}.{o.operation}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{o.count.toLocaleString()}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{o.maxMs}</td>
                        <td className="py-1.5 text-right tabular-nums">{Math.round(o.totalMs).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            SQL Statements (by total time)
            <InfoHint label="SQL Statements (by total time)">Raw engine view — parameterized SQL, all tenants combined (SQL events carry no tenant identity).</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.queryStats.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No queries recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Query</th>
                      <th className="py-1.5 pr-4 text-right">Count</th>
                      <th className="py-1.5 pr-4 text-right">Avg (ms)</th>
                      <th className="py-1.5 pr-4 text-right">Max (ms)</th>
                      <th className="py-1.5 text-right">Total (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.queryStats.slice(0, 25).map((q, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-xs max-w-md truncate" title={q.query}>{q.query}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{q.count}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{q.avgMs}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{q.maxMs}</td>
                        <td className="py-1.5 text-right tabular-nums">{q.totalMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Slowest Individual Queries</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {data.slowestQueries.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No queries recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Query</th>
                      <th className="py-1.5 pr-4 text-right">Duration (ms)</th>
                      <th className="py-1.5 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slowestQueries.slice(0, 10).map((q, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-xs max-w-md truncate" title={q.query}>{q.query}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{q.duration}</td>
                        <td className="py-1.5 text-right text-muted-foreground">{new Date(q.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {data.recentEngineEvents.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Recent Engine Errors / Warnings</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.recentEngineEvents.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="secondary" className={e.level === "error" ? "bg-destructive-muted text-destructive" : "bg-warning-muted text-warning"}>
                      {e.level.toUpperCase()}
                    </Badge>
                    <span className="flex-1">{e.message}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============================ API & CHANNELS ============================ */}
        <TabsContent value="api" className="space-y-6 pt-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={`Channel Calls (${data.channelApi.windowDays}d)`} value={data.channelApi.totals.calls.toLocaleString()} sub={data.channelApi.truncated ? "Truncated at 5,000 — real total is higher" : undefined} />
            <StatCard label={`Failures (${data.channelApi.windowDays}d)`} value={<span className={data.channelApi.totals.failures > 0 ? "text-destructive" : undefined}>{data.channelApi.totals.failures.toLocaleString()}</span>} />
            <StatCard label="Calls (24h)" value={data.channelApi.totals.calls24h.toLocaleString()} />
            <StatCard label="Failures (24h)" value={<span className={data.channelApi.totals.failures24h > 0 ? "text-destructive" : undefined}>{data.channelApi.totals.failures24h.toLocaleString()}</span>} />
          </div>

          <div className="max-w-sm">
            <p className="text-xs text-muted-foreground mb-1">Enterprise</p>
            <SearchableSelect
              value={apiEntFilter}
              onChange={setApiEntFilter}
              placeholder="All enterprises"
              options={entOptions}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            Channel Manager API — by Operation
            <InfoHint label="Channel Manager API — by Operation">From the persisted sync log (survives restarts). OUTBOUND = we called the channel manager; INBOUND = webhooks.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filteredChannelOps.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No channel API activity in the window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Enterprise</th>
                      <th className="py-1.5 pr-4">Operation</th>
                      <th className="py-1.5 pr-4">Direction</th>
                      <th className="py-1.5 pr-4 text-right">Calls</th>
                      <th className="py-1.5 pr-4 text-right">Failures</th>
                      <th className="py-1.5 pr-4 text-right">Avg (ms)</th>
                      <th className="py-1.5 text-right">Max (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChannelOps.map((r, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4">{entName(r.enterpriseId)}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs">{r.operation}</td>
                        <td className="py-1.5 pr-4"><Badge variant="outline">{r.direction}</Badge></td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{r.count.toLocaleString()}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${r.failures > 0 ? "text-destructive font-medium" : ""}`}>{r.failures}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{r.avgLatencyMs ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.maxLatencyMs ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            Background Jobs (7d)
            <InfoHint label="Background Jobs (7d)">Latest run and failure count per job, per enterprise.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {filteredJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No job runs in the window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4">Enterprise</th>
                      <th className="py-1.5 pr-4">Job</th>
                      <th className="py-1.5 pr-4">Last Status</th>
                      <th className="py-1.5 pr-4 text-right">Runs</th>
                      <th className="py-1.5 pr-4 text-right">Failures</th>
                      <th className="py-1.5 pr-4 text-right">Last Duration</th>
                      <th className="py-1.5 text-right">Last Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((j, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-4">{entName(j.enterpriseId)}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs">{j.jobName}</td>
                        <td className="py-1.5 pr-4">
                          <Badge variant="secondary" className={
                            j.lastStatus === "SUCCEEDED" ? "bg-success-muted text-success"
                              : j.lastStatus === "FAILED" ? "bg-destructive-muted text-destructive"
                              : "bg-info-muted text-info"
                          }>
                            {j.lastStatus}
                          </Badge>
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{j.runs}</td>
                        <td className={`py-1.5 pr-4 text-right tabular-nums ${j.failures > 0 ? "text-destructive font-medium" : ""}`}>{j.failures}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{j.lastDurationMs !== null ? `${(j.lastDurationMs / 1000).toFixed(1)}s` : "—"}</td>
                        <td className="py-1.5 text-right text-muted-foreground whitespace-nowrap">{new Date(j.lastStartedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {data.channelApi.recentFailures.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-lg">Recent Channel Failures</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.channelApi.recentFailures
                  .filter((f) => !apiEntFilter || f.enterpriseId === apiEntFilter)
                  .map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Badge variant="secondary" className="bg-destructive-muted text-destructive shrink-0">
                        {f.httpStatus ?? "ERR"}
                      </Badge>
                      <span className="flex-1">
                        <span className="font-medium">{entName(f.enterpriseId)}</span> · {f.connectionName} · <span className="font-mono text-xs">{f.operation}</span>
                        {f.errorMessage && <span className="text-muted-foreground"> — {f.errorMessage}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(f.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
