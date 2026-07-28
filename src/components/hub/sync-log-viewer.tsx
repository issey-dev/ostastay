"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { ArrowLeftRight, RefreshCw, FileText } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"

// The Hub's channel-manager exchange log. Read-only: entries are written by the sync path
// itself and there is deliberately no way to edit or delete one from here.
//
// Everything shown has already been redacted at write time (src/lib/channels/redact.ts) —
// this component renders whatever it is given and must never be "improved" into fetching
// raw request/response data.

type SyncLog = {
  id: string
  connectionId: string | null
  connectionName: string
  direction: string
  operation: string
  endpoint: string | null
  ok: boolean
  httpStatus: number | null
  latencyMs: number | null
  requestSummary: string | null
  responseSummary: string | null
  errorMessage: string | null
  createdAt: string
}

const ALL = "__all__"

const DIRECTION_LABELS: Record<string, string> = {
  [ALL]: "All directions",
  OUTBOUND: "Outbound",
  INBOUND: "Inbound",
}

const OUTCOME_LABELS: Record<string, string> = {
  [ALL]: "All outcomes",
  failed: "Failures only",
  ok: "Successes only",
}

export function SyncLogViewer() {
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [direction, setDirection] = useState(ALL)
  const [outcome, setOutcome] = useState(ALL)
  const [expanded, setExpanded] = useState<string | null>(null)

  const buildQuery = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams()
      if (direction !== ALL) p.set("direction", direction)
      if (outcome !== ALL) p.set("outcome", outcome)
      if (cursor) p.set("cursor", cursor)
      return p.toString()
    },
    [direction, outcome]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/hub/sync-logs?${buildQuery()}`)
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setLogs(data.logs ?? [])
      setNextCursor(data.nextCursor ?? null)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/hub/sync-logs?${buildQuery(nextCursor)}`)
      if (!res.ok) return
      const data = await res.json()
      setLogs((prev) => [...prev, ...(data.logs ?? [])])
      setNextCursor(data.nextCursor ?? null)
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (loadError) return <ErrorState onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* SelectValue needs explicit children to show a label rather than the raw value
            (see spa-schedule.tsx for the same pattern). base-ui can also emit null when a
            selection is cleared, so fall back to the "all" sentinel. */}
        <Select value={direction} onValueChange={(v) => setDirection(v ?? ALL)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue>{DIRECTION_LABELS[direction] ?? DIRECTION_LABELS[ALL]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{DIRECTION_LABELS[ALL]}</SelectItem>
            <SelectItem value="OUTBOUND">{DIRECTION_LABELS.OUTBOUND}</SelectItem>
            <SelectItem value="INBOUND">{DIRECTION_LABELS.INBOUND}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={outcome} onValueChange={(v) => setOutcome(v ?? ALL)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue>{OUTCOME_LABELS[outcome] ?? OUTCOME_LABELS[ALL]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{OUTCOME_LABELS[ALL]}</SelectItem>
            <SelectItem value="failed">{OUTCOME_LABELS.failed}</SelectItem>
            <SelectItem value="ok">{OUTCOME_LABELS.ok}</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => void load()} className="ml-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No exchanges logged yet"
          description="Every call to and from the channel manager is recorded here — including failures — so a sync can be traced end to end."
        />
      ) : (
        <>
          {/* Horizontal scroll lives on this wrapper so the page body never scrolls sideways. */}
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  // The Fragment is the list child, so the key belongs here — not on the
                  // rows inside it.
                  <Fragment key={l.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(l.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                          {l.direction === "OUTBOUND" ? "Outbound" : "Inbound"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.operation}</TableCell>
                      <TableCell className="text-sm">{l.connectionName}</TableCell>
                      <TableCell>
                        {l.ok ? (
                          <Badge variant="default">{l.httpStatus ?? "OK"}</Badge>
                        ) : (
                          <Badge variant="destructive">{l.httpStatus ?? "Failed"}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {l.latencyMs != null ? `${l.latencyMs} ms` : "—"}
                      </TableCell>
                    </TableRow>
                    {expanded === l.id && (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/40">
                          <dl className="space-y-2 py-2 text-xs">
                            <div>
                              <dt className="font-medium text-muted-foreground">Endpoint</dt>
                              <dd className="font-mono break-all">{l.endpoint ?? "—"}</dd>
                            </div>
                            {l.errorMessage && (
                              <div>
                                <dt className="font-medium text-muted-foreground">Error</dt>
                                <dd className="text-destructive break-all">{l.errorMessage}</dd>
                              </div>
                            )}
                            <div>
                              <dt className="font-medium text-muted-foreground">Request</dt>
                              <dd className="font-mono break-all">{l.requestSummary ?? "—"}</dd>
                            </div>
                            <div>
                              <dt className="font-medium text-muted-foreground">Response</dt>
                              <dd className="font-mono break-all">{l.responseSummary ?? "—"}</dd>
                            </div>
                          </dl>
                          <p className="pb-2 text-xs text-muted-foreground">
                            Credentials are removed before an entry is stored, so tokens never appear here.
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {nextCursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
