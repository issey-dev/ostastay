"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ArrowLeftRight, RefreshCw, Trash2, Plus, KeyRound, ClipboardList, Building2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import {
  type Connection,
  StatusBadge,
  RateLimitPanel,
  formatDateTime,
} from "@/components/hub/channel-connection-manager"

// The Osta console's cross-tenant channel-manager screen — the platform-admin
// counterpart of the tenant Hub's ChannelConnectionManager, for the master-account
// topology (.agents/docs/DECISIONS.md, 2026-08-02): one Beds24 account owned by the app
// owner, one connection per customer enterprise, all draining a single shared API credit
// pool. From here the platform admin does initial setup (invite code → enterprise),
// health checks / keep-alives, webhook URL generation (the admin is the one pasting them
// into Beds24 anyway), self-throttle floors, and removal. Room-type and rate MAPPING is
// deliberately absent — that stays in each enterprise's own Hub, per the owner's call.

type PlatformConnection = Connection & {
  enterprise: { id: string; name: string; slug: string }
}

type EnterpriseOption = { id: string; name: string }

const connectSchema = z.object({
  enterpriseId: z.string().min(1, "Pick the customer enterprise"),
  name: z.string().trim().min(1, "Give this connection a name").max(60, "Keep the name under 60 characters"),
  inviteCode: z.string().trim().min(1, "Paste the invite code from the master Beds24 account"),
})
type ConnectFormValues = z.infer<typeof connectSchema>

const reauthSchema = z.object({
  inviteCode: z.string().trim().min(1, "Paste the new invite code from the master Beds24 account"),
})
type ReauthFormValues = z.infer<typeof reauthSchema>

export function ChannelConnectionsAdmin({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm()
  const [connections, setConnections] = useState<PlatformConnection[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reauthFor, setReauthFor] = useState<PlatformConnection | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The one moment a webhook URL exists in plaintext — held only until the dialog closes.
  const [mintedWebhook, setMintedWebhook] = useState<{ connectionName: string; url: string } | null>(null)

  const connectForm = useForm<ConnectFormValues>({
    resolver: zodResolver(connectSchema),
    mode: "onChange",
    defaultValues: { enterpriseId: "", name: "", inviteCode: "" },
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
      const [connRes, entRes] = await Promise.all([
        fetch("/api/osta/channels/connections"),
        fetch("/api/enterprises"),
      ])
      if (!connRes.ok || !entRes.ok) throw new Error("failed")
      const connData = await connRes.json()
      const entData = await entRes.json()
      setConnections(connData.connections ?? [])
      setEnterprises((entData ?? []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // The shared pool is per Beds24 ACCOUNT, so with one master account the most recently
  // observed reading — whichever connection happened to see it — IS the pool's state.
  const latestPool = useMemo(() => {
    const observed = connections.filter((c) => c.rateLimitObservedAt !== null && c.rateLimitTotal !== null)
    if (observed.length === 0) return null
    return observed.reduce((a, b) =>
      new Date(a.rateLimitObservedAt!).getTime() >= new Date(b.rateLimitObservedAt!).getTime() ? a : b
    )
  }, [connections])

  const handleConnect = async (values: ConnectFormValues) => {
    const res = await fetch("/api/osta/channels/connections", {
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
    const res = await fetch(`/api/osta/channels/connections/${reauthFor.id}`, {
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

  const handleTest = async (c: PlatformConnection) => {
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/osta/channels/connections/${c.id}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not run the check")
        return
      }
      if (data.connection?.status === "CONNECTED") toast.success("Connection is healthy")
      else toast.error(data.connection?.lastError ?? "Connection is not healthy")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleSetPauseThreshold = async (connectionId: string, threshold: number | null) => {
    const res = await fetch(`/api/osta/channels/connections/${connectionId}`, {
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

  const handleGenerateWebhook = async (c: PlatformConnection) => {
    // Regenerating is a rotation: the URL already pasted into Beds24 dies the moment the
    // new one is minted. Make the operator say so out loud first.
    if (c.hasWebhook) {
      const ok = await confirm({
        title: `Replace the webhook URL for "${c.name}"?`,
        description:
          "The URL currently configured in Beds24 stops working immediately. Paste the new URL into Beds24's webhook settings right after — bookings fall back to polling until you do.",
        confirmLabel: "Replace URL",
        destructive: true,
      })
      if (!ok) return
    }
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/osta/channels/connections/${c.id}/webhook`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not generate the webhook URL")
        return
      }
      setMintedWebhook({ connectionName: c.name, url: `${window.location.origin}${data.path}` })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (c: PlatformConnection) => {
    const ok = await confirm({
      title: `Remove "${c.name}" from ${c.enterprise.name}?`,
      description:
        "The stored credentials are deleted. Reconnecting needs a new invite code from the master Beds24 account.",
      confirmLabel: "Remove",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/osta/channels/connections/${c.id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Could not remove the connection")
      return
    }
    toast.success("Connection removed")
    await load()
  }

  const copyMintedUrl = async () => {
    if (!mintedWebhook) return
    await navigator.clipboard.writeText(mintedWebhook.url)
    toast.success("Webhook URL copied")
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
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
      {/* Account-wide credit pool — one master Beds24 account means every connection
          below draws from this single budget. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Shared API credit pool</CardTitle>
        </CardHeader>
        <CardContent>
          {latestPool ? (
            <p className="text-sm">
              <span className="text-2xl font-bold">
                {latestPool.rateLimitRemaining} / {latestPool.rateLimitTotal}
              </span>{" "}
              <span className="text-muted-foreground">
                credits remaining, as last observed {formatDateTime(latestPool.rateLimitObservedAt)} (via &ldquo;
                {latestPool.name}&rdquo;). All connections share the master account&rsquo;s pool — set a pause
                threshold on each so one busy property cannot starve the rest.
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not yet observed — shown after the first real API call by any connection.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          One connection per customer enterprise, each from an invite code generated in the master Beds24 account.
          Credentials are encrypted at rest and never shown again after saving.
        </p>
        {canManage && (
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Connect enterprise
          </Button>
        )}
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No channel-manager connections yet"
          description="Generate an invite code in the master Beds24 account (scoped to the customer's properties) and connect their enterprise here."
        />
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {c.name}
                      <StatusBadge status={c.status} />
                      {c.hasWebhook ? (
                        <Badge variant="secondary">Webhook set</Badge>
                      ) : (
                        <Badge variant="outline">No webhook</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      {c.enterprise.name}
                      <span aria-hidden>·</span>
                      {c.provider === "BEDS24" ? "Beds24" : c.provider}
                    </CardDescription>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => void handleTest(c)} disabled={busyId === c.id}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${busyId === c.id ? "animate-spin" : ""}`} />
                        Check
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleGenerateWebhook(c)}
                        disabled={busyId === c.id}
                      >
                        <ClipboardList className="h-4 w-4 mr-2" />
                        {c.hasWebhook ? "Replace webhook URL" : "Generate webhook URL"}
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
                        Re-authorize with a new invite code.
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

      {/* Connect a customer enterprise */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a customer enterprise</DialogTitle>
            <DialogDescription>
              In the master Beds24 account: Settings &rarr; Apps &amp; Integrations &rarr; API, restrict the invite
              code to this customer&rsquo;s properties, and generate it. Invite codes can only be used once.
            </DialogDescription>
          </DialogHeader>
          <Form {...connectForm}>
            <form onSubmit={connectForm.handleSubmit(handleConnect)} className="space-y-4">
              <FormField
                control={connectForm.control}
                name="enterpriseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Enterprise</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select enterprise..."
                        options={enterprises.map((e) => ({ label: e.name, value: e.id }))}
                      />
                    </FormControl>
                    <FormDescription>The customer this connection belongs to.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={connectForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Connection name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Beds24 — Veyo" {...field} />
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
              Replaces the stored credentials with a new invite code from the master Beds24 account. Use this when
              the existing credentials have lapsed — expired credentials cannot be revived by re-checking.
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

      {/* Show-once webhook URL. Closing this dialog is the last time the URL is visible
          anywhere — only its hash is stored, so there is nothing to reveal later. */}
      <Dialog open={mintedWebhook !== null} onOpenChange={(o) => !o && setMintedWebhook(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook URL for &ldquo;{mintedWebhook?.connectionName}&rdquo;</DialogTitle>
            <DialogDescription>
              Copy this now and paste it into Beds24&rsquo;s booking-webhook settings — it is shown only once and
              cannot be recovered, only replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted p-3">
            <code className="block break-all text-xs">{mintedWebhook?.url}</code>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMintedWebhook(null)}>
              Done
            </Button>
            <Button type="button" onClick={() => void copyMintedUrl()}>
              <ClipboardList className="h-4 w-4 mr-2" />
              Copy URL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
