import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { buttonVariants } from "@/components/ui/button"
import { AlertTriangle, CheckCircle } from "@/components/icons"
import { WidgetReveal } from "@/components/dashboard/motion-kit"
import { PropertyReviewActions } from "@/components/osta/property-review-actions"
import { getPropertyFacts } from "@/lib/osta/property-facts"
import { ago } from "@/lib/osta/format"
import { PROPERTY_STATUS_LABEL } from "@/lib/osta/labels"
import { CONNECTION_STATUS, MANAGED_BY } from "@/lib/channels/connection"
import { addonLabel } from "@/lib/modules"
import { cn } from "@/lib/utils"

// The Osta view of ONE property: is it set up, is it running, does anything need us?
// Setup and health only — never guests, people or the activity trail (owner, 2026-11-07).
// Spa, Excursions and Transportation are ENTERPRISE add-ons (DECISIONS 2026-08-02), so
// they are shown here read-only and changed on the enterprise's Modules tab.

const SELLABLE = ["EXCURSIONS", "SPA", "TRANSPORTATION", "PLATFORM_EMAIL"] as const

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: typeof d === "string" && d.length === 10 ? "UTC" : undefined }) : "—"
const fmtDateTime = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

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

function Fact({ label, children, sub, tone }: { label: string; children: React.ReactNode; sub?: React.ReactNode; tone?: "warning" | "danger" }) {
  return (
    <div className={cn("border bg-card p-4 shadow-elevation-1", tone === "warning" && "border-warning/60", tone === "danger" && "border-destructive/60")}>
      <p className="font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">{label}</p>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{children}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export default async function OstaPropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      enterprise: { select: { id: true, name: true, addonAccess: { where: { enabled: true }, select: { module: true } } } },
      channelConnection: { select: { name: true, provider: true, status: true, managedBy: true, lastHealthCheckAt: true, lastError: true } },
      channelLink: { select: { syncEnabled: true } },
      transportSettings: { select: { enabled: true } },
      _count: { select: { ratePlans: true } },
    },
  })
  if (!property) notFound()

  const now = new Date()
  const facts = (await getPropertyFacts([property], now)).get(property.id)!
  const nowIso = now.toISOString()
  const active = property.status === "ACTIVE"
  const ent = property.enterprise
  const enabledAddons = new Set(ent.addonAccess.map((a) => a.module))

  // Channel: an enterprise-run connection reports running / not running only.
  const conn = property.channelConnection
  const ostaRun = conn?.managedBy === MANAGED_BY.OSTA
  const running = conn?.status === CONNECTION_STATUS.CONNECTED
  const failing = ostaRun && conn?.status === CONNECTION_STATUS.ERROR

  const occupancy = facts.rooms > 0 ? Math.round((facts.inHouse / facts.rooms) * 100) : null
  const overRooms = facts.maxRooms !== null && facts.rooms > facts.maxRooms
  const overTypes = facts.maxRoomTypes !== null && facts.roomTypes > facts.maxRoomTypes
  const dateOff = active && (facts.businessDateState === "BEHIND" || facts.businessDateState === "AHEAD")
  const days = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"}`

  // What needs Osta's eye, most serious first.
  const issues: { tone: "warning" | "danger"; text: string }[] = []
  if (facts.lastAudit?.status === "FAILED") issues.push({ tone: "danger", text: `The last Night Audit (${fmtDate(facts.lastAudit.date)}) failed.` })
  if (overRooms) issues.push({ tone: "danger", text: `${facts.rooms} rooms configured, above the ${facts.maxRooms} licensed.` })
  if (overTypes) issues.push({ tone: "danger", text: `${facts.roomTypes} room types configured, above the ${facts.maxRoomTypes} licensed.` })
  if (failing) issues.push({ tone: "danger", text: `Channel connection "${conn!.name}" is failing.` })
  if (active && facts.businessDateState === "BEHIND")
    issues.push({ tone: "warning", text: `Business date is ${days(facts.businessDateLagDays)} behind the date at the property: Night Audit hasn't been run since ${fmtDate(facts.businessDate)}.` })
  if (active && facts.businessDateState === "AHEAD")
    issues.push({ tone: "warning", text: `Business date is ${days(facts.businessDateLagDays)} ahead of the date at the property.` })
  if (facts.eodInProgress) issues.push({ tone: "warning", text: "A Night Audit was started and hasn't finished." })

  const checklist = [
    { label: "Approved by Osta", done: active },
    { label: "Room types configured", done: facts.roomTypes > 0 },
    { label: "Rooms configured", done: facts.rooms > 0 },
    { label: "Rate plans configured", done: property._count.ratePlans > 0 },
    { label: "First Night Audit run", done: !!facts.lastAudit },
    { label: "Channel manager connected", done: running, optional: true },
  ]
  const setupDone = checklist.filter((c) => !c.optional).every((c) => c.done)

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/osta/enterprises/${ent.id}?tab=properties`} className="text-sm text-muted-foreground hover:underline">
          &larr; {ent.name}
        </Link>
        <PageHeader
          className="mt-1"
          title={
            <>
              {property.name}
              <StatusBadge label={PROPERTY_STATUS_LABEL[property.status] ?? property.status} status={property.status} dot />
            </>
          }
          tabTitle={`${property.name} · Osta`}
          description={
            <span>
              <span className="font-mono">{property.code}</span> · {property.timeZone} · {property.defaultCurrency}
            </span>
          }
          actions={
            property.status === "PENDING" ? (
              <PropertyReviewActions id={property.id} name={property.name} />
            ) : (
              <>
                <Link href={`/osta/monitoring?enterprise=${ent.id}&property=${property.id}`} className={buttonVariants({ variant: "outline" })}>Monitoring</Link>
                <Link href={`/osta/enterprises/${ent.id}?tab=billing`} className={buttonVariants({ variant: "outline" })}>Billing</Link>
              </>
            )
          }
        />
      </div>

      {property.status === "REJECTED" && property.rejectionReason && (
        <p className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <span className="font-semibold">Rejected{property.reviewedAt ? ` on ${fmtDate(property.reviewedAt)}` : ""}:</span> {property.rejectionReason}
        </p>
      )}

      {issues.length > 0 && (
        <ul className="divide-y border border-warning/50 bg-warning/5" aria-label="Needs attention">
          {issues.map((i) => (
            <li key={i.text} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
              <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", i.tone === "danger" ? "text-destructive" : "text-warning")} />
              {i.text}
            </li>
          ))}
        </ul>
      )}

      <WidgetReveal index={0}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Fact
            label="Rooms"
            tone={overRooms ? "danger" : undefined}
            sub={
              <>
                {facts.maxRooms !== null ? `of ${facts.maxRooms} licensed` : "no room limit"}
                {facts.roomsOffline > 0 && ` · ${facts.roomsOffline} out of order/service`}
              </>
            }
          >
            {facts.rooms}
          </Fact>
          <Fact label="Room types" tone={overTypes ? "danger" : undefined} sub={facts.maxRoomTypes !== null ? `of ${facts.maxRoomTypes} licensed` : "no room type limit"}>
            {facts.roomTypes}
          </Fact>
          <Fact
            label="Business date"
            tone={dateOff ? "warning" : undefined}
            sub={
              !active ? "starts when approved" : dateOff ? (
                <span className="font-medium text-warning">
                  {days(facts.businessDateLagDays)} {facts.businessDateState === "BEHIND" ? "behind" : "ahead"} · today is {fmtDate(facts.localToday)}
                </span>
              ) : facts.eodInProgress ? "Night Audit running" : "matches the date at the property"
            }
          >
            <span className={cn("text-xl", dateOff && "text-warning")}>{active && facts.businessDate ? fmtDate(facts.businessDate) : "—"}</span>
          </Fact>
          <Fact label="Occupancy" sub={`${facts.inHouse} in house · ${facts.arrivals} arriving · ${facts.departures} leaving`}>
            {occupancy === null ? "—" : `${occupancy}%`}
          </Fact>
          <Fact label="Last activity" sub={facts.lastActivity ? `${facts.lastActivity.kind} · ${fmtDateTime(facts.lastActivity.at)}` : "nothing recorded yet"}>
            <span className="text-xl">{facts.lastActivity ? ago(facts.lastActivity.at, nowIso) : "—"}</span>
          </Fact>
        </div>
      </WidgetReveal>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <WidgetReveal index={1}>
            <Panel title="Setup" action={<StatusBadge label={setupDone ? "Complete" : "In progress"} tone={setupDone ? "success" : "warning"} dot />}>
              <ul className="grid sm:grid-cols-2">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2.5 border-b px-4 py-2.5 text-sm">
                    {c.done ? <CheckCircle className="h-4 w-4 shrink-0 text-success" /> : <span className="size-4 shrink-0 border border-muted-foreground/50" aria-hidden="true" />}
                    <span className={cn(!c.done && "text-muted-foreground")}>{c.label}</span>
                    {c.optional && <span className="ml-auto text-xs text-muted-foreground">optional</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          </WidgetReveal>

          <WidgetReveal index={2}>
            <Panel title="Property details">
              <dl className="grid py-1 sm:grid-cols-2">
                <div>
                  <Row label="Legal name">{property.legalName}</Row>
                  <Row label="Tax ID">{property.taxId}</Row>
                  <Row label="Star rating">{property.starRating ? `${property.starRating} star` : null}</Row>
                  <Row label="Address">{property.address}</Row>
                  <Row label="Phone">{property.contactPhone}</Row>
                  <Row label="Email">{property.contactEmail}</Row>
                </div>
                <div>
                  <Row label="Currency">{property.defaultCurrency}</Row>
                  <Row label="Time zone">{property.timeZone}</Row>
                  <Row label="Check-in / out">{property.checkInTime} / {property.checkOutTime}</Row>
                  <Row label="Prices include taxes">{property.pricesIncludeTaxes ? "Yes" : "No"}</Row>
                  <Row label="Added">{fmtDate(property.createdAt)}</Row>
                  <Row label="Reviewed">{property.reviewedAt ? fmtDate(property.reviewedAt) : null}</Row>
                </div>
              </dl>
            </Panel>
          </WidgetReveal>
        </div>

        <aside className="space-y-6">
          <WidgetReveal index={3}>
            <Panel title="Night Audit">
              <dl className="divide-y py-1">
                <Row label="Last audited date">{facts.lastAudit ? fmtDate(facts.lastAudit.date) : "Never run"}</Row>
                <Row label="Run">{facts.lastAudit ? fmtDateTime(facts.lastAudit.at) : null}</Row>
                <Row label="Result">
                  {facts.lastAudit ? (
                    <StatusBadge
                      label={facts.lastAudit.status === "COMPLETED" ? "Completed" : facts.lastAudit.status === "FAILED" ? "Failed" : "In progress"}
                      tone={facts.lastAudit.status === "COMPLETED" ? "success" : facts.lastAudit.status === "FAILED" ? "danger" : "warning"}
                      dot
                    />
                  ) : null}
                </Row>
              </dl>
            </Panel>
          </WidgetReveal>

          <WidgetReveal index={4}>
            <Panel title="Channel manager" action={<Link href={`/osta/enterprises/${ent.id}?tab=channel`} className="text-primary hover:underline">Channel tab</Link>}>
              <div className="space-y-1 px-4 py-3 text-sm">
                {!conn ? (
                  <p className="text-muted-foreground">Not connected.</p>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={running ? "Running" : failing ? "Failing" : "Not running"} tone={running ? "success" : failing ? "danger" : "neutral"} dot />
                      <span className="text-muted-foreground">{ostaRun ? "set up by Osta" : "the enterprise's own account"}</span>
                    </p>
                    {ostaRun && (
                      <>
                        <p className="text-muted-foreground">{conn.name} · {conn.provider} · sync {property.channelLink?.syncEnabled ? "on" : "off"}</p>
                        {conn.lastHealthCheckAt && <p className="text-xs text-muted-foreground">Checked {ago(conn.lastHealthCheckAt.toISOString(), nowIso)}</p>}
                        {conn.lastError && <p className="text-xs text-destructive">{conn.lastError}</p>}
                      </>
                    )}
                  </>
                )}
              </div>
            </Panel>
          </WidgetReveal>

          <WidgetReveal index={5}>
            <Panel title="Add-ons" action={<Link href={`/osta/enterprises/${ent.id}?tab=modules`} className="text-primary hover:underline">Manage</Link>}>
              <p className="px-4 pt-3 text-xs text-muted-foreground">Sold to {ent.name}; every property in it shares them.</p>
              <ul className="divide-y py-1">
                {SELLABLE.map((key) => {
                  const on = enabledAddons.has(key)
                  // Transportation also needs this property's own switch in the Hub (T-1).
                  const offHere = key === "TRANSPORTATION" && on && !property.transportSettings?.enabled
                  return (
                    <li key={key} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className={cn(!on && "text-muted-foreground")}>{addonLabel(key)}</span>
                      {!on ? (
                        <span className="text-xs text-muted-foreground">Not purchased</span>
                      ) : offHere ? (
                        <StatusBadge label="Off at this property" tone="neutral" dot />
                      ) : (
                        <StatusBadge label="On" tone="success" dot />
                      )}
                    </li>
                  )
                })}
              </ul>
            </Panel>
          </WidgetReveal>
        </aside>
      </div>
    </div>
  )
}
