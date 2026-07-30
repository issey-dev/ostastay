"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ArrowLeftRight, RefreshCw, Trash2, Plus, KeyRound } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// The Hub's channel-manager Connection screen. Note this component deliberately does NOT
// use useProperty() — the Hub has no PropertyProvider (see src/app/e/[slug]/hub/layout.tsx),
// because a channel-manager connection is enterprise-level, not per-property.

type Connection = {
  id: string
  provider: string
  name: string
  status: string
  hasCredentials: boolean
  lastTokenRefreshAt: string | null
  lastHealthCheckAt: string | null
  lastError: string | null
  daysUntilRefreshTokenExpiry: number | null
  needsKeepAlive: boolean
  refreshTokenIdleDays: number
  createdAt: string
  rateLimitTotal: number | null
  rateLimitRemaining: number | null
  rateLimitResetsAt: string | null
  rateLimitObservedAt: string | null
  rateLimitPauseThreshold: number | null
}

const connectSchema = z.object({
  name: z.string().trim().min(1, "Give this connection a name").max(60, "Keep the name under 60 characters"),
  inviteCode: z.string().trim().min(1, "Paste the invite code from Beds24"),
})
type ConnectFormValues = z.infer<typeof connectSchema>

const reauthSchema = z.object({
  inviteCode: z.string().trim().min(1, "Paste the new invite code from Beds24"),
})
type ReauthFormValues = z.infer<typeof reauthSchema>

function formatDateTime(iso: string | null) {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString()
}

function StatusBadge({ status }: { status: string }) {
  if (status === "CONNECTED") return <Badge variant="default">Connected</Badge>
  if (status === "ERROR") return <Badge variant="destructive">Error</Badge>
  return <Badge variant="secondary">Not connected</Badge>
}

export function ChannelConnectionManager({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm()
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reauthFor, setReauthFor] = useState<Connection | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const connectForm = useForm<ConnectFormValues>({
    resolver: zodResolver(connectSchema),
    mode: "onChange",
    defaultValues: { name: "", inviteCode: "" },
  })
  const reauthForm = useForm<ReauthFormValues>({
    resolver: zodResolver(reauthSchema),
    mode: "onChange",
    defaultValues: { inviteCode: "" },
  })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch("/api/hub/connections")
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setConnections(data.connections ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleConnect = async (values: ConnectFormValues) => {
    const res = await fetch("/api/hub/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not connect")
      return
    }
    toast.success(`Connected "${values.name}"`)
    setConnectOpen(false)
    connectForm.reset()
    await load()
  }

  const handleReauth = async (values: ReauthFormValues) => {
    if (!reauthFor) return
    const res = await fetch(`/api/hub/connections/${reauthFor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not re-authorize")
      return
    }
    toast.success("Credentials replaced")
    setReauthFor(null)
    reauthForm.reset()
    await load()
  }

  const handleTest = async (c: Connection) => {
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/hub/connections/${c.id}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not run the check")
        return
      }
      // A reachable-but-rejected connection still returns 200 — the check succeeded, the
      // health is bad. Report what was actually observed rather than "test failed".
      if (data.connection?.status === "CONNECTED") toast.success("Connection is healthy")
      else toast.error(data.connection?.lastError ?? "Connection is not healthy")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleSetPauseThreshold = async (connectionId: string, threshold: number | null) => {
    const res = await fetch(`/api/hub/connections/${connectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rateLimitPauseThreshold: threshold }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not save")
      return false
    }
    toast.success(threshold === null ? "Self-throttle disabled" : `Will pause at ${threshold} credits remaining`)
    await load()
    return true
  }

  const handleDelete = async (c: Connection) => {
    const ok = await confirm({
      title: `Remove "${c.name}"?`,
      description:
        "The stored credentials are deleted. Reconnecting needs a new invite code from the Beds24 control panel.",
      confirmLabel: "Remove",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/hub/connections/${c.id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Could not remove the connection")
      return
    }
    toast.success("Connection removed")
    await load()
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (loadError) {
    return <ErrorState onRetry={() => void load()} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Credentials are encrypted at rest and never shown again after saving.
        </p>
        {canManage && (
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Connect
          </Button>
        )}
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No channel manager connected"
          description="Connect Beds24 to exchange availability, rates and bookings with Booking.com, Expedia, Airbnb and Agoda."
        />
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {c.name}
                      <StatusBadge status={c.status} />
                    </CardTitle>
                    <CardDescription>{c.provider === "BEDS24" ? "Beds24" : c.provider}</CardDescription>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => void handleTest(c)} disabled={busyId === c.id}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${busyId === c.id ? "animate-spin" : ""}`} />
                        Check
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setReauthFor(c)}>
                        <KeyRound className="h-4 w-4 mr-2" />
                        Re-authorize
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(c)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-4 sm:block">
                    <dt className="text-muted-foreground">Last checked</dt>
                    <dd className="font-medium">{formatDateTime(c.lastHealthCheckAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 sm:block">
                    <dt className="text-muted-foreground">Credentials last refreshed</dt>
                    <dd className="font-medium">{formatDateTime(c.lastTokenRefreshAt)}</dd>
                  </div>
                </dl>

                {/* Beds24 refresh tokens die after an idle period, so an untouched
                    connection breaks silently. Surfacing the countdown is the whole point
                    of this screen. */}
                {c.hasCredentials && c.daysUntilRefreshTokenExpiry !== null && (
                  <div
                    className={`rounded-md border px-3 py-2 text-sm ${
                      c.daysUntilRefreshTokenExpiry <= 0
                        ? "border-destructive/30 bg-destructive-muted text-destructive"
                        : c.needsKeepAlive
                          ? "border-border bg-muted text-foreground"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {c.daysUntilRefreshTokenExpiry <= 0 ? (
                      <>
                        Credentials have been idle longer than {c.refreshTokenIdleDays} days and will no longer work.
                        Re-authorize with a new invite code from Beds24.
                      </>
                    ) : (
                      <>
                        Credentials expire in {c.daysUntilRefreshTokenExpiry} day
                        {c.daysUntilRefreshTokenExpiry === 1 ? "" : "s"} if unused. Running a check keeps them alive.
                      </>
                    )}
                  </div>
                )}

                {c.lastError && (
                  <p className="text-sm text-destructive">
                    <span className="font-medium">Last error:</span> {c.lastError}
                  </p>
                )}

                <RateLimitPanel c={c} canManage={canManage} onSave={(v) => handleSetPauseThreshold(c.id, v)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Connect */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Beds24</DialogTitle>
            <DialogDescription>
              In Beds24, open Settings &rarr; Apps &amp; Integrations &rarr; API, select the scopes you need, and
              generate an invite code. Invite codes can only be used once.
            </DialogDescription>
          </DialogHeader>
          <Form {...connectForm}>
            <form onSubmit={connectForm.handleSubmit(handleConnect)} className="space-y-4">
              <FormField
                control={connectForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Connection name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Main Beds24 account" {...field} />
                    </FormControl>
                    <FormDescription>Only used to tell connections apart.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={connectForm.control}
                name="inviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invite code</FormLabel>
                    <FormControl>
                      <Input placeholder="Paste the invite code" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConnectOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={connectForm.formState.isSubmitting}>
                  {connectForm.formState.isSubmitting ? "Connecting..." : "Connect"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Re-authorize */}
      <Dialog open={reauthFor !== null} onOpenChange={(o) => !o && setReauthFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-authorize &ldquo;{reauthFor?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Replaces the stored credentials with a new invite code. Use this when the existing credentials have
              lapsed — expired credentials cannot be revived by re-checking.
            </DialogDescription>
          </DialogHeader>
          <Form {...reauthForm}>
            <form onSubmit={reauthForm.handleSubmit(handleReauth)} className="space-y-4">
              <FormField
                control={reauthForm.control}
                name="inviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New invite code</FormLabel>
                    <FormControl>
                      <Input placeholder="Paste the new invite code" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setReauthFor(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={reauthForm.formState.isSubmitting}>
                  {reauthForm.formState.isSubmitting ? "Saving..." : "Replace credentials"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Beds24's account-wide API credit pool, as last observed off response headers (see
// src/lib/channels/beds24.ts) — not polled separately, so "not yet observed" just means no
// real call has happened yet. The threshold below is the operator's own safety margin:
// push/poll skip a real call once remaining credits reach it, rather than waiting for
// Beds24 itself to start rejecting requests.
function RateLimitPanel({
  c,
  canManage,
  onSave,
}: {
  c: Connection
  canManage: boolean
  onSave: (threshold: number | null) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(c.rateLimitPauseThreshold?.toString() ?? "")
  // Whether display alone is "paused" depends on the current wall-clock time, which a
  // component body must not read directly during render (React treats Date.now() as an
  // impure read) — so it is computed in an effect instead, same as any other read of
  // outside-the-render-tree state.
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setDraft(c.rateLimitPauseThreshold?.toString() ?? "")
  }, [c.rateLimitPauseThreshold])

  useEffect(() => {
    const resetsAt = c.rateLimitResetsAt ? new Date(c.rateLimitResetsAt) : null
    setPaused(
      c.rateLimitPauseThreshold != null &&
        c.rateLimitRemaining != null &&
        resetsAt !== null &&
        resetsAt.getTime() > Date.now() &&
        c.rateLimitRemaining <= c.rateLimitPauseThreshold
    )
  }, [c.rateLimitPauseThreshold, c.rateLimitRemaining, c.rateLimitResetsAt])

  const resetsAt = c.rateLimitResetsAt ? new Date(c.rateLimitResetsAt) : null

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Rate limit</span>
        {paused && <Badge variant="destructive">Self-paused</Badge>}
      </div>

      {c.rateLimitTotal === null ? (
        <p className="text-sm text-muted-foreground">Not yet observed — shown after the next real API call.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {c.rateLimitRemaining} / {c.rateLimitTotal} credits remaining
          {resetsAt && `, resets ${resetsAt.toLocaleTimeString()}`}
          {c.rateLimitObservedAt && ` (as of ${formatDateTime(c.rateLimitObservedAt)})`}
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`rate-limit-pause-${c.id}`} className="text-xs text-muted-foreground">
            Pause syncing at or below
          </Label>
          <Input
            id={`rate-limit-pause-${c.id}`}
            type="number"
            min={0}
            step={1}
            value={draft}
            placeholder="Off"
            className="h-8 w-24"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const trimmed = draft.trim()
              const parsed = trimmed === "" ? null : Number(trimmed)
              if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
                setDraft(c.rateLimitPauseThreshold?.toString() ?? "")
                return
              }
              if (parsed === (c.rateLimitPauseThreshold ?? null)) return
              void onSave(parsed)
            }}
          />
          <span className="text-xs text-muted-foreground">credits (blank = never self-pause)</span>
        </div>
      )}
    </div>
  )
}
