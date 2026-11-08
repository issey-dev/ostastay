import { notFound } from "next/navigation"
import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { buttonVariants } from "@/components/ui/button"
import { ReceiptText, CheckCircle } from "@/components/icons"
import { WidgetReveal } from "@/components/dashboard/motion-kit"
import { EnterpriseAddonAccessManager } from "@/components/osta/enterprise-addon-access-manager"
import { EnterpriseOnboardingActions } from "@/components/osta/enterprise-onboarding-actions"
import {
  WorkspaceTabs,
  PropertiesTable,
  ChannelTable,
  SupportTable,
  BillingTab,
} from "@/components/osta/workspace/workspace-lists"
import { prisma } from "@/lib/db"
import { computeLicenseState } from "@/lib/license"
import { CONNECTION_STATUS, MANAGED_BY } from "@/lib/channels/connection"
import { cn } from "@/lib/utils"
import { PROPERTY_STATUS_LABEL } from "@/lib/osta/labels"
import { getPropertyFacts } from "@/lib/osta/property-facts"

// The Osta enterprise workspace: everything about one customer on one page, split into
// tabs that are plain links (?tab=…), so each tab is its own URL and loads only its own
// data. It replaces hopping between Enterprises, Licensing (with its enterprise picker),
// Support Access and Channel Manager to answer one question about one client.

// No People or Activity tab: who works at a customer and what they do is the customer's own
// business, not Osta's (owner, 2026-11-07). Not even a user count is shown: it is read only
// to know whether "Create initial user" (and the setup step) still applies.
const TABS = ["overview", "properties", "billing", "modules", "channel", "support"] as const
type Tab = (typeof TABS)[number]

const LICENSE_LABEL: Record<string, string> = {
  ACTIVE: "Licence active",
  GRACE: "Grace period",
  EXPIRED: "Licence expired",
  REVOKED: "Licence revoked",
  UNLICENSED: "No licence",
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—")
const fmtMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border bg-card shadow-elevation-1", className)}>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action && <div className="ml-auto text-xs">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export default async function OstaEnterpriseWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview"
  const now = new Date()

  // Header data — light, loaded for every tab.
  const enterprise = await prisma.enterprise.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      createdAt: true,
      license: true,
      properties: { select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" } },
      channelConnections: { select: { status: true, managedBy: true } },
      licenseInvoices: { where: { status: "ISSUED" }, select: { amount: true, discountAmount: true, currency: true, dueAt: true } },
      supportGrantsReceived: { where: { status: "APPROVED", expiresAt: { gt: now } }, select: { expiresAt: true }, take: 1 },
      _count: { select: { users: true, supportGrantsReceived: true } },
    },
  })
  if (!enterprise || enterprise.type !== "STANDARD") notFound()

  const { state, graceEndsAt } = computeLicenseState(enterprise.license, now)
  const maxProperties = enterprise.license?.maxProperties ?? 1
  const counted = enterprise.properties.filter((p) => p.status !== "REJECTED").length
  const live = enterprise.properties.filter((p) => p.status === "ACTIVE").length
  const pending = enterprise.properties.filter((p) => p.status === "PENDING").length
  // "Failing" is only said of a connection Uppsolut runs; an enterprise's own is running or not.
  const failing = enterprise.channelConnections.filter((c) => c.status === CONNECTION_STATUS.ERROR && c.managedBy === MANAGED_BY.OSTA).length
  const unpaid = enterprise.licenseInvoices.reduce((s, i) => s + i.amount - i.discountAmount, 0)
  const overdue = enterprise.licenseInvoices.some((i) => i.dueAt && i.dueAt < now)
  const supportLive = enterprise.supportGrantsReceived[0]?.expiresAt ?? null
  const currency = enterprise.license?.priceCurrency || "USD"
  const base = `/osta/enterprises/${enterprise.id}`

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "properties", label: "Properties", count: enterprise.properties.length, alert: pending > 0 },
    { key: "billing", label: "Licence & billing", count: enterprise.licenseInvoices.length || undefined, alert: overdue },
    { key: "modules", label: "Modules" },
    { key: "channel", label: "Channel", count: enterprise.channelConnections.length || undefined, alert: failing > 0 },
    { key: "support", label: "Support", count: enterprise._count.supportGrantsReceived || undefined },
  ]

  return (
    <div className="space-y-6">
      <div className="-mx-4 -mt-4 border-b bg-card px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-6">
        <PageHeader
          title={enterprise.name}
          tabTitle={`${enterprise.name} · Osta`}
          crumb={enterprise.name}
          align="end"
          description={
            <span className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge label={LICENSE_LABEL[state]} status={state} dot />
                {supportLive && <StatusBadge label="Support session live" tone="info" dot />}
                {failing > 0 && <StatusBadge label={`${failing} channel link${failing === 1 ? "" : "s"} failing`} tone="danger" dot />}
                {unpaid > 0 && <StatusBadge label={`${fmtMoney(unpaid, currency)} unpaid`} tone={overdue ? "danger" : "warning"} dot />}
              </span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="font-mono text-xs leading-5">/e/{enterprise.slug}</span>
                <span>{live} of {maxProperties} properties live{pending ? ` · ${pending} pending` : ""}</span>
                <span>Customer since {fmtDate(enterprise.createdAt)}</span>
              </span>
            </span>
          }
          actions={
            <>
              <Link href={supportLive ? "/osta/support-access" : `/osta/support-access?request=${enterprise.id}`} className={buttonVariants({ variant: "outline" })}>
                {supportLive ? "Enter support mode" : "Request support access"}
              </Link>
              <Link href={`${base}?tab=billing`} className={buttonVariants({ variant: "outline" })}>Issue invoice</Link>
              <EnterpriseOnboardingActions
                enterpriseId={enterprise.id}
                enterpriseName={enterprise.name}
                userCount={enterprise._count.users}
                propertyCount={counted}
                maxProperties={maxProperties}
              />
            </>
          }
        />
        <div className="mt-4">
          <WorkspaceTabs base={base} current={tab} tabs={tabs} />
        </div>
      </div>

      {tab === "overview" && (
        <Overview
          enterpriseId={enterprise.id}
          base={base}
          state={state}
          graceEndsAt={graceEndsAt}
          license={enterprise.license}
          properties={enterprise.properties}
          live={live}
          pending={pending}
          maxProperties={maxProperties}
          userCount={enterprise._count.users}
          channels={enterprise.channelConnections}
          unpaid={unpaid}
          overdue={overdue}
          supportLive={supportLive}
          now={now}
        />
      )}
      {tab === "properties" && <PropertiesTab enterpriseId={enterprise.id} />}
      {tab === "billing" && <BillingTab enterpriseId={enterprise.id} />}
      {tab === "modules" && (
        <div className="space-y-4">
          <EnterpriseAddonAccessManager enterpriseId={enterprise.id} enterpriseName={enterprise.name} />
          <p className="text-sm text-muted-foreground">
            Modules for a single property (for example Spa at one resort only) are switched on that property&rsquo;s page — open it from the{" "}
            <Link href={`${base}?tab=properties`} className="text-primary hover:underline">Properties</Link> tab.
          </p>
        </div>
      )}
      {tab === "channel" && <ChannelTab enterpriseId={enterprise.id} />}
      {tab === "support" && <SupportTab enterpriseId={enterprise.id} now={now} />}
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────────

async function Overview(props: {
  enterpriseId: string
  base: string
  state: string
  graceEndsAt: Date | null
  license: { expiresAt: Date | null; monthlyPrice: number | null; priceCurrency: string; validFrom: Date | null } | null
  properties: { id: string; name: string; code: string; status: string }[]
  live: number
  pending: number
  maxProperties: number
  userCount: number
  channels: { status: string }[]
  unpaid: number
  overdue: boolean
  supportLive: Date | null
  now: Date
}) {
  const { enterpriseId, base, state, graceEndsAt, license, properties, live, pending, maxProperties, userCount, channels, unpaid, overdue, supportLive, now } = props
  const invoices = await prisma.licenseInvoice.findMany({
    where: { enterpriseId },
    select: { id: true, invoiceNo: true, periodStart: true, issuedAt: true, amount: true, discountAmount: true, currency: true, status: true, paidAt: true, dueAt: true },
    orderBy: { issuedAt: "desc" },
    take: 5,
  })
  const currency = license?.priceCurrency || "USD"
  const renewIn = license?.expiresAt ? Math.ceil((license.expiresAt.getTime() - now.getTime()) / 86_400_000) : null
  const capPct = Math.min(100, Math.round((live / Math.max(1, maxProperties)) * 100))

  // The onboarding path, in the order it actually happens.
  const steps = [
    { label: "Enterprise created", done: true },
    { label: "Licence set (price or expiry)", done: !!(license?.monthlyPrice || license?.expiresAt), href: `${base}?tab=billing` },
    { label: "Initial user created", done: userCount > 0 },
    { label: "A property approved and live", done: live > 0, href: `${base}?tab=properties` },
    { label: "Channel manager connected", done: channels.some((c) => c.status === CONNECTION_STATUS.CONNECTED), href: "/osta/channel-manager" },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
        <WidgetReveal index={0}>
          <Panel title="Licence" action={<Link href={`${base}?tab=billing`} className="text-primary hover:underline">Edit licence</Link>}>
            <dl className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">
              <div className="bg-card p-4">
                <dt className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">{state === "GRACE" ? "Access locks" : "Valid until"}</dt>
                <dd className={cn("mt-1.5 text-lg font-semibold", state === "GRACE" && "text-warning", (state === "EXPIRED" || state === "REVOKED") && "text-destructive")}>
                  {state === "GRACE" ? fmtDate(graceEndsAt) : license?.expiresAt ? fmtDate(license.expiresAt) : "No expiry"}
                </dd>
                {state === "ACTIVE" && renewIn !== null && <p className="mt-0.5 text-xs text-muted-foreground">Renews in {renewIn} day{renewIn === 1 ? "" : "s"}</p>}
              </div>
              <div className="bg-card p-4">
                <dt className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">Price</dt>
                <dd className="mt-1.5 text-lg font-semibold">{license?.monthlyPrice ? fmtMoney(license.monthlyPrice, currency) : "Not set"}</dd>
                {license?.monthlyPrice ? <p className="mt-0.5 text-xs text-muted-foreground">per month</p> : null}
              </div>
              <div className="bg-card p-4">
                <dt className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">Property cap</dt>
                <dd className="mt-1.5 text-lg font-semibold tabular-nums">{live} of {maxProperties}</dd>
                <div className="mt-2 h-1.5 bg-muted" aria-hidden="true"><div className="h-1.5 bg-primary" style={{ width: `${capPct}%` }} /></div>
              </div>
              <div className="bg-card p-4">
                <dt className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">Balance</dt>
                <dd className={cn("mt-1.5 text-lg font-semibold", unpaid > 0 ? (overdue ? "text-destructive" : "text-warning") : "text-success")}>
                  {unpaid > 0 ? fmtMoney(unpaid, currency) : "Nothing due"}
                </dd>
                {unpaid > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{overdue ? "Overdue" : "Not yet due"}</p>}
              </div>
            </dl>
          </Panel>
        </WidgetReveal>

        <WidgetReveal index={1}>
          <Panel title="Properties" action={<Link href={`${base}?tab=properties`} className="text-primary hover:underline">All properties</Link>}>
            {properties.length === 0 ? (
              <div className="p-4"><EmptyState size="inline" title="No properties yet — add the first with Add property above." /></div>
            ) : (
              <ul className="divide-y">
                {properties.map((p) => (
                  <li key={p.id}>
                    <Link href={`/osta/properties/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                      <span className="min-w-0 truncate font-medium">
                        {p.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{p.code}</span>
                      </span>
                      <StatusBadge label={PROPERTY_STATUS_LABEL[p.status] ?? p.status} status={p.status} dot />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {pending > 0 && (
              <div className="border-t bg-info/5 px-4 py-2.5 text-sm">
                {pending} propert{pending === 1 ? "y is" : "ies are"} waiting for approval —{" "}
                <Link href={`${base}?tab=properties`} className="font-medium text-primary hover:underline">review</Link>
              </div>
            )}
          </Panel>
        </WidgetReveal>

        <WidgetReveal index={2}>
          <Panel title="Recent invoices" action={<Link href={`${base}?tab=billing`} className="text-primary hover:underline">Licence &amp; billing</Link>}>
            {invoices.length === 0 ? (
              <div className="p-4"><EmptyState size="inline" icon={ReceiptText} title="No invoices issued yet" /></div>
            ) : (
              <ul className="divide-y">
                {invoices.map((inv) => {
                  const late = inv.status === "ISSUED" && inv.dueAt && inv.dueAt < now
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="font-mono text-xs">{inv.invoiceNo}</span>
                      <span className="text-muted-foreground">{inv.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                      <span className="ml-auto tabular-nums">{fmtMoney(inv.amount - inv.discountAmount, inv.currency)}</span>
                      <StatusBadge
                        label={inv.status === "PAID" ? `Paid ${fmtDate(inv.paidAt)}` : late ? "Overdue" : inv.status === "ISSUED" ? "Unpaid" : inv.status.toLowerCase()}
                        tone={inv.status === "PAID" ? "success" : late ? "danger" : inv.status === "ISSUED" ? "warning" : "neutral"}
                        dot
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </WidgetReveal>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <WidgetReveal index={1}>
          <Panel title="Setup" action={<span className="text-muted-foreground">{doneCount} of {steps.length} done</span>}>
            <ol className="space-y-0.5 px-4 py-3">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2.5 py-1.5 text-sm">
                  {s.done ? (
                    <CheckCircle className="size-4.5 shrink-0 text-success" aria-label="Done" />
                  ) : (
                    <span className="size-4.5 shrink-0 rounded-full border-[1.5px] border-primary" aria-label="Not done" />
                  )}
                  <span className={cn("flex-1", s.done && "text-muted-foreground")}>{s.label}</span>
                  {!s.done && s.href && <Link href={s.href} className="text-xs text-primary hover:underline">Do it</Link>}
                </li>
              ))}
            </ol>
          </Panel>
        </WidgetReveal>

        <WidgetReveal index={2}>
          <Panel title="Support access" action={<Link href={`${base}?tab=support`} className="text-primary hover:underline">History</Link>}>
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              {supportLive ? (
                <>
                  <StatusBadge label="Live" tone="info" dot />
                  <span className="flex-1 text-muted-foreground">until {supportLive.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  <Link href="/osta/support-access" className={buttonVariants({ size: "sm" })}>Enter</Link>
                </>
              ) : (
                <>
                  <span className="flex-1 text-muted-foreground">No live session.</span>
                  <Link href={`/osta/support-access?request=${enterpriseId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Request</Link>
                </>
              )}
            </div>
          </Panel>
        </WidgetReveal>
      </aside>
    </div>
  )
}

// ── List tabs (each loads only its own rows) ────────────────────────────────────

async function PropertiesTab({ enterpriseId }: { enterpriseId: string }) {
  const rows = await prisma.property.findMany({
    where: { enterpriseId },
    select: { id: true, name: true, code: true, status: true, createdAt: true, reviewedAt: true, rejectionReason: true, timeZone: true, businessDate: true, channelConnection: { select: { status: true, managedBy: true } } },
    orderBy: { name: "asc" },
  })
  const now = new Date()
  const facts = await getPropertyFacts(rows, now)
  return (
    <PropertiesTable
      now={now.toISOString()}
      rows={rows.map((p) => ({
        facts: facts.get(p.id) ?? null,
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        reviewedAt: iso(p.reviewedAt),
        rejectionReason: p.rejectionReason,
        // An enterprise-run connection reports running / not running only.
        channel: !p.channelConnection
          ? null
          : p.channelConnection.managedBy === MANAGED_BY.OSTA || p.channelConnection.status === CONNECTION_STATUS.CONNECTED
            ? p.channelConnection.status
            : CONNECTION_STATUS.NOT_CONNECTED,
      }))}
    />
  )
}

async function ChannelTab({ enterpriseId }: { enterpriseId: string }) {
  const rows = await prisma.channelConnection.findMany({
    where: { enterpriseId },
    select: {
      id: true,
      name: true,
      status: true,
      lastHealthCheckAt: true,
      lastError: true,
      webhookTokenHash: true,
      rateLimitRemaining: true,
      rateLimitTotal: true,
      managedBy: true,
      property: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  })
  return (
    <div className="space-y-3">
      <ChannelTable
        rows={rows.map((c) =>
          // The enterprise's own Beds24 account: running or not, nothing more leaves the
          // server (owner, 2026-11-07; DECISIONS.md).
          c.managedBy === MANAGED_BY.OSTA
            ? {
                id: c.id,
                name: c.name,
                propertyName: c.property.name,
                ostaManaged: true,
                status: c.status,
                lastHealthCheckAt: iso(c.lastHealthCheckAt),
                lastError: c.lastError,
                webhook: !!c.webhookTokenHash,
                rateLimitRemaining: c.rateLimitRemaining,
                rateLimitTotal: c.rateLimitTotal,
              }
            : {
                id: c.id,
                name: c.name,
                propertyName: c.property.name,
                ostaManaged: false,
                status: c.status === CONNECTION_STATUS.CONNECTED ? CONNECTION_STATUS.CONNECTED : CONNECTION_STATUS.NOT_CONNECTED,
                lastHealthCheckAt: null,
                lastError: null,
                webhook: false,
                rateLimitRemaining: null,
                rateLimitTotal: null,
              }
        )}
      />
      {rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Connections Uppsolut runs are managed from <Link href="/osta/channel-manager" className="text-primary hover:underline">Channel Manager</Link>. A connection on the enterprise&rsquo;s own Beds24 account shows only whether it is running; it is theirs to manage from their Hub.
        </p>
      )}
    </div>
  )
}

async function SupportTab({ enterpriseId, now }: { enterpriseId: string; now: Date }) {
  const rows = await prisma.supportAccessGrant.findMany({
    where: { enterpriseId },
    select: {
      id: true,
      status: true,
      reason: true,
      requestedAt: true,
      expiresAt: true,
      requestedBy: { select: { firstName: true, lastName: true } },
      approvedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 100,
  })
  return (
    <div className="space-y-3">
      <SupportTable
        rows={rows.map((g) => ({
          id: g.id,
          status: g.status,
          live: g.status === "APPROVED" && !!g.expiresAt && g.expiresAt > now,
          reason: g.reason,
          requestedBy: `${g.requestedBy.firstName} ${g.requestedBy.lastName}`.trim(),
          approvedBy: g.approvedBy ? `${g.approvedBy.firstName} ${g.approvedBy.lastName}`.trim() : null,
          requestedAt: g.requestedAt.toISOString(),
          expiresAt: iso(g.expiresAt),
        }))}
      />
      <p className="text-sm text-muted-foreground">
        Request access or enter a live session from <Link href="/osta/support-access" className="text-primary hover:underline">Support Access</Link>. The enterprise&rsquo;s admin approves each request.
      </p>
    </div>
  )
}
