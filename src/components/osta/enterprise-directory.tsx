"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2 } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { FilterBar } from "@/components/ui/filter-bar"
import { ListTable, type ListColumn } from "@/components/ui/list-table"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useUrlState } from "@/lib/use-url-state"
import { cn } from "@/lib/utils"
import type { StatusTone } from "@/lib/status-tone"
import type { DirectoryRow, ChannelHealth } from "@/lib/osta/directory"
import type { LicenseState } from "@/lib/license"

// The Osta Enterprises directory: every customer in one sortable table with licence,
// renewal, price, property cap, add-ons, channel health and money owed. Tabs (in the URL)
// slice it by licence state; a click on a row opens a preview with the quick actions,
// while the name itself still links straight to the enterprise's page.

const VIEWS = ["all", "active", "grace", "expired", "onboarding", "unpaid"] as const
type View = (typeof VIEWS)[number]

const VIEW_LABELS: Record<View, string> = {
  all: "All",
  active: "Active",
  grace: "Grace",
  expired: "Expired",
  onboarding: "Onboarding",
  unpaid: "Has unpaid",
}

const inView = (r: DirectoryRow, v: View) => {
  switch (v) {
    case "all": return true
    case "active": return r.licenseState === "ACTIVE" || r.licenseState === "UNLICENSED"
    case "grace": return r.licenseState === "GRACE"
    case "expired": return r.licenseState === "EXPIRED" || r.licenseState === "REVOKED"
    case "onboarding": return r.onboarding
    case "unpaid": return r.unpaidCount > 0
  }
}

const LICENSE: Record<LicenseState, { label: string; tone: StatusTone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  UNLICENSED: { label: "No licence", tone: "neutral" },
  GRACE: { label: "Grace", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "danger" },
  REVOKED: { label: "Revoked", tone: "danger" },
}

const CHANNEL: Record<ChannelHealth, { label: string; tone: StatusTone }> = {
  OK: { label: "OK", tone: "success" },
  FAILING: { label: "Failing", tone: "danger" },
  NONE: { label: "None", tone: "neutral" },
  DOWN: { label: "Not running", tone: "warning" },
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"
const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The date a renewal is judged by: end of grace when in grace, else expiry. */
const renewDate = (r: DirectoryRow) => (r.licenseState === "GRACE" ? r.graceEndsAt : r.expiresAt)

function LicenseBadge({ r }: { r: DirectoryRow }) {
  const l = LICENSE[r.licenseState]
  return <StatusBadge label={l.label} tone={l.tone} dot />
}

function CapCell({ r }: { r: DirectoryRow }) {
  const over = r.propertiesUsed > r.maxProperties
  return (
    <span className="whitespace-nowrap">
      <span className={cn("tabular-nums", over && "font-semibold text-destructive")}>
        {r.liveProperties} / {r.maxProperties}
      </span>
      {r.pendingProperties > 0 && <StatusBadge className="ml-1.5" label={`+${r.pendingProperties} pending`} tone="info" />}
    </span>
  )
}

export function EnterpriseDirectory({ rows }: { rows: DirectoryRow[] }) {
  const [view, setView] = useUrlState<View>("view", "all", VIEWS)
  const [q, setQ] = useState("")
  const [previewId, setPreviewId] = useState<string | null>(null)

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v, rows.filter((r) => inView(r, v)).length])) as Record<View, number>, [rows])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(
      (r) => inView(r, view) && (!needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle))
    )
  }, [rows, view, q])

  const preview = rows.find((r) => r.id === previewId) ?? null

  const columns: ListColumn<DirectoryRow>[] = [
    {
      key: "name",
      header: "Enterprise",
      primary: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.name}</span>
          <span className="font-mono text-[11px] font-normal text-muted-foreground">/e/{r.slug}</span>
        </span>
      ),
    },
    { key: "licence", header: "Licence", sortValue: (r) => r.licenseState, cell: (r) => <LicenseBadge r={r} /> },
    {
      key: "renews",
      header: "Renews",
      sortValue: (r) => renewDate(r),
      csv: (r) => renewDate(r)?.slice(0, 10) ?? "",
      cell: (r) => <span className={cn("whitespace-nowrap", r.licenseState === "GRACE" && "text-warning")}>{fmtDate(renewDate(r))}</span>,
    },
    {
      key: "mrr",
      header: "Monthly",
      align: "right",
      sortValue: (r) => r.monthlyPrice ?? 0,
      cell: (r) => (r.monthlyPrice ? fmtMoney(r.monthlyPrice, r.currency) : <span className="text-muted-foreground">—</span>),
    },
    { key: "properties", header: "Properties", sortValue: (r) => r.liveProperties, csv: (r) => `${r.liveProperties}/${r.maxProperties}`, cell: (r) => <CapCell r={r} /> },
    {
      key: "addons",
      header: "Add-ons",
      csv: (r) => r.addons.join("; "),
      // Add-ons and Channel give way on laptop widths (both are in the preview and CSV).
      className: "max-w-56 max-xl:hidden",
      headClassName: "max-xl:hidden",
      cell: (r) =>
        r.addons.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="block truncate text-muted-foreground" title={r.addons.join(", ")}>{r.addons.join(" · ")}</span>
        ),
    },
    { key: "channel", header: "Channel", sortValue: (r) => r.channel, className: "max-xl:hidden", headClassName: "max-xl:hidden", cell: (r) => <StatusBadge label={CHANNEL[r.channel].label} tone={CHANNEL[r.channel].tone} dot /> },
    {
      key: "unpaid",
      header: "Unpaid",
      align: "right",
      sortValue: (r) => r.unpaidAmount,
      cell: (r) =>
        r.unpaidCount === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn("whitespace-nowrap", r.overdueCount > 0 && "font-semibold text-destructive")}>
            {fmtMoney(r.unpaidAmount, r.currency)}
            {r.overdueCount > 0 && <span className="ml-1 text-xs font-normal">· overdue</span>}
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList variant="line" className="h-10 w-full justify-start overflow-x-auto data-horizontal:h-10">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v} className="flex-none">
              {VIEW_LABELS[v]} <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{counts[v]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar search={{ value: q, onChange: setQ, placeholder: "Name or slug" }} activeCount={q ? 1 : 0} onClear={() => setQ("")} />

      <ListTable
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        rowHref={(r) => `/osta/enterprises/${r.id}`}
        onRowClick={(r) => setPreviewId(r.id)}
        defaultSort={{ key: "renews", dir: "asc" }}
        exportName="enterprises"
        empty={{
          icon: Building2,
          title:
            rows.length === 0 ? "No customer enterprises yet"
            : q.trim() ? `No enterprise matches “${q.trim()}”`
            : `No enterprises under “${VIEW_LABELS[view]}”`,
          description: rows.length === 0 ? "Create one to start onboarding a client." : undefined,
        }}
        mobile={
          <MobileCardList>
            {visible.map((r) => (
              <MobileCard
                key={r.id}
                title={r.name}
                subtitle={`/e/${r.slug}`}
                badge={<LicenseBadge r={r} />}
                onClick={() => setPreviewId(r.id)}
                meta={[
                  { label: "Renews", value: fmtDate(renewDate(r)) },
                  { label: "Properties", value: <CapCell r={r} /> },
                  { label: "Monthly", value: r.monthlyPrice ? fmtMoney(r.monthlyPrice, r.currency) : "—" },
                  { label: "Unpaid", value: r.unpaidCount ? fmtMoney(r.unpaidAmount, r.currency) : "—" },
                ]}
              />
            ))}
          </MobileCardList>
        }
      />

      <Sheet open={!!preview} onOpenChange={(open) => !open && setPreviewId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {preview && <Preview r={preview} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Preview({ r }: { r: DirectoryRow }) {
  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: "Licence",
      value:
        r.licenseState === "GRACE" ? <span className="text-warning">Locks {fmtDate(r.graceEndsAt)}</span>
        : r.expiresAt ? `Until ${fmtDate(r.expiresAt)}`
        : r.licenseState === "UNLICENSED" ? "Not set" : "No expiry",
    },
    { label: "Price", value: r.monthlyPrice ? `${fmtMoney(r.monthlyPrice, r.currency)} / mo` : "Not set" },
    { label: "Properties", value: `${r.liveProperties} of ${r.maxProperties}${r.pendingProperties ? ` · ${r.pendingProperties} pending` : ""}` },
    {
      label: "Billing",
      value:
        r.unpaidCount > 0 ? <span className={r.overdueCount ? "text-destructive" : undefined}>{fmtMoney(r.unpaidAmount, r.currency)} unpaid</span>
        : r.lastInvoice?.paidAt ? `Last paid ${fmtDate(r.lastInvoice.paidAt)}`
        : "No invoices",
    },
    { label: "Customer since", value: fmtDate(r.createdAt) },
  ]

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <LicenseBadge r={r} />
          {r.supportLiveUntil && <StatusBadge label="Support live" tone="info" dot />}
          {r.channel === "FAILING" && <StatusBadge label="Channel failing" tone="danger" dot />}
        </div>
        <SheetTitle className="text-lg">{r.name}</SheetTitle>
        <SheetDescription className="font-mono text-xs">/e/{r.slug}</SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 text-sm">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{f.label}</dt>
            <dd className="mt-1 font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4">
        <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Properties</h3>
        {r.properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y border-y text-sm">
            {r.properties.map((p) => (
              <li key={p.id}>
                <Link href={`/osta/properties/${p.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-muted/50">
                  <span className="min-w-0 truncate">
                    {p.name} <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                  </span>
                  <StatusBadge label={p.status === "ACTIVE" ? "Live" : p.status === "PENDING" ? "Pending" : p.status.toLowerCase()} status={p.status} dot />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {r.addons.length > 0 && (
        <div className="px-4">
          <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Add-ons</h3>
          <p className="text-sm">{r.addons.join(" · ")}</p>
        </div>
      )}

      <SheetFooter className="mt-auto gap-2">
        <Link href={`/osta/enterprises/${r.id}`} className={buttonVariants({ className: "w-full" })}>Open enterprise</Link>
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/osta/enterprises/${r.id}?tab=billing`} className={buttonVariants({ variant: "outline" })}>Licence &amp; invoices</Link>
          <Link href={r.supportLiveUntil ? "/osta/support-access" : `/osta/support-access?request=${r.id}`} className={buttonVariants({ variant: "outline" })}>
            {r.supportLiveUntil ? "Enter support" : "Request support"}
          </Link>
        </div>
      </SheetFooter>
    </>
  )
}
