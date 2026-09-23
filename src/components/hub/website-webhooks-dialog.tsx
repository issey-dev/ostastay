"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { Check, History, RefreshCw, Send, Trash2 } from "@/components/icons"

// Hub → Booking API → API Keys → Webhooks: where a key's website hears about changes the
// property makes to its excursion and spa bookings. Server side:
// src/lib/website-api/webhooks.ts (signing, SSRF guard, retries).

type Endpoint = {
  id: string
  url: string
  secretPrefix: string
  events: string[]
  status: string
  failureCount: number
  lastDeliveryAt: string | null
}

type Delivery = {
  id: string
  event: string
  status: string
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  createdAt: string
  nextAttemptAt: string | null
}

const EVENT_LABEL: Record<string, string> = {
  "booking.confirmed": "Booking confirmed",
  "booking.cancelled": "Booking cancelled",
  "booking.moved": "Moved to another departure",
  "booking.completed": "Treatment completed",
  "booking.no_show": "No-show",
}

const schema = z.object({
  url: z.string().trim().url("Enter a full URL, e.g. https://www.example.com/webhooks/uppsolut"),
  events: z.array(z.string()).min(1, "Choose at least one event"),
})
type Values = z.infer<typeof schema>

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => null)
  return typeof body?.error === "string" ? body.error : fallback
}

export function WebsiteWebhooksDialog({
  keyRow,
  onClose,
  canManage,
}: {
  keyRow: { id: string; name: string } | null
  onClose: () => void
  canManage: boolean
}) {
  const confirm = useConfirm()
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { url: "", events: [] } })

  const load = useCallback(async (keyId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/hub/website/keys/${keyId}/webhooks`)
      if (!res.ok) return
      const data = await res.json()
      setEndpoints(data.webhooks ?? [])
      setEvents(data.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setSecret(null)
    setAdding(false)
    setDeliveriesFor(null)
    setServerError(null)
    if (keyRow) load(keyRow.id)
  }, [keyRow, load])

  const startAdding = () => {
    setServerError(null)
    form.reset({ url: "", events })
    setAdding(true)
  }

  const onSubmit = async (values: Values) => {
    if (!keyRow) return
    setServerError(null)
    const res = await fetch(`/api/hub/website/keys/${keyRow.id}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      setServerError(await readError(res, "Couldn't add the webhook"))
      return
    }
    const data = await res.json()
    setCopied(false)
    setSecret(data.secret)
    setAdding(false)
    await load(keyRow.id)
  }

  const run = async (endpoint: Endpoint, action: () => Promise<Response>, ok: (data: Record<string, unknown>) => void) => {
    setBusyId(endpoint.id)
    try {
      const res = await action()
      if (!res.ok) {
        toast.error(await readError(res, "That didn't work"))
        return
      }
      ok(await res.json().catch(() => ({})))
      if (keyRow) await load(keyRow.id)
    } finally {
      setBusyId(null)
    }
  }

  const sendTest = (e: Endpoint) =>
    run(e, () => fetch(`/api/hub/website/webhooks/${e.id}/test`, { method: "POST" }), (d) => {
      if (d.outcome === "DELIVERED") toast.success(`Test delivered (HTTP ${d.statusCode})`)
      else toast.error(`Test not delivered: ${d.error ?? "no answer"}`)
    })

  const rotate = async (e: Endpoint) => {
    if (!(await confirm({
      title: "Rotate the signing secret?",
      description: "Deliveries are signed with the new secret straight away. Update the website before it starts rejecting them.",
      confirmLabel: "Rotate secret",
      destructive: true,
    }))) return
    run(e, () => fetch(`/api/hub/website/webhooks/${e.id}/rotate`, { method: "POST" }), (d) => {
      setCopied(false)
      setSecret(String(d.secret))
    })
  }

  const toggle = (e: Endpoint) =>
    run(
      e,
      () => fetch(`/api/hub/website/webhooks/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: e.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }),
      }),
      () => toast.success(e.status === "ACTIVE" ? "Webhook turned off" : "Webhook turned on")
    )

  const remove = async (e: Endpoint) => {
    if (!(await confirm({ title: "Remove this webhook?", description: e.url, confirmLabel: "Remove", destructive: true }))) return
    run(e, () => fetch(`/api/hub/website/webhooks/${e.id}`, { method: "DELETE" }), () => toast.success("Webhook removed"))
  }

  const showDeliveries = async (e: Endpoint) => {
    if (deliveriesFor === e.id) {
      setDeliveriesFor(null)
      return
    }
    const res = await fetch(`/api/hub/website/webhooks/${e.id}/deliveries`)
    if (res.ok) {
      setDeliveries((await res.json()).deliveries ?? [])
      setDeliveriesFor(e.id)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret ?? "")
      setCopied(true)
    } catch {
      toast.error("Couldn't copy — select the secret and copy it manually")
    }
  }

  return (
    <Dialog open={!!keyRow} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Webhooks — {keyRow?.name}</DialogTitle>
          <DialogDescription>
            We tell the website when the property changes one of its excursion or spa bookings — a departure cancelled
            for weather, a guest moved, a no-show. Each message is signed so the website can check it came from us.
          </DialogDescription>
        </DialogHeader>

        {secret && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">Signing secret</p>
            <p className="break-all select-all font-mono text-xs">{secret}</p>
            <p className="text-xs text-destructive">Copy it now — it is shown only once. The website uses it to verify each message.</p>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : null}
              {copied ? "Copied" : "Copy secret"}
            </Button>
          </div>
        )}

        <div className="space-y-3 py-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : endpoints.length === 0 && !adding ? (
            <p className="text-sm text-muted-foreground">No webhooks yet. The website can still check a booking at any time with the lookup endpoint.</p>
          ) : (
            endpoints.map((e) => (
              <div key={e.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-xs">{e.url}</span>
                  <StatusBadge label={e.status === "ACTIVE" ? "On" : "Off"} tone={e.status === "ACTIVE" ? "success" : "neutral"} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {e.events.map((ev) => <Badge key={ev} variant="outline">{EVENT_LABEL[ev] ?? ev}</Badge>)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Secret {e.secretPrefix}… · last delivered {e.lastDeliveryAt ? new Date(e.lastDeliveryAt).toLocaleString() : "never"}
                  {e.failureCount > 0 && <span className="text-destructive"> · {e.failureCount} failed in a row</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {canManage && (
                    <Button size="sm" variant="outline" disabled={busyId === e.id || e.status !== "ACTIVE"} onClick={() => sendTest(e)}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Send test
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => showDeliveries(e)}>
                    <History className="mr-1.5 h-3.5 w-3.5" /> {deliveriesFor === e.id ? "Hide log" : "Log"}
                  </Button>
                  {canManage && (
                    <>
                      <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => rotate(e)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Rotate secret
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => toggle(e)}>
                        {e.status === "ACTIVE" ? "Turn off" : "Turn on"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyId === e.id} onClick={() => remove(e)} aria-label="Remove webhook">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                {deliveriesFor === e.id && (
                  <div className="space-y-1 border-t border-border pt-2 text-xs">
                    {deliveries.length === 0 ? (
                      <p className="text-muted-foreground">Nothing sent yet.</p>
                    ) : (
                      deliveries.map((d) => (
                        <div key={d.id} className="flex flex-wrap justify-between gap-2">
                          <span>
                            {new Date(d.createdAt).toLocaleString()} · {d.event}
                          </span>
                          <span className={d.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}>
                            {d.status === "DELIVERED"
                              ? `Delivered (${d.lastStatusCode})`
                              : d.status === "FAILED"
                                ? `Gave up after ${d.attempts} tries${d.lastError ? ` — ${d.lastError}` : ""}`
                                : `Retrying${d.lastError ? ` — ${d.lastError}` : ""}`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {adding && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 rounded-md border border-border p-3">
                <FormField control={form.control} name="url" render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL *</FormLabel>
                    <FormControl><Input placeholder="https://www.example.com/webhooks/uppsolut" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Must be https and reachable from the internet.</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="events" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Send *</FormLabel>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {events.map((ev) => (
                        <label key={ev} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={field.value.includes(ev)}
                            onCheckedChange={(v) => field.onChange(v ? [...field.value, ev] : field.value.filter((x) => x !== ev))}
                          />
                          {EVENT_LABEL[ev] ?? ev}
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>Add webhook</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </form>
            </Form>
          )}
        </div>

        <DialogFooter>
          {canManage && !adding && <Button variant="outline" onClick={startAdding}>Add webhook</Button>}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
