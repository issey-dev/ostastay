"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2, ReceiptText, CalendarClock, ArrowLeftRight, ShieldCheck } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm, useReasonPrompt } from "@/components/providers/confirm-provider"
import { useUrlState } from "@/lib/use-url-state"
import { useIntro } from "@/components/dashboard/motion-kit"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import type { InboxItem, InboxKind } from "@/lib/osta/attention"

// Today's "Needs action" list: one row per thing waiting on Osta, with the action that
// resolves it right on the row. Approve / Mark paid / Test run in place and refresh the
// page (the server recomputes the list and the sidebar counts); anything that needs a
// fuller form (rejecting, extending a licence) links to the screen that owns it.

const FILTERS: { value: "all" | InboxKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approval", label: "Approvals" },
  { value: "channel", label: "Channels" },
  { value: "license", label: "Licences" },
  { value: "billing", label: "Billing" },
]
const FILTER_VALUES = FILTERS.map((f) => f.value)

const KIND_STYLE: Record<InboxKind, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  approval: { icon: Building2, tone: "bg-info/10 text-info" },
  channel: { icon: ArrowLeftRight, tone: "bg-destructive/10 text-destructive" },
  license: { icon: CalendarClock, tone: "bg-warning/10 text-warning" },
  billing: { icon: ReceiptText, tone: "bg-destructive/10 text-destructive" },
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function ago(iso: string, now: number) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

export function TodayInbox({ items, now }: { items: InboxItem[]; now: number }) {
  const router = useRouter()
  const confirm = useConfirm()
  const askReason = useReasonPrompt()
  const [filter, setFilter] = useUrlState<"all" | InboxKind>("show", "all", FILTER_VALUES)
  const [busy, setBusy] = useState<string | null>(null)
  // Rows pop in once on first load (MOTION_PLAN: the .cascade lists); a filter or the
  // refresh after an action never replays it.
  const intro = useIntro(items.length > 0, "osta-today-inbox")

  const counts = items.reduce<Record<string, number>>((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})
  const visible = filter === "all" ? items : items.filter((i) => i.kind === filter)

  async function run(id: string, request: () => Promise<Response>, success: string) {
    setBusy(id)
    try {
      const res = await request()
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "That didn't work. Try again from its own page.")
        return false
      }
      toast.success(success)
      router.refresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  async function approve(item: Extract<InboxItem, { kind: "approval" }>) {
    if (item.used > item.cap) {
      const ok = await confirm({
        title: `Approve ${item.propertyName}?`,
        description: `${item.enterpriseName} would have ${item.used} properties against a licence cap of ${item.cap}. Raise the cap in Licensing first unless this is intended.`,
        confirmLabel: "Approve anyway",
      })
      if (!ok) return
    }
    await run(item.id, () => fetch(`/api/osta/properties/${item.propertyId}/approve`, { method: "POST" }), `Approved ${item.propertyName}`)
  }

  async function markPaid(item: Extract<InboxItem, { kind: "billing" }>) {
    const ref = await askReason({
      title: `Mark ${item.invoiceNo} paid?`,
      description: `${item.enterpriseName} · ${fmtMoney(item.amount, item.currency)}. A receipt number is issued.`,
      reasonLabel: "Payment reference (optional)",
      placeholder: "Bank transfer ref, cheque no…",
      required: false,
      confirmLabel: "Mark paid",
    })
    if (ref === null) return
    await run(
      item.id,
      () =>
        fetch(`/api/osta/license-invoices/${item.invoiceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "markPaid", paymentReference: ref || undefined }),
        }),
      `${item.invoiceNo} marked paid`
    )
  }

  async function testChannel(item: Extract<InboxItem, { kind: "channel" }>) {
    setBusy(item.id)
    try {
      const res = await fetch(`/api/osta/channels/connections/${item.connectionId}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.connection?.status === "CONNECTED") {
        toast.success(`${item.connectionName} is healthy again`)
        router.refresh()
      } else {
        toast.error(data.connection?.lastError ?? data.error ?? "Still failing")
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="inbox-heading" className="bg-card shadow-elevation-1 border min-w-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <h2 id="inbox-heading" className="text-base font-semibold">Needs action</h2>
        <div role="group" aria-label="Show" className="ml-auto flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f.value === "all" ? items.length : counts[f.value] ?? 0
            // Empty kinds are hidden, except the one selected (it just emptied out).
            if (f.value !== "all" && n === 0 && filter !== f.value) return null
            return (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "default" : "outline"}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(filter === f.value && "bg-foreground text-background hover:bg-foreground/85")}
              >
                {f.label} <span className="font-mono text-[11px] opacity-70">{n}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border-t px-4 py-6">
          <EmptyState icon={ShieldCheck} title={items.length === 0 ? "Nothing needs you right now" : "Nothing of this kind"} />
        </div>
      ) : (
        <ul className={cn("divide-y border-t", intro && "cascade")}>
          {visible.map((item) => {
            const { icon: Icon, tone } = KIND_STYLE[item.kind]
            const isBusy = busy === item.id
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3">
                <span className={cn("flex size-8 shrink-0 items-center justify-center", tone)} aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 basis-64">
                  <Row item={item} now={now} />
                </div>
                <div className="flex shrink-0 gap-1.5 max-sm:w-full max-sm:justify-end">
                  {item.kind === "approval" && (
                    <>
                      <Link href={`/osta/properties/${item.propertyId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Review</Link>
                      <Button size="sm" disabled={isBusy} onClick={() => approve(item)}>{isBusy ? "Approving…" : "Approve"}</Button>
                    </>
                  )}
                  {item.kind === "billing" && (
                    <>
                      <Link href={`/osta/enterprises/${item.enterpriseId}?tab=billing`} className={buttonVariants({ size: "sm", variant: "outline" })}>Open</Link>
                      <Button size="sm" disabled={isBusy} onClick={() => markPaid(item)}>{isBusy ? "Saving…" : "Mark paid"}</Button>
                    </>
                  )}
                  {item.kind === "license" && (
                    <>
                      <Link href={`/osta/enterprises/${item.enterpriseId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Enterprise</Link>
                      <Link href={`/osta/enterprises/${item.enterpriseId}?tab=billing`} className={buttonVariants({ size: "sm" })}>Renew…</Link>
                    </>
                  )}
                  {item.kind === "channel" && (
                    <>
                      <Link href="/osta/channel-manager" className={buttonVariants({ size: "sm", variant: "outline" })}>Open</Link>
                      <Button size="sm" disabled={isBusy} onClick={() => testChannel(item)}>{isBusy ? "Testing…" : "Test now"}</Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Row({ item, now }: { item: InboxItem; now: number }) {
  const sub = "mt-0.5 text-xs text-muted-foreground"
  switch (item.kind) {
    case "approval": {
      const over = item.used > item.cap
      return (
        <>
          <p className="text-sm font-semibold">
            Approve {item.propertyName} <span className="font-mono text-xs font-normal text-muted-foreground">{item.propertyCode}</span>
          </p>
          <p className={cn(sub, over && "text-destructive")}>
            <Link href={`/osta/enterprises/${item.enterpriseId}`} className="hover:underline">{item.enterpriseName}</Link>
            {" · "}
            {over ? `over its licence cap (${item.used} of ${item.cap})` : `${item.used} of ${item.cap} licensed properties`}
            {" · submitted "}
            {ago(item.submittedAt, now)}
          </p>
        </>
      )
    }
    case "billing":
      return (
        <>
          <p className="text-sm font-semibold">
            <span className="font-mono text-xs">{item.invoiceNo}</span>{" "}
            {item.daysOverdue > 0 ? `overdue ${item.daysOverdue} day${item.daysOverdue === 1 ? "" : "s"}` : "unpaid"}
            <span className="font-medium text-muted-foreground"> · {fmtMoney(item.amount, item.currency)}</span>
          </p>
          <p className={cn(sub, item.daysOverdue > 0 && "text-destructive")}>
            {item.enterpriseName} · issued {fmtDate(item.issuedAt)}
            {item.dueAt ? ` · due ${fmtDate(item.dueAt)}` : ""}
          </p>
        </>
      )
    case "license":
      return (
        <>
          <p className="text-sm font-semibold">
            {item.enterpriseName} {item.state === "GRACE" ? "is in its grace period" : "has an expired licence"}
          </p>
          <p className={sub}>
            {item.expiresAt ? `Expired ${fmtDate(item.expiresAt)}` : "No expiry date"}
            {item.state === "GRACE" && item.graceEndsAt ? (
              <> · access locks <b className="font-semibold text-warning">{fmtDate(item.graceEndsAt)}</b></>
            ) : (
              " · users can no longer sign in"
            )}
          </p>
        </>
      )
    case "channel":
      return (
        <>
          <p className="text-sm font-semibold">Channel link failing · {item.connectionName}</p>
          <p className={cn(sub, "truncate")}>
            {item.enterpriseName} · {item.propertyName}
            {item.lastError ? ` · ${item.lastError}` : ""}
            {item.lastHealthCheckAt ? ` · checked ${ago(item.lastHealthCheckAt, now)}` : ""}
          </p>
        </>
      )
  }
}
