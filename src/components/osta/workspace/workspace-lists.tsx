"use client"

import { useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { useRouter } from "next/navigation"
import { Building2, ArrowLeftRight, ShieldCheck } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { LicensingManager } from "@/components/controls/licensing-manager"
import { useReasonPrompt } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { PROPERTY_STATUS_LABEL } from "@/lib/osta/labels"
import type { PropertyFacts } from "@/lib/osta/property-facts"
import { ago } from "@/lib/osta/format"

// The list tabs of the Osta enterprise workspace (src/app/osta/enterprises/[id]/page.tsx).
// The page loads plain rows on the server; these render them with the shared ListTable
// and hold the few in-place actions (approve/reject a property, test a channel link).

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"


// ── Properties ──────────────────────────────────────────────────────────────────

export type WorkspaceProperty = {
  id: string
  name: string
  code: string
  status: string
  createdAt: string
  reviewedAt: string | null
  rejectionReason: string | null
  channel: string | null
  facts: PropertyFacts | null
}

const fmtYmd = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })

/** The business date, flagged when it doesn't match the date at the property. */
export function BusinessDateCell({ facts, compact }: { facts: PropertyFacts; compact?: boolean }) {
  if (!facts.businessDate) return <span className="text-muted-foreground">Not set</span>
  const lag = facts.businessDateLagDays
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn("whitespace-nowrap tabular-nums", facts.businessDateState !== "OK" && "font-semibold text-warning")}>{fmtYmd(facts.businessDate)}</span>
      {facts.businessDateState === "BEHIND" && (
        <span className="text-xs whitespace-nowrap text-warning">
          {lag} {lag === 1 ? "day" : "days"} behind{compact ? "" : ` · today is ${fmtYmd(facts.localToday)}`}
        </span>
      )}
      {facts.businessDateState === "AHEAD" && <span className="text-xs whitespace-nowrap text-warning">{-lag} {lag === -1 ? "day" : "days"} ahead</span>}
      {facts.eodInProgress && <span className="text-xs whitespace-nowrap text-muted-foreground">Night Audit running</span>}
    </span>
  )
}

const ofMax = (n: number, max: number | null) => (
  <span className={cn("tabular-nums whitespace-nowrap", max !== null && n > max && "font-semibold text-destructive")}>
    {n}
    {max !== null && <span className="text-muted-foreground"> / {max}</span>}
  </span>
)

export function PropertiesTable({ rows, now }: { rows: WorkspaceProperty[]; now: string }) {
  const router = useRouter()
  const askReason = useReasonPrompt()
  const [busy, setBusy] = useState<string | null>(null)

  async function post(p: WorkspaceProperty, action: "approve" | "reject") {
    let body: string | undefined
    if (action === "reject") {
      const reason = await askReason({
        title: `Reject ${p.name}?`,
        description: "The enterprise's admin sees this reason.",
        reasonLabel: "Reason",
        confirmLabel: "Reject",
        destructive: true,
      })
      if (reason === null) return
      body = JSON.stringify({ rejectionReason: reason })
    }
    setBusy(p.id)
    try {
      const res = await fetch(`/api/osta/properties/${p.id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(data.error ?? "That didn't work. Try again.")
      toast.success(action === "approve" ? `Approved ${p.name}` : `Rejected ${p.name}`)
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const columns: ListColumn<WorkspaceProperty>[] = [
    {
      key: "name",
      header: "Property",
      primary: true,
      sortValue: (p) => p.name,
      cell: (p) => (
        <>
          {p.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{p.code}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (p) => p.status,
      cell: (p) => (
        <span className="flex flex-col gap-0.5">
          <span><StatusBadge label={PROPERTY_STATUS_LABEL[p.status] ?? p.status} status={p.status} dot /></span>
          {p.status === "REJECTED" && p.rejectionReason && <span className="text-xs text-muted-foreground">{p.rejectionReason}</span>}
        </span>
      ),
    },
    {
      key: "rooms",
      header: "Rooms",
      align: "right",
      sortValue: (p) => p.facts?.rooms ?? -1,
      cell: (p) => (p.facts ? ofMax(p.facts.rooms, p.facts.maxRooms) : "—"),
    },
    {
      key: "types",
      header: "Room types",
      align: "right",
      sortValue: (p) => p.facts?.roomTypes ?? -1,
      cell: (p) => (p.facts ? ofMax(p.facts.roomTypes, p.facts.maxRoomTypes) : "—"),
    },
    {
      key: "bizdate",
      header: "Business date",
      sortValue: (p) => p.facts?.businessDate ?? "",
      cell: (p) => (p.facts && p.status === "ACTIVE" ? <BusinessDateCell facts={p.facts} compact /> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "activity",
      header: "Last activity",
      sortValue: (p) => p.facts?.lastActivity?.at ?? "",
      cell: (p) =>
        p.facts?.lastActivity ? (
          <span className="flex flex-col gap-0.5 whitespace-nowrap">
            <span title={fmtDateTime(p.facts.lastActivity.at)}>{ago(p.facts.lastActivity.at, now)}</span>
            <span className="text-xs text-muted-foreground">{p.facts.lastActivity.kind}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">None yet</span>
        ),
    },
    {
      key: "channel",
      header: "Channel",
      sortValue: (p) => p.channel ?? "",
      cell: (p) =>
        p.channel ? (
          <StatusBadge label={p.channel === "CONNECTED" ? "Running" : p.channel === "ERROR" ? "Failing" : "Not running"} tone={p.channel === "CONNECTED" ? "success" : p.channel === "ERROR" ? "danger" : "neutral"} dot />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "created", header: "Added", className: "max-xl:hidden", headClassName: "max-xl:hidden", sortValue: (p) => p.createdAt, cell: (p) => <span className="whitespace-nowrap">{fmtDate(p.createdAt)}</span> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (p) =>
        p.status === "PENDING" ? (
          <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => post(p, "reject")}>Reject…</Button>
            <Button size="sm" disabled={busy === p.id} onClick={() => post(p, "approve")}>Approve</Button>
          </span>
        ) : null,
    },
  ]

  return (
    <ListTable
      rows={rows}
      columns={columns}
      rowKey={(p) => p.id}
      rowHref={(p) => `/osta/properties/${p.id}`}
      exportName="properties"
      empty={{ icon: Building2, title: "No properties yet", description: "Add the first one with Add property above." }}
    />
  )
}

// ── Channel ─────────────────────────────────────────────────────────────────────

export type WorkspaceConnection = {
  id: string
  name: string
  propertyName: string
  /** False: the enterprise's own account — only running / not running is sent. */
  ostaManaged: boolean
  status: string
  lastHealthCheckAt: string | null
  lastError: string | null
  webhook: boolean
  rateLimitRemaining: number | null
  rateLimitTotal: number | null
}

export function ChannelTable({ rows }: { rows: WorkspaceConnection[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function test(c: WorkspaceConnection) {
    setBusy(c.id)
    try {
      const res = await fetch(`/api/osta/channels/connections/${c.id}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.connection?.status === "CONNECTED") toast.success(`${c.name} is healthy`)
      else toast.error(data.connection?.lastError ?? data.error ?? "Still failing")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const columns: ListColumn<WorkspaceConnection>[] = [
    {
      key: "name",
      header: "Connection",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.name}</span>
          <span className="text-xs text-muted-foreground">
            {c.propertyName}
            {!c.ostaManaged && " · enterprise's own account"}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (c) => c.status,
      cell: (c) => (
        <span className="flex flex-col gap-0.5">
          <span>
            {c.ostaManaged ? (
              <StatusBadge label={c.status === "CONNECTED" ? "Connected" : c.status === "ERROR" ? "Failing" : "Not connected"} tone={c.status === "CONNECTED" ? "success" : c.status === "ERROR" ? "danger" : "neutral"} dot />
            ) : (
              <StatusBadge label={c.status === "CONNECTED" ? "Running" : "Not running"} tone={c.status === "CONNECTED" ? "success" : "neutral"} dot />
            )}
          </span>
          {c.status === "ERROR" && c.lastError && <span className="max-w-72 truncate text-xs text-destructive" title={c.lastError}>{c.lastError}</span>}
        </span>
      ),
    },
    { key: "webhook", header: "Webhook", sortValue: (c) => (c.webhook ? 1 : 0), cell: (c) => (!c.ostaManaged ? <span className="text-muted-foreground">—</span> : c.webhook ? "Set" : <span className="text-muted-foreground">Not set</span>) },
    {
      key: "credits",
      header: "API credits",
      align: "right",
      sortValue: (c) => c.rateLimitRemaining ?? -1,
      cell: (c) => (c.rateLimitTotal ? `${c.rateLimitRemaining ?? "?"} / ${c.rateLimitTotal}` : <span className="text-muted-foreground">—</span>),
    },
    { key: "checked", header: "Last checked", sortValue: (c) => c.lastHealthCheckAt ?? "", cell: (c) => (c.ostaManaged ? fmtDateTime(c.lastHealthCheckAt) : <span className="text-muted-foreground">—</span>) },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (c) =>
        c.ostaManaged ? (
          <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => test(c)}>
            {busy === c.id ? "Testing…" : "Test now"}
          </Button>
        ) : null,
    },
  ]
  return (
    <ListTable
      rows={rows}
      columns={columns}
      rowKey={(c) => c.id}
      empty={{
        icon: ArrowLeftRight,
        title: "No channel-manager connection",
        description: "Connections are created from the Channel Manager screen.",
        action: <Link href="/osta/channel-manager" className={buttonVariants({ variant: "outline", size: "sm" })}>Open Channel Manager</Link>,
      }}
    />
  )
}

// ── Support ─────────────────────────────────────────────────────────────────────

export type WorkspaceGrant = {
  id: string
  status: string
  live: boolean
  reason: string | null
  requestedBy: string
  approvedBy: string | null
  requestedAt: string
  expiresAt: string | null
}

const GRANT_LABEL: Record<string, string> = { PENDING: "Waiting for approval", APPROVED: "Approved", REJECTED: "Declined", REVOKED: "Revoked", EXPIRED: "Expired" }

export function SupportTable({ rows }: { rows: WorkspaceGrant[] }) {
  const columns: ListColumn<WorkspaceGrant>[] = [
    {
      key: "status",
      header: "Status",
      sortValue: (g) => g.status,
      cell: (g) =>
        g.live ? <StatusBadge label="Live" tone="info" dot />
        : g.status === "APPROVED" ? <StatusBadge label="Ended" tone="neutral" dot />
        : <StatusBadge label={GRANT_LABEL[g.status] ?? g.status} status={g.status} dot />,
    },
    { key: "reason", header: "Reason", csv: (g) => g.reason ?? "", className: "max-w-80 whitespace-normal", cell: (g) => g.reason ?? <span className="text-muted-foreground">—</span> },
    { key: "by", header: "Requested by", sortValue: (g) => g.requestedBy, cell: (g) => g.requestedBy },
    { key: "approved", header: "Approved by", sortValue: (g) => g.approvedBy ?? "", cell: (g) => g.approvedBy ?? <span className="text-muted-foreground">—</span> },
    { key: "requested", header: "Requested", sortValue: (g) => g.requestedAt, cell: (g) => fmtDateTime(g.requestedAt) },
    { key: "expires", header: "Access until", sortValue: (g) => g.expiresAt ?? "", cell: (g) => fmtDateTime(g.expiresAt) },
  ]
  return (
    <ListTable
      rows={rows}
      columns={columns}
      rowKey={(g) => g.id}
      defaultSort={{ key: "requested", dir: "desc" }}
      empty={{ icon: ShieldCheck, title: "No support access requested yet" }}
    />
  )
}

// ── Licence & billing ───────────────────────────────────────────────────────────

/** The full licence editor, pinned to this enterprise; saves refresh the workspace header. */
export function BillingTab({ enterpriseId }: { enterpriseId: string }) {
  const router = useRouter()
  return <LicensingManager initialEnterpriseId={enterpriseId} locked onChanged={() => router.refresh()} />
}

/** Each tab is a server render: while one loads, its underline pulses (useLinkStatus). */
function TabPending() {
  const { pending } = useLinkStatus()
  return <span aria-hidden="true" className={cn("absolute inset-x-0 -bottom-0.5 h-0.5", pending && "animate-pulse bg-primary/60")} />
}

/** The workspace's tab bar: plain links, so each tab is its own URL and server render. */
export function WorkspaceTabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string; count?: number; alert?: boolean }[] }) {
  return (
    <nav aria-label="Enterprise sections" className="-mb-px flex gap-6 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.key === current
        return (
          <Link
            key={t.key}
            href={t.key === "overview" ? base : `${base}?tab=${t.key}`}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors",
              active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("font-mono text-[11px] tabular-nums", t.alert ? "bg-primary px-1 text-primary-foreground" : "text-muted-foreground")}>{t.count}</span>
            )}
            <TabPending />
          </Link>
        )
      })}
    </nav>
  )
}
