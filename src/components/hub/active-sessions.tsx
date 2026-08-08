"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfirm } from "@/components/providers/confirm-provider"
import { Users, LogOut } from "@/components/icons"

type SessionRow = {
  id: string
  userId: string
  name: string
  email: string
  roles: string[]
  jobFunction: string | null
  propertyName: string | null
  signedInAt: string
  lastSeenAt: string
  expiresAt: string
  uptimeMs: number
  idleMs: number
  ipAddress: string | null
  userAgent: string | null
  isCurrent: boolean
}

// Durations are rendered from the server's own numbers, not from the browser clock — two
// admins in different timezones (or with a skewed laptop) must see the same figure.
function duration(ms: number): string {
  if (ms < 0) return "just now"
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

// The full UA string is noise in a table; this is recognition, not forensics — the raw
// value stays in the row's title attribute.
function device(ua: string | null): string {
  if (!ua) return "—"
  const os = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : ""
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : /Firefox\//i.test(ua) ? "Firefox" : ""
  return [browser, os].filter(Boolean).join(" · ") || "Unknown"
}

export function ActiveSessions({ canTerminate }: { canTerminate: boolean }) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<SessionRow[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch("/api/hub/sessions")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.sessions ?? [])
      setCurrentId(data.currentSessionId ?? null)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    // Uptime and idle only mean anything if they move. 30s matches the EOD watcher's
    // cadence, and the list is small.
    const t = setInterval(fetchSessions, 30_000)
    return () => clearInterval(t)
  }, [fetchSessions])

  const terminate = async (row: SessionRow) => {
    const ownSession = row.id === currentId
    if (!(await confirm({
      title: ownSession ? "Sign yourself out?" : `Sign out ${row.name}?`,
      description: ownSession
        ? "This is the session you are using right now — you will be returned to the sign-in screen."
        : "Their session ends immediately and any unsaved work on their screen is lost. They can sign back in straight away.",
      confirmLabel: "End session",
      destructive: true,
    }))) return

    setBusyId(row.id)
    try {
      const res = await fetch(`/api/hub/sessions?id=${row.id}`, { method: "DELETE" })
      if (res.ok && ownSession) {
        window.location.href = "/login"
        return
      }
      await fetchSessions()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Everyone currently signed in to this enterprise. Idle time is accurate to about a
          minute — activity is recorded at most once per minute per session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState title="Couldn't load sessions" onRetry={fetchSessions} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="Nobody is signed in right now" />
        ) : (
          <>
            {/* Phone view — the table is six or seven columns wide, so each session
                becomes a card: who, then the roles/location/timing facts, then the
                same end-session action. */}
            <div className="space-y-3 md:hidden">
              {rows.map((r) => (
                <div key={r.id} className="space-y-2 rounded-md border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {r.name}
                        {r.id === currentId && (
                          <Badge variant="outline" className="ml-2 text-[10px]">This is you</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.email}</div>
                    </div>
                    {canTerminate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-destructive"
                        disabled={busyId === r.id}
                        onClick={() => terminate(r)}
                      >
                        <LogOut className="mr-1.5 h-4 w-4" />
                        {busyId === r.id ? "Ending..." : "End"}
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>{r.roles.length ? r.roles.join(", ") : "No role"}</span>
                    <span>{r.propertyName ?? "All properties"}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                    <span title={new Date(r.signedInAt).toLocaleString()}>{duration(r.uptimeMs)} ago</span>
                    <span>Idle {duration(r.idleMs)}</span>
                  </div>

                  <div className="text-xs text-muted-foreground" title={r.userAgent ?? undefined}>
                    {device(r.userAgent)}
                    {r.ipAddress && <span> · {r.ipAddress}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:-mx-6 md:-mb-6 md:block md:border-t md:border-border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="px-6">User</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Signed in</TableHead>
                    <TableHead>Idle</TableHead>
                    <TableHead>Device</TableHead>
                    {canTerminate && <TableHead className="px-6 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="px-6">
                        <div className="font-medium">
                          {r.name}
                          {r.id === currentId && (
                            <Badge variant="outline" className="ml-2 text-[10px]">This is you</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.roles.length ? r.roles.join(", ") : "No role"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.propertyName ?? "All properties"}</TableCell>
                      <TableCell className="text-sm tabular-nums" title={new Date(r.signedInAt).toLocaleString()}>
                        {duration(r.uptimeMs)} ago
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{duration(r.idleMs)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={r.userAgent ?? undefined}>
                        {device(r.userAgent)}
                        {r.ipAddress && <span className="block text-xs">{r.ipAddress}</span>}
                      </TableCell>
                      {canTerminate && (
                        <TableCell className="px-6 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={busyId === r.id}
                            onClick={() => terminate(r)}
                          >
                            <LogOut className="mr-1.5 h-4 w-4" />
                            {busyId === r.id ? "Ending..." : "End"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
