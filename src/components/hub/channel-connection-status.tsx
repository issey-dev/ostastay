"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ArrowLeftRight, RefreshCw, Building2, CheckCircle2, Plus, Trash2, KeyRound, ClipboardList } from "@/components/icons"
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
import { type Connection, ConnectionBadge, RateLimitPanel, PollWindowRow, formatDateTime } from "@/components/hub/connection-shared"

// A property's channel-manager Connection screen. One connection per property
// (HUB_SETUP_PLAN.md, Phase 4). Since 2026-10-14 the enterprise connects it ITSELF, to its
// own Beds24 account: paste an invite code and the Beds24 property id, then install the
// webhook URL in Beds24. Uppsolut can still connect a property through its own account from
// the Osta console for customers who opt for that — such a connection simply shows up here
// already connected.
//
// Every action is gated by the API on INTEGRATIONS (create / update / delete) at this
// property; `canCreate` / `canUpdate` / `canDelete` here only decide which buttons show.

type PropertyLink = {
  id: string
  propertyId: string
  propertyName: string
  externalPropertyId: string
  syncEnabled: boolean
  connectionId: string
}

const connectSchema = z.object({
  externalPropertyId: z.string().trim().min(1, "Enter this property's id in Beds24").regex(/^\d+$/, "The Beds24 property id is a number"),
  name: z.string().trim().min(1, "Give this connection a name").max(60, "Keep the name under 60 characters"),
  inviteCode: z.string().trim().min(1, "Paste the invite code from Beds24"),
})
type ConnectFormValues = z.infer<typeof connectSchema>

const reauthSchema = z.object({ inviteCode: z.string().trim().min(1, "Paste the new invite code from Beds24") })
type ReauthFormValues = z.infer<typeof reauthSchema>

const externalIdSchema = z.object({
  externalPropertyId: z.string().trim().min(1, "Enter this property's id in Beds24").regex(/^\d+$/, "The Beds24 property id is a number"),
})
type ExternalIdFormValues = z.infer<typeof externalIdSchema>

const SETUP_GUIDE = "/docs/configuration/property/channel-manager-setup"

export function ChannelConnectionStatus({
  propertyId,
  propertyName,
  canCreate,
  canUpdate,
  canDelete,
}: {
  propertyId: string
  propertyName: string
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
}) {
  const confirm = useConfirm()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [link, setLink] = useState<PropertyLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [idOpen, setIdOpen] = useState(false)
  const [resyncOpen, setResyncOpen] = useState(false)
  const [resyncHours, setResyncHours] = useState("168")
  const [resyncResult, setResyncResult] = useState<string | null>(null)
  // The one moment a webhook URL exists in plaintext — held only until the dialog closes.
  const [mintedWebhook, setMintedWebhook] = useState<string | null>(null)

  const connectForm = useForm<ConnectFormValues>({
    resolver: zodResolver(connectSchema),
    mode: "onChange",
    defaultValues: { externalPropertyId: "", name: `Beds24 — ${propertyName}`, inviteCode: "" },
  })
  const reauthForm = useForm<ReauthFormValues>({ resolver: zodResolver(reauthSchema), mode: "onChange", defaultValues: { inviteCode: "" } })
  const idForm = useForm<ExternalIdFormValues>({ resolver: zodResolver(externalIdSchema), mode: "onChange", defaultValues: { externalPropertyId: "" } })

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [connRes, linkRes] = await Promise.all([
        fetch(`/api/hub/connections?propertyId=${propertyId}`),
        fetch(`/api/hub/property-links?propertyId=${propertyId}`),
      ])
      if (!connRes.ok || !linkRes.ok) throw new Error("failed")
      setConnection((await connRes.json()).connection ?? null)
      setLink((await linkRes.json()).link ?? null)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  const handleConnect = async (values: ConnectFormValues) => {
    const { ok, data } = await send("/api/hub/connections", "POST", { propertyId, ...values })
    if (!ok) {
      toast.error(data.error ?? "Could not connect")
      return
    }
    toast.success(`Connected "${values.name}"`)
    setConnectOpen(false)
    connectForm.reset({ externalPropertyId: "", name: `Beds24 — ${propertyName}`, inviteCode: "" })
    await load()
  }

  const handleReauth = async (values: ReauthFormValues) => {
    if (!connection) return
    const { ok, data } = await send(`/api/hub/connections/${connection.id}`, "PATCH", values)
    if (!ok) {
      toast.error(data.error ?? "Could not re-authorize")
      return
    }
    toast.success("Credentials replaced")
    setReauthOpen(false)
    reauthForm.reset()
    await load()
  }

  const handleSetId = async (values: ExternalIdFormValues) => {
    if (!connection) return
    const { ok, data } = await send(`/api/hub/connections/${connection.id}`, "PATCH", values)
    if (!ok) {
      toast.error(data.error ?? "Could not save")
      return
    }
    toast.success("Beds24 property id updated")
    setIdOpen(false)
    await load()
  }

  // "Is my connection alive?" — also the keep-alive that stops an idle refresh token dying.
  const handleTest = async () => {
    if (!connection) return
    setBusy(true)
    try {
      const { ok, data } = await send(`/api/hub/connections/${connection.id}/test`, "POST")
      if (!ok) {
        toast.error(data.error ?? "Could not run the check")
        return
      }
      if (data.connection?.status === "CONNECTED") toast.success("Connection is healthy")
      else toast.error(data.connection?.lastError ?? "Connection is not healthy")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const handleGenerateWebhook = async () => {
    if (!connection) return
    // Regenerating is a rotation: the URL already pasted into Beds24 dies at once.
    if (connection.hasWebhook) {
      const ok = await confirm({
        title: "Replace the webhook URL?",
        description:
          "The URL currently set in Beds24 stops working immediately. Paste the new URL into Beds24's booking-webhook settings right after — bookings fall back to polling until you do.",
        confirmLabel: "Replace URL",
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const { ok, data } = await send(`/api/hub/connections/${connection.id}/webhook`, "POST")
      if (!ok) {
        toast.error(data.error ?? "Could not generate the webhook URL")
        return
      }
      setMintedWebhook(`${window.location.origin}${data.path}`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const handleSetThreshold = async (threshold: number | null) => {
    if (!connection) return false
    const { ok, data } = await send(`/api/hub/connections/${connection.id}`, "PATCH", { rateLimitPauseThreshold: threshold })
    if (!ok) {
      toast.error(data.error ?? "Could not save")
      return false
    }
    toast.success(threshold === null ? "Self-throttle disabled" : `Will pause at ${threshold} credits remaining`)
    await load()
    return true
  }

  const handleSetLookback = async (hours: number | null) => {
    if (!connection) return false
    const { ok, data } = await send(`/api/hub/connections/${connection.id}`, "PATCH", { pollLookbackHours: hours })
    if (!ok) {
      toast.error(data.error ?? "Could not save")
      return false
    }
    toast.success(hours === null ? "Poll window reset to the 48h default" : `Poll now looks back ${hours}h`)
    await load()
    return true
  }

  const handleResync = async () => {
    if (!connection) return
    const hours = Number(resyncHours)
    if (!Number.isInteger(hours) || hours < 1) {
      toast.error("Enter a whole number of hours")
      return
    }
    setBusy(true)
    setResyncResult(null)
    try {
      const { ok, data } = await send(`/api/hub/connections/${connection.id}/resync`, "POST", { hours })
      if (!ok) {
        toast.error(data.error ?? "Could not run the resync")
        return
      }
      if (data.poll?.status !== "POLLED") {
        setResyncResult(`Could not poll: ${data.poll?.reason ?? "unknown reason"}`)
        return
      }
      setResyncResult(
        `${data.poll.received} received — ${data.poll.created} new, ${data.poll.updated} updated, ${data.converted} converted to reservations` +
          (data.poll.overbookings > 0 ? `, ${data.poll.overbookings} overbooking(s) flagged` : "")
      )
      await load()
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (!connection) return
    const ok = await confirm({
      title: `Disconnect "${connection.name}"?`,
      description:
        "The stored credentials, the link to the Beds24 property and the room and rate mapping are deleted, and this property stops sharing availability. Reconnecting needs a new invite code and the mapping done again.",
      confirmLabel: "Disconnect",
      destructive: true,
    })
    if (!ok) return
    const { ok: done, data } = await send(`/api/hub/connections/${connection.id}`, "DELETE")
    if (!done) {
      toast.error(data.error ?? "Could not disconnect")
      return
    }
    toast.success("Disconnected")
    await load()
  }

  if (loading) return <Skeleton className="h-32 w-full" />
  if (loadError) return <ErrorState onRetry={() => void load()} />

  if (!connection) {
    return (
      <>
        <EmptyState
          icon={ArrowLeftRight}
          title="This property is not connected yet"
          description="Connect this property to your Beds24 account to share rooms and rates with Booking.com, Expedia, Airbnb, Agoda and other channels, and to receive their bookings. You need an invite code and the property's id from Beds24."
          action={
            canCreate ? (
              <Button onClick={() => setConnectOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Connect to Beds24
              </Button>
            ) : undefined
          }
        />
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Not sure how? Follow the{" "}
          <a className="underline underline-offset-2" href={SETUP_GUIDE} target="_blank" rel="noreferrer">
            step-by-step setup guide
          </a>
          . If you would rather have Uppsolut connect it through its own Beds24 account, contact Uppsolut.
        </p>
        <ConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          form={connectForm}
          onSubmit={handleConnect}
        />
      </>
    )
  }

  const c = connection
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {c.name}
                <ConnectionBadge status={c.status} />
                {c.hasWebhook ? <Badge variant="secondary">Webhook set</Badge> : <Badge variant="outline">No webhook</Badge>}
              </CardTitle>
              <CardDescription>{c.provider === "BEDS24" ? "Beds24" : c.provider}</CardDescription>
            </div>
            {canUpdate && (
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleTest()} disabled={busy}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
                  Check
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleGenerateWebhook()} disabled={busy}>
                  <ClipboardList className="h-4 w-4 mr-2" />
                  {c.hasWebhook ? "Replace webhook URL" : "Generate webhook URL"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setResyncResult(null)
                    setResyncHours("168")
                    setResyncOpen(true)
                  }}
                >
                  <ArrowLeftRight className="h-4 w-4 mr-2" />
                  Deep resync
                </Button>
                <Button variant="outline" size="sm" onClick={() => setReauthOpen(true)}>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Re-authorize
                </Button>
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    aria-label="Disconnect"
                    onClick={() => void handleDisconnect()}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div className="flex justify-between gap-4 md:block">
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="font-medium">{formatDateTime(c.lastHealthCheckAt)}</dd>
            </div>
            <div className="flex justify-between gap-4 md:block">
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
                  Credentials have been idle longer than {c.refreshTokenIdleDays} days and no longer work. Re-authorize with a new
                  invite code from Beds24.
                </>
              ) : (
                <>
                  Credentials expire in {c.daysUntilRefreshTokenExpiry} day{c.daysUntilRefreshTokenExpiry === 1 ? "" : "s"} if
                  unused. Running a check keeps them alive.
                </>
              )}
            </div>
          )}

          {c.lastError && (
            <p className="text-sm text-destructive">
              <span className="font-medium">Last error:</span> {c.lastError}
            </p>
          )}

          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Beds24 property</span>
              {canUpdate && link && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    idForm.reset({ externalPropertyId: link.externalPropertyId })
                    setIdOpen(true)
                  }}
                >
                  Change id
                </Button>
              )}
            </div>
            {!link ? (
              <p className="text-sm text-muted-foreground">Not linked to a Beds24 property yet.</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {link.propertyName}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    Property ID <code className="font-mono text-xs">{link.externalPropertyId}</code>
                  </span>
                  {link.syncEnabled ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Sharing on
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Mapping incomplete</Badge>
                  )}
                </span>
              </div>
            )}
          </div>

          <RateLimitPanel c={c} canManage={canUpdate} onSave={handleSetThreshold} />
          <PollWindowRow c={c} canManage={canUpdate} onSave={handleSetLookback} />

          <p className="text-sm text-muted-foreground">
            Next: map room types and rates under <strong>Mapping</strong>. See the{" "}
            <a className="underline underline-offset-2" href={SETUP_GUIDE} target="_blank" rel="noreferrer">
              setup guide
            </a>
            .
          </p>
        </CardContent>
      </Card>

      <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-authorize &ldquo;{c.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Replaces the stored credentials with a new invite code from Beds24. Use this when the credentials have lapsed — an
              expired credential cannot be revived by checking again.
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
                <Button type="button" variant="outline" onClick={() => setReauthOpen(false)}>
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

      <Dialog open={idOpen} onOpenChange={setIdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Beds24 property id</DialogTitle>
            <DialogDescription>Correct the id if it was typed wrongly. Mapping is kept.</DialogDescription>
          </DialogHeader>
          <Form {...idForm}>
            <form onSubmit={idForm.handleSubmit(handleSetId)} className="space-y-4">
              <FormField
                control={idForm.control}
                name="externalPropertyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beds24 property ID</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIdOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={idForm.formState.isSubmitting}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resyncOpen}
        onOpenChange={(o) => {
          if (!o && !busy) setResyncOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deep resync</DialogTitle>
            <DialogDescription>
              Re-reads every booking Beds24 modified in the window below and converts the recovered ones. Safe to repeat —
              known bookings update in place, never duplicate. Large windows spend more Beds24 API credits.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Label htmlFor="deep-resync-hours" className="text-sm shrink-0">
              Look back
            </Label>
            <Input
              id="deep-resync-hours"
              type="number"
              min={1}
              step={1}
              className="h-9 w-28"
              value={resyncHours}
              onChange={(e) => setResyncHours(e.target.value)}
              disabled={busy}
            />
            <span className="text-sm text-muted-foreground">hours (168 = 7 days, 720 = 30 days)</span>
          </div>
          {resyncResult && (
            <div className="rounded-md border border-border bg-muted p-3 text-sm" role="status">
              {resyncResult}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResyncOpen(false)} disabled={busy}>
              Close
            </Button>
            <Button type="button" onClick={() => void handleResync()} disabled={busy}>
              <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Resyncing..." : "Run resync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-once webhook URL: only its hash is stored, so closing this is the last time it
          is visible anywhere. */}
      <Dialog open={mintedWebhook !== null} onOpenChange={(o) => !o && setMintedWebhook(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook URL</DialogTitle>
            <DialogDescription>
              Copy this now and paste it into Beds24 (Settings &rarr; Properties &rarr; Access &rarr; Booking webhooks). It is
              shown only once and cannot be recovered, only replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted p-3">
            <code className="block break-all text-xs">{mintedWebhook}</code>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMintedWebhook(null)}>
              Done
            </Button>
            <Button
              type="button"
              onClick={async () => {
                if (!mintedWebhook) return
                await navigator.clipboard.writeText(mintedWebhook)
                toast.success("Webhook URL copied")
              }}
            >
              <ClipboardList className="h-4 w-4 mr-2" />
              Copy URL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ConnectDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: ReturnType<typeof useForm<ConnectFormValues>>
  onSubmit: (values: ConnectFormValues) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect to Beds24</DialogTitle>
          <DialogDescription>
            In Beds24: Settings &rarr; Apps &amp; Integrations &rarr; API &rarr; Invite codes. Generate a code for this
            property. An invite code can only be used once.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
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
            <FormField
              control={form.control}
              name="externalPropertyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Beds24 property ID</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 123456" inputMode="numeric" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>The number shown for this property in Beds24 (Settings &rarr; Properties).</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Connection name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>Only used to tell connections apart.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
