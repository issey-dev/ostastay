"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, AlertTriangle } from "@/components/icons"

type DbHealth = {
  rowCounts: Record<string, number>
  migrationStatus: { appliedCount: number; onDiskCount: number; inSync: boolean; lastApplied: string | null }
  dbFileSizeBytes: number | null
  queryStats: Array<{ query: string; count: number; avgMs: number; maxMs: number; totalMs: number }>
  slowestQueries: Array<{ query: string; duration: number; timestamp: number }>
  recentEngineEvents: Array<{ level: "error" | "warn"; message: string; timestamp: number }>
  bufferInfo: { queryEventCount: number; bufferCapacity: number; oldestTimestamp: number | null }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "N/A (remote database)"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DbHealthDashboard() {
  const [data, setData] = useState<DbHealth | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (loading && !data) return <p className="text-sm text-muted-foreground italic">Loading...</p>
  if (!data) return <p className="text-sm text-destructive">Failed to load database health.</p>

  return (
    <div className="space-y-6">
      {/* This is a per-process, since-last-restart view, not a persisted historical
          trend — on a multi-instance deployment it only reflects whichever instance
          served this request. */}
      <div className="rounded-md border border-warning/30 bg-warning-muted p-3 text-sm text-warning flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Query metrics reflect <strong>this server instance only</strong>, since the last restart — {data.bufferInfo.queryEventCount} of {data.bufferInfo.bufferCapacity} buffer slots used, no persisted history.
          On a multi-instance deployment this is not a global aggregate.
        </span>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Database File Size</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatBytes(data.dbFileSizeBytes)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Migrations</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
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
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Recent Errors / Warnings</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.recentEngineEvents.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Row Counts</CardTitle>
          <CardDescription>A fixed, hand-picked list of the heaviest tables — not every model.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Object.entries(data.rowCounts).map(([table, count]) => (
              <div key={table} className="flex flex-col">
                <span className="text-xs text-muted-foreground capitalize">{table}</span>
                <span className="text-lg font-semibold">{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Query Stats (by total time)</CardTitle>
          <CardDescription>Grouped by normalized query text — count, average, and max duration since last restart.</CardDescription>
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
                    <td className="py-1.5 pr-4 text-right">{q.count}</td>
                    <td className="py-1.5 pr-4 text-right">{q.avgMs}</td>
                    <td className="py-1.5 pr-4 text-right">{q.maxMs}</td>
                    <td className="py-1.5 text-right">{q.totalMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Slowest Individual Queries</CardTitle>
        </CardHeader>
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
                    <td className="py-1.5 pr-4 text-right">{q.duration}</td>
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
    </div>
  )
}
