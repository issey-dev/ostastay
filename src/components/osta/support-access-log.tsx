"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { LogIn, Plus, ShieldCheck } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Textarea } from "@/components/ui/textarea"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { InlineLoading } from "@/components/ui/inline-loading"
import { ErrorState } from "@/components/ui/error-state"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"
import { useUrlState } from "@/lib/use-url-state"
import { cn } from "@/lib/utils"

// Osta → Support Access, as a plain log (owner, 2026-11-08): ask an enterprise for
// time-boxed access, see which sessions are live and until when, and look back at what
// was pending, answered, expired or revoked. The enterprise's own admin approves; this
// page only requests, enters and reads. (The tenant side still uses SupportAccessManager.)

type Grant = {
  id: string
  status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"
  reason: string | null
  requestedAt: string
  respondedAt: string | null
  expiresAt: string | null
  revokedAt?: string | null
  enterprise: { id: string; name: string; slug: string }
}
type State = "LIVE" | "PENDING" | "EXPIRED" | "DENIED" | "REVOKED"

const stateOf = (g: Grant, now: number): State => {
  if (g.status === "APPROVED") return !g.expiresAt || Date.parse(g.expiresAt) > now ? "LIVE" : "EXPIRED"
  return g.status === "EXPIRED" ? "EXPIRED" : g.status
}
const STATE: Record<State, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  LIVE: { label: "Live", tone: "success" },
  PENDING: { label: "Waiting for approval", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  DENIED: { label: "Denied", tone: "danger" },
  REVOKED: { label: "Revoked", tone: "danger" },
}
const FILTERS = ["all", "live", "pending", "ended"] as const
type Filter = (typeof FILTERS)[number]
const FILTER_LABEL: Record<Filter, string> = { all: "All", live: "Live", pending: "Pending", ended: "Ended" }
const inFilter = (s: State, f: Filter) => f === "all" || (f === "live" && s === "LIVE") || (f === "pending" && s === "PENDING") || (f === "ended" && (s === "EXPIRED" || s === "DENIED" || s === "REVOKED"))

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"
const left = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`
}

const requestSchema = z.object({
  enterpriseId: z.string().min(1, "Choose the enterprise"),
  reason: z.string().trim().min(5, "Say why, in a few words — the enterprise's admin reads this"),
})
type RequestValues = z.infer<typeof requestSchema>

export function SupportAccessLog() {
  const params = useSearchParams()
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [enterprises, setEnterprises] = useState<{ id: string; name: string; type?: string }[]>([])
  const [filter, setFilter] = useUrlState<Filter>("show", "all", FILTERS)
  // ?request=<enterpriseId> (from an enterprise page) opens the form already filled in.
  const requested = params.get("request")
  const [open, setOpenState] = useState(!!requested)
  // Closing drops ?request= from the address, so a refresh doesn't reopen the form.
  const setOpen = (o: boolean) => {
    setOpenState(o)
    if (!o && params.has("request")) {
      const url = new URL(window.location.href)
      url.searchParams.delete("request")
      window.history.replaceState(null, "", url)
    }
  }
  const [busy, setBusy] = useState<string | null>(null)
  // Display clock for "x min left" / live vs expired; moves only when the list loads.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const [g, e] = await Promise.all([fetch("/api/support-access"), fetch("/api/enterprises")])
      if (!g.ok) throw new Error()
      setGrants(await g.json())
      if (e.ok) setEnterprises(await e.json())
      setNow(Date.now())
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const form = useForm<RequestValues>({ resolver: zodResolver(requestSchema), mode: "onChange", defaultValues: { enterpriseId: requested ?? "", reason: "" } })

  const submit = async (v: RequestValues) => {
    const res = await fetch("/api/support-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) })
    if (!res.ok) return toast.error(await apiError(res, "Couldn't send the request. Try again."))
    const name = enterprises.find((e) => e.id === v.enterpriseId)?.name ?? "the enterprise"
    toast.success(`Request sent to ${name}`, { description: "Their admin approves it from their Hub." })
    setOpen(false)
    form.reset()
    void load()
  }

  const enter = async (g: Grant) => {
    setBusy(g.id)
    try {
      const res = await fetch(`/api/support-access/enter/${g.id}`, { method: "POST" })
      if (!res.ok) return toast.error(await apiError(res, "Couldn't enter support mode. Try again."))
      window.location.reload()
    } finally {
      setBusy(null)
    }
  }

  const rows = useMemo(() => (grants ?? []).map((g) => ({ ...g, state: stateOf(g, now) })), [grants, now])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => inFilter(r.state, f)).length])) as Record<Filter, number>, [rows])
  const live = rows.filter((r) => r.state === "LIVE")
  const visible = rows.filter((r) => inFilter(r.state, filter))
  const customers = enterprises.filter((e) => !e.type || e.type === "STANDARD")

  type Row = (typeof rows)[number]
  const columns: ListColumn<Row>[] = [
    { key: "ent", header: "Enterprise", primary: true, sortValue: (r) => r.enterprise.name, cell: (r) => r.enterprise.name },
    { key: "state", header: "Status", sortValue: (r) => r.state, csv: (r) => STATE[r.state].label, cell: (r) => <StatusBadge label={STATE[r.state].label} tone={STATE[r.state].tone} dot /> },
    { key: "requested", header: "Requested", sortValue: (r) => r.requestedAt, cell: (r) => <span className="whitespace-nowrap">{fmt(r.requestedAt)}</span> },
    { key: "answered", header: "Answered", sortValue: (r) => r.respondedAt ?? "", cell: (r) => <span className="whitespace-nowrap">{fmt(r.respondedAt)}</span> },
    {
      key: "until",
      header: "Access until",
      sortValue: (r) => r.expiresAt ?? "",
      cell: (r) =>
        r.expiresAt && (r.state === "LIVE" || r.state === "EXPIRED" || r.state === "REVOKED") ? (
          <span className="flex flex-col whitespace-nowrap">
            <span className={cn(r.state !== "LIVE" && "text-muted-foreground")}>{fmt(r.expiresAt)}</span>
            {r.state === "LIVE" && <span className="text-xs text-success">{left(r.expiresAt, now)}</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "reason", header: "Reason", className: "max-w-72", csv: (r) => r.reason ?? "", cell: (r) => <span className="block truncate text-muted-foreground" title={r.reason ?? undefined}>{r.reason ?? "—"}</span> },
    {
      key: "act",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) =>
        r.state === "LIVE" ? (
          <Button size="sm" disabled={busy === r.id} onClick={(e) => { e.stopPropagation(); void enter(r) }}>
            <LogIn className="mr-1 h-4 w-4" /> Enter
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn("h-8 border px-3 text-sm", filter === f ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")}
          >
            {FILTER_LABEL[f]} <span className="ml-1 font-mono text-[11px] tabular-nums opacity-70">{grants ? counts[f] : ""}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Request access
          </Button>
        </div>
      </div>

      {live.length > 0 && filter === "all" && (
        <ul className="divide-y border border-success/40 bg-success/5" aria-label="Live sessions">
          {live.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <ShieldCheck className="h-4 w-4 text-success" />
              <span className="font-medium">{g.enterprise.name}</span>
              <span className="text-muted-foreground">{g.expiresAt ? `until ${fmt(g.expiresAt)} · ${left(g.expiresAt, now)}` : "no end time"}</span>
              <Button size="sm" className="ml-auto" disabled={busy === g.id} onClick={() => void enter(g)}>
                <LogIn className="mr-1 h-4 w-4" /> Enter support mode
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failed ? (
        <ErrorState title="Couldn't load support access" onRetry={() => void load()} />
      ) : !grants ? (
        <InlineLoading className="p-8" label="Loading support access" />
      ) : (
        <ListTable
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/osta/enterprises/${r.enterprise.id}?tab=support`}
          defaultSort={{ key: "requested", dir: "desc" }}
          exportName="support-access"
          empty={{ icon: ShieldCheck, title: rows.length === 0 ? "No requests yet" : `Nothing under “${FILTER_LABEL[filter]}”`, description: rows.length === 0 ? "Request access when a customer needs help." : undefined }}
        />
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) form.reset() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request support access</DialogTitle>
            <DialogDescription>Osta has no access to an enterprise&apos;s data until its own admin approves a time-boxed request.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-3">
              <FormField
                control={form.control}
                name="enterpriseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Enterprise</FormLabel>
                    <FormControl>
                      <SearchableSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} placeholder="Choose an enterprise…" options={customers.map((e) => ({ label: e.name, value: e.id }))} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Textarea placeholder="e.g. Rates not reaching the channel manager since Monday" {...field} />
                    </FormControl>
                    <FormDescription>Shown to the enterprise&apos;s admin when they decide.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Sending…" : "Send request"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
