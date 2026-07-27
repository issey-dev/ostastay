"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "@/components/icons"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// Background-job health on the Hub overview.
//
// A cron that has quietly stopped firing is worse than no cron: the keep-alive looks fine
// right up until a credential lapses. "Last run" is what makes that visible, so the stale
// case is called out explicitly rather than left for someone to compute from a timestamp.

type JobRun = {
  status: string
  startedAt: string
  finishedAt: string | null
  itemsProcessed: number
  summary: string | null
  error: string | null
}

type JobInfo = {
  name: string
  description: string
  lastRun: JobRun | null
}

// Both current jobs suit an hourly cron, so a day without a run means something is wrong
// with the scheduler rather than with the job.
const STALE_AFTER_HOURS = 24

function hoursSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000)
}

export function JobStatusCard() {
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hub/job-runs")
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Skeleton className="h-40 w-full" />
  // Quietly omitted rather than showing an error block — this is a secondary panel on an
  // overview page, not the reason anyone came here.
  if (failed || jobs.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Background jobs
        </CardTitle>
        <CardDescription>
          Run by an external scheduler. These keep channel-manager credentials alive and trim the exchange log.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((j) => {
          const stale = j.lastRun ? hoursSince(j.lastRun.startedAt) > STALE_AFTER_HOURS : false
          return (
            <div key={j.name} className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-mono text-xs">{j.name}</p>
                <p className="text-xs text-muted-foreground">{j.description}</p>
                {j.lastRun?.summary && <p className="mt-1 text-xs">{j.lastRun.summary}</p>}
                {j.lastRun?.error && <p className="mt-1 text-xs text-destructive">{j.lastRun.error}</p>}
              </div>
              <div className="text-right">
                {!j.lastRun ? (
                  <Badge variant="secondary">Never run</Badge>
                ) : j.lastRun.status === "FAILED" ? (
                  <Badge variant="destructive">Failed</Badge>
                ) : stale ? (
                  <Badge variant="secondary">Stale</Badge>
                ) : (
                  <Badge variant="default">OK</Badge>
                )}
                {j.lastRun && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(j.lastRun.startedAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )
        })}
        {jobs.every((j) => !j.lastRun) && (
          <p className="text-xs text-muted-foreground">
            No runs recorded yet — the scheduler may not be configured. See{" "}
            <code className="text-xs">CRON_SECRET</code> in <code className="text-xs">.env.example</code>.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
