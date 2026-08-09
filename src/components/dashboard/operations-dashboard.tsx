"use client"

import * as React from "react"
import Link from "next/link"
import { useProperty } from "@/components/providers/property-provider"
import { useSystemCodeLabels } from "@/hooks/use-system-code-labels"
import { countryNameFor } from "@/lib/countries"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  BedDouble,
  Calculator,
  CalendarDays,
  ClipboardList,
  Compass,
  Contact,
  DollarSign,
  History,
  Landmark,
  Layers,
  Lock,
  Percent,
  RefreshCw,
  Sparkles,
  Store,
  TrendingUp,
  UsersRound,
  Wallet,
  Wrench,
} from "@/components/icons"
import {
  ChartLegend,
  ChartTableView,
  ColumnChart,
  DonutChart,
  LineChart,
  Meter,
  RankedBars,
  StackedBar,
  hueFor,
  type SeriesDef,
} from "@/components/dashboard/charts"
import { DataRow, Panel, PanelLink, StatTile, TileEmpty, axisLabel, fullDateLabel, makeMoneyFormatter, pct } from "@/components/dashboard/tiles"
import type { DashboardOverview, OverviewWorklistRow } from "@/lib/dashboard/overview"

// The Operations Dashboard.
//
// PERMISSION MODEL — the one thing to keep true when editing this file: a tile is
// rendered if and only if its section is PRESENT in the payload, and the payload only
// carries sections the caller holds `canView` on (see src/lib/dashboard/overview.ts).
// So `data.revenue && <RevenueTile/>` is not a cosmetic check — it is the client half of
// a gate whose authoritative half is the server. Never render a tile from a permission
// flag passed down separately, and never fall back to a default when a section is
// missing: missing means "not allowed to see", not "no data".
//
// LAYOUT — one dense auto-flow grid rather than fixed rows. Any combination of hidden
// tiles closes up on its own, so a Housekeeping-only user gets a tidy two-tile page
// instead of a page full of holes.

const REFRESH_MS = 120_000
const RANGES = [7, 14, 30] as const

/** Revenue buckets keep a FIXED hue slot, so filtering or a quiet F&B day never repaints
 *  the other segments. Colour follows the entity, never its rank. */
const BUCKET_SLOT: Record<string, number> = { ROOM: 0, FOOD_BEVERAGE: 1, OTHER: 2, TRANSPORT: 3 }

const ROOM_STATUS_TONE: Record<string, { label: string; color: string }> = {
  INSPECTED: { label: "Inspected", color: "var(--info)" },
  CLEAN: { label: "Clean", color: "var(--success)" },
  DIRTY: { label: "Dirty", color: "var(--destructive)" },
  OUT_OF_ORDER: { label: "Out of order", color: "var(--muted-foreground)" },
  OUT_OF_SERVICE: { label: "Out of service", color: "var(--muted-foreground)" },
}

export function OperationsDashboard({ enterprisePrefix }: { enterprisePrefix: string }) {
  const { currentProperty, loading: propertyLoading } = useProperty()
  const { label: codeLabel } = useSystemCodeLabels()

  const [data, setData] = React.useState<DashboardOverview | null>(null)
  const [range, setRange] = React.useState<(typeof RANGES)[number]>(14)
  const [refreshing, setRefreshing] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  const propertyId = currentProperty?.id ?? null

  // Deliberately touches no state before its first await: this runs straight from an
  // effect, and a synchronous setState there cascades a second render before paint.
  // "Loading" is therefore derived (no data + no error), not a flag.
  const load = React.useCallback(async () => {
    if (!propertyId) return
    try {
      const res = await fetch(`/api/dashboard/overview?propertyId=${propertyId}&trendDays=${range}`)
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setRefreshing(false)
    }
  }, [propertyId, range])

  // First load, and again whenever the property or the trend range changes. A range
  // change holds the current render (see `refreshing`) instead of flashing skeletons.
  React.useEffect(() => {
    void load()
  }, [load])

  // Quiet background refresh — the desk leaves this open all shift.
  React.useEffect(() => {
    if (!propertyId) return
    const t = setInterval(() => {
      setRefreshing(true)
      void load()
    }, REFRESH_MS)
    return () => clearInterval(t)
  }, [propertyId, load])

  const money = React.useMemo(() => makeMoneyFormatter(data?.property.currency ?? "USD"), [data?.property.currency])
  const refresh = () => {
    setRefreshing(true)
    void load()
  }

  if (!propertyLoading && !propertyId) {
    return <ErrorState title="No property selected" description="Pick a property from the account menu to see its dashboard." />
  }
  if (failed && !data) return <ErrorState title="Couldn't load the dashboard" onRetry={refresh} />
  if (!data) return <DashboardSkeleton />

  const dash = `${enterprisePrefix}/dashboard`
  const t = data.trend
  const nationalityLabel = (code: string) => codeLabel("NATIONALITY", code) ?? countryNameFor(code) ?? code

  // Nothing at all authorized — a real state, not an error. Says so plainly rather than
  // rendering an empty page that looks broken.
  if (data.visibleSections.length === 0) {
    return (
      <div className="space-y-6">
        <DashboardHeading data={data} />
        <div className="rounded-2xl bg-card ring-1 ring-foreground/5">
          <EmptyState
            icon={Lock}
            title="No dashboard tiles available"
            description="Your role doesn't include view access to any of the areas this dashboard reports on. Ask an administrator if you think that's wrong."
          />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-5 transition-opacity duration-200", refreshing && "opacity-70")}>
      <DashboardHeading
        data={data}
        action={
          <div className="flex items-center gap-2">
            {/* One filter row scoping every chart below — never a per-card control. */}
            <div className="flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Trend range">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    range === r ? "bg-card text-foreground shadow-elevation-1" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      <OpsRibbon data={data} dash={dash} />

      {/* ── KPI strip ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.occupancy && (
          <StatTile
            label="Occupancy"
            value={pct(data.occupancy.occupancyPct)}
            footnote={`${data.occupancy.roomsSold} of ${data.occupancy.totalRooms} rooms sold`}
            icon={Percent}
            accent={hueFor(0)}
            href={`${dash}/front-office`}
            delta={
              data.occupancy.occupancyPctLastWeek !== null
                ? { value: data.occupancy.occupancyPct - data.occupancy.occupancyPctLastWeek, suffix: "pts", period: "vs last week" }
                : null
            }
            trend={t?.hasOccupancy ? t.points.filter((p) => !p.future).map((p) => p.occupancy ?? 0) : undefined}
          />
        )}
        {data.revenue && (
          <StatTile
            label="ADR"
            value={money.short(data.revenue.adr)}
            footnote={`MTD ${money.short(data.revenue.monthToDate.adr)}`}
            icon={TrendingUp}
            accent={hueFor(1)}
            href={`${dash}/revenue`}
            delta={data.revenue.adrLastWeek !== null ? { value: data.revenue.adr - data.revenue.adrLastWeek, period: "vs last week" } : null}
            trend={t?.hasRevenue ? t.points.filter((p) => !p.future).map((p) => p.adr ?? 0) : undefined}
          />
        )}
        {data.revenue && (
          <StatTile
            label="RevPAR"
            value={money.short(data.revenue.revpar)}
            footnote="Revenue per available room"
            icon={BedDouble}
            accent={hueFor(2)}
            href={`${dash}/revenue`}
            trend={t?.hasRevenue ? t.points.filter((p) => !p.future).map((p) => p.revpar ?? 0) : undefined}
          />
        )}
        {data.revenue && (
          <StatTile
            label="Revenue today"
            value={money.short(data.revenue.today.total)}
            footnote={`Room ${money.short(data.revenue.today.room)} · Other ${money.short(data.revenue.today.nonRoom)}`}
            icon={DollarSign}
            accent={hueFor(3)}
            href={`${dash}/revenue`}
            delta={
              data.revenue.totalRevenueLastWeek
                ? {
                    value: ((data.revenue.today.total - data.revenue.totalRevenueLastWeek) / data.revenue.totalRevenueLastWeek) * 100,
                    suffix: "%",
                    period: "vs last week",
                  }
                : null
            }
            trend={t?.hasRevenue ? t.points.filter((p) => !p.future).map((p) => p.totalRevenue ?? 0) : undefined}
          />
        )}
        {data.occupancy && (
          <StatTile
            label="In-house guests"
            value={String(data.occupancy.adults + data.occupancy.children)}
            footnote={`${data.occupancy.adults} adults · ${data.occupancy.children} children${data.occupancy.infants ? ` · ${data.occupancy.infants} infants` : ""}`}
            icon={UsersRound}
            accent={hueFor(0)}
            href={`${dash}/front-office`}
          />
        )}
        {data.cashiering && (
          <StatTile
            label="Payments today"
            value={money.short(data.cashiering.netToday)}
            footnote={`${data.cashiering.openShifts} open shift${data.cashiering.openShifts === 1 ? "" : "s"} · ${data.cashiering.openFolios} open folios`}
            icon={Wallet}
            accent={hueFor(1)}
            href={`${dash}/cashiering`}
          />
        )}
        {data.debtors && (
          <StatTile
            label="Accounts receivable"
            value={money.short(data.debtors.totalOutstanding)}
            footnote={`${data.debtors.invoiceCount} open invoice${data.debtors.invoiceCount === 1 ? "" : "s"}`}
            icon={Landmark}
            accent={hueFor(2)}
            href={`${dash}/debtors`}
          />
        )}
        {data.reservations && (
          <StatTile
            label="On the books"
            value={String(data.reservations.onTheBooksNext7)}
            footnote={`Room nights, next 7 days · ${data.reservations.createdLast7} booked this week`}
            icon={CalendarDays}
            accent={hueFor(3)}
            href={`${dash}/reservations`}
          />
        )}
      </div>

      {/* ── Panels. One dense auto-flow grid: hidden tiles close their own gap. ──── */}
      <div className="grid auto-rows-min grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Trend — deliberately two stacked plots on ONE shared x-axis, never a second
            y-scale on the same plot. Two scales on one frame invent a correlation. */}
        {t && (t.hasOccupancy || t.hasRevenue) && (
          <Panel
            title="Occupancy & rate trend"
            description={`${data.trendDays} days back, 7 days on the books`}
            icon={TrendingUp}
            className="md:col-span-2"
            action={<PanelLink href={`${dash}/reservations/tape-chart`}>Tape chart</PanelLink>}
          >
            {t.hasOccupancy && (
              <>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">Occupancy</span>
                  {/* One series, two states — so the key distinguishes by the same
                      channel the chart uses (fill strength), not by a second hue. */}
                  <ul className="flex items-center gap-3 text-xs text-muted-foreground">
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: hueFor(0) }} />
                      Actual
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] opacity-40" style={{ background: hueFor(0) }} />
                      On the books
                    </li>
                  </ul>
                </div>
                <ColumnChart
                  ariaLabel="Occupancy percentage by night"
                  height={140}
                  xLabels={!t.hasRevenue}
                  format={(n) => `${Math.round(n)}%`}
                  series={[{ key: "occ", label: "Occupancy", color: hueFor(0) }]}
                  points={t.points.map((p) => ({
                    label: axisLabel(p.date),
                    sub: fullDateLabel(p.date),
                    values: [p.occupancy ?? 0],
                    muted: p.future,
                  }))}
                />
              </>
            )}
            {t.hasRevenue && (
              <>
                <p className="mt-3 mb-1 text-xs font-medium text-muted-foreground">Average daily rate</p>
                <LineChart
                  ariaLabel="Average daily rate by night"
                  seriesLabel="ADR"
                  height={120}
                  color={hueFor(1)}
                  format={(n) => money.short(n)}
                  points={t.points.map((p) => ({ label: axisLabel(p.date), sub: fullDateLabel(p.date), value: p.adr }))}
                />
              </>
            )}
            <ChartTableView
              caption="Occupancy and rate by night"
              columns={["Night", "Rooms", "Occupancy", "Room revenue", "ADR"]}
              rows={t.points.map((p) => [
                fullDateLabel(p.date),
                p.roomsSold ?? "—",
                p.occupancy !== null ? pct(p.occupancy) : "—",
                p.roomRevenue !== null ? money.exact(p.roomRevenue) : p.future ? "on the books" : "—",
                p.adr !== null ? money.exact(p.adr) : "—",
              ])}
            />
          </Panel>
        )}

        {/* Revenue mix — part-to-whole at a glance, ≤ 6 segments. */}
        {data.revenue && (
          <Panel title="Revenue mix" description="Posted today, by reporting bucket" icon={DollarSign} action={<PanelLink href={`${dash}/reports`}>Reports</PanelLink>}>
            {data.revenue.today.byBucket.length === 0 ? (
              <TileEmpty>Nothing posted yet today.</TileEmpty>
            ) : (
              <>
                <div className="flex justify-center">
                  <DonutChart
                    ariaLabel="Revenue by bucket today"
                    slices={data.revenue.today.byBucket.map((b) => ({ label: b.label, value: b.amount, color: hueFor(BUCKET_SLOT[b.bucket] ?? 4) }))}
                    centerValue={money.short(data.revenue.today.total)}
                    centerLabel="posted today"
                    format={money.exact}
                  />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {data.revenue.today.byBucket.map((b) => (
                    <li key={b.bucket} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: hueFor(BUCKET_SLOT[b.bucket] ?? 4) }} />
                        <span className="truncate">{b.label}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-foreground">{money.exact(b.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-border/60 pt-2">
                  <DataRow label="Month to date" value={money.exact(data.revenue.monthToDate.total)} />
                  <DataRow label="MTD occupancy" value={pct(data.revenue.monthToDate.occupancyPct)} />
                </div>
              </>
            )}
          </Panel>
        )}

        {/* Movements */}
        {data.occupancy && (
          <Panel title="Today's movements" description="Arrivals, departures and room availability" icon={CalendarDays} action={<PanelLink href={`${dash}/front-office`}>Front desk</PanelLink>}>
            <div className="space-y-4">
              <MovementMeter
                label="Arrivals"
                done={data.occupancy.arrivals.completed}
                total={data.occupancy.arrivals.expected}
                pending={data.occupancy.arrivals.pending}
                tone={hueFor(0)}
              />
              <MovementMeter
                label="Departures"
                done={data.occupancy.departures.completed}
                total={data.occupancy.departures.expected}
                pending={data.occupancy.departures.pending}
                tone={hueFor(1)}
              />
              <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                <Figure value={data.occupancy.vacantReady} label="Vacant ready" />
                <Figure value={data.occupancy.vacantDirty} label="Vacant dirty" tone={data.occupancy.vacantDirty > 0 ? "warning" : undefined} />
                <Figure value={data.occupancy.outOfOrder + data.occupancy.outOfService} label="Out of service" tone={data.occupancy.outOfOrder + data.occupancy.outOfService > 0 ? "danger" : undefined} />
              </div>
            </div>
          </Panel>
        )}

        {/* Housekeeping */}
        {data.housekeeping && (
          <Panel title="Rooms & housekeeping" description="Status of every room right now" icon={ClipboardList} action={<PanelLink href={`${dash}/housekeeping`}>Housekeeping</PanelLink>}>
            {data.housekeeping.statusMix.length === 0 ? (
              <TileEmpty>No rooms configured yet.</TileEmpty>
            ) : (
              <>
                <div className="flex justify-center">
                  <DonutChart
                    ariaLabel="Room status mix"
                    size={148}
                    slices={data.housekeeping.statusMix.map((s) => ({
                      label: ROOM_STATUS_TONE[s.status]?.label ?? s.status,
                      value: s.count,
                      color: ROOM_STATUS_TONE[s.status]?.color ?? "var(--muted-foreground)",
                    }))}
                    centerValue={String(data.housekeeping.statusMix.reduce((a, b) => a + b.count, 0))}
                    centerLabel="rooms"
                  />
                </div>
                <ul className="mt-3 space-y-1">
                  {data.housekeeping.statusMix.map((s) => (
                    <li key={s.status} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: ROOM_STATUS_TONE[s.status]?.color ?? "var(--muted-foreground)" }} />
                        {ROOM_STATUS_TONE[s.status]?.label ?? s.status}
                      </span>
                      <span className="font-medium tabular-nums text-foreground">{s.count}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 border-t border-border/60 pt-2">
                  <DataRow label="Tasks today" value={`${data.housekeeping.tasks.completed} / ${data.housekeeping.tasks.total} done`} />
                  <DataRow
                    label="Dirty & unoccupied"
                    value={data.housekeeping.discrepancies}
                    tone={data.housekeeping.discrepancies > 0 ? "danger" : "success"}
                  />
                </div>
              </>
            )}
          </Panel>
        )}

        {/* Booking pace */}
        {data.reservations && (
          <Panel
            title="Booking pace"
            description={`Reservations created and cancelled, last ${data.trendDays} days`}
            icon={CalendarDays}
            className="md:col-span-2"
            action={<PanelLink href={`${dash}/reservations`}>Reservations</PanelLink>}
          >
            <ChartLegend className="mb-2" series={PACE_SERIES} />
            <ColumnChart
              ariaLabel="Reservations created and cancelled per day"
              height={150}
              series={PACE_SERIES}
              points={data.reservations.pace.map((p) => ({
                label: axisLabel(p.date),
                sub: fullDateLabel(p.date),
                values: [p.created, p.cancelled],
              }))}
            />
            <div className="mt-3 grid grid-cols-2 gap-x-6 border-t border-border/60 pt-2 sm:grid-cols-4">
              <DataRow label="Booked (7d)" value={data.reservations.createdLast7} />
              <DataRow label="Cancelled (7d)" value={data.reservations.cancelledLast7} tone={data.reservations.cancelledLast7 > 0 ? "danger" : undefined} />
              <DataRow label="No-shows (7d)" value={data.reservations.noShowLast7} tone={data.reservations.noShowLast7 > 0 ? "danger" : undefined} />
              <DataRow label="Avg lead time" value={data.reservations.avgLeadTimeDays !== null ? `${data.reservations.avgLeadTimeDays} d` : "—"} />
            </div>
            <ChartTableView
              caption="Reservations created and cancelled per day"
              columns={["Day", "Created", "Cancelled"]}
              rows={data.reservations.pace.map((p) => [fullDateLabel(p.date), p.created, p.cancelled])}
            />
          </Panel>
        )}

        {/* Payments */}
        {data.cashiering && (
          <Panel title="Payments by method" description="Taken on today's business date" icon={Wallet} action={<PanelLink href={`${dash}/cashiering`}>Cashiering</PanelLink>}>
            {data.cashiering.byMethod.length === 0 ? (
              <TileEmpty>No payments taken yet today.</TileEmpty>
            ) : (
              <>
                <RankedBars rows={data.cashiering.byMethod.map((m) => ({ label: m.name, value: m.amount, hint: money.short(m.amount) }))} color={hueFor(0)} />
                <div className="mt-3 border-t border-border/60 pt-2">
                  <DataRow label="Receipts" value={money.exact(data.cashiering.receiptsToday)} tone="success" />
                  <DataRow label="Refunds" value={money.exact(data.cashiering.refundsToday)} tone={data.cashiering.refundsToday > 0 ? "danger" : undefined} />
                  <DataRow label="Net" value={money.exact(data.cashiering.netToday)} />
                </div>
                <ChartTableView
                  caption="Payments by method"
                  columns={["Method", "Count", "Amount"]}
                  rows={data.cashiering.byMethod.map((m) => [m.name, m.count, money.exact(m.amount)])}
                />
              </>
            )}
          </Panel>
        )}

        {/* AR aging — ordered age bands, so a single-hue light→dark ramp, not five hues. */}
        {data.debtors && (
          <Panel title="Receivables aging" description="Open city-ledger invoices by age" icon={Landmark} action={<PanelLink href={`${dash}/debtors`}>Debtors</PanelLink>}>
            {data.debtors.invoiceCount === 0 ? (
              <TileEmpty>No open debtor invoices.</TileEmpty>
            ) : (
              <>
                <RankedBars
                  ordinal
                  color={hueFor(0)}
                  rows={[
                    { label: "Current", value: data.debtors.buckets.current, hint: money.short(data.debtors.buckets.current) },
                    { label: "1–30 days", value: data.debtors.buckets["1-30"], hint: money.short(data.debtors.buckets["1-30"]) },
                    { label: "31–60 days", value: data.debtors.buckets["31-60"], hint: money.short(data.debtors.buckets["31-60"]) },
                    { label: "61–90 days", value: data.debtors.buckets["61-90"], hint: money.short(data.debtors.buckets["61-90"]) },
                    { label: "Over 90 days", value: data.debtors.buckets["90+"], hint: money.short(data.debtors.buckets["90+"]) },
                  ]}
                />
                {data.debtors.top.length > 0 && (
                  <div className="mt-3 border-t border-border/60 pt-2">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Largest balances</p>
                    {data.debtors.top.map((a) => (
                      <DataRow key={a.name} label={a.name} value={money.exact(a.amount)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
        )}

        {/* Maintenance */}
        {data.maintenance && (
          <Panel title="Maintenance" description="Open and in-progress work orders" icon={Wrench} action={<PanelLink href={`${dash}/maintenance`}>Work orders</PanelLink>}>
            {data.maintenance.open + data.maintenance.inProgress === 0 ? (
              <TileEmpty>No open work orders. Everything is in service.</TileEmpty>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <Figure value={data.maintenance.open} label="Open" tone={data.maintenance.open > 0 ? "danger" : undefined} />
                  <Figure value={data.maintenance.inProgress} label="In progress" />
                  <Figure value={data.maintenance.roomsOutOfService} label="Rooms down" tone={data.maintenance.roomsOutOfService > 0 ? "warning" : undefined} />
                </div>
                <StackedBar
                  ariaLabel="Open work orders by priority"
                  segments={data.maintenance.byPriority.map((p) => ({
                    label: p.priority,
                    value: p.count,
                    color: p.priority === "HIGH" ? "var(--destructive)" : p.priority === "MEDIUM" ? "var(--warning)" : "var(--muted-foreground)",
                  }))}
                />
                <ul className="mt-3 space-y-1.5">
                  {data.maintenance.recent.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2 border-b border-border/50 pb-1.5 text-xs last:border-0">
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">Room {m.roomNumber}</span>
                        <span className="ml-1.5 text-muted-foreground">{m.description}</span>
                      </span>
                      <StatusBadge label={m.priority} status={m.priority === "HIGH" ? "OPEN" : m.priority === "MEDIUM" ? "PENDING" : "INACTIVE"} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}

        {/* Worklists */}
        {data.worklists && (
          <Panel title="Arrivals to check in" description="Still expected today" icon={BedDouble} action={<PanelLink href={`${dash}/front-office`}>Check in</PanelLink>}>
            <WorklistRows rows={data.worklists.arrivals} money={money} empty="Every arrival is checked in." dash={dash} />
          </Panel>
        )}
        {data.worklists && (
          <Panel title="Departures to settle" description="Due out today" icon={Wallet} action={<PanelLink href={`${dash}/front-office`}>Check out</PanelLink>}>
            <WorklistRows rows={data.worklists.departures} money={money} empty="Every departure is settled." dash={dash} showBalance />
          </Panel>
        )}
        {data.worklists && (
          <Panel title="Open alerts" description="Unresolved traces on live reservations" icon={AlertTriangle} action={<PanelLink href={`${dash}/front-office`}>Front desk</PanelLink>}>
            {data.worklists.alerts.length === 0 ? (
              <TileEmpty>No open alerts.</TileEmpty>
            ) : (
              <ul className="space-y-2">
                {data.worklists.alerts.map((a) => (
                  <li key={a.id} className="border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0">
                    <Link
                      href={`${dash}/reservations/${a.reservationId}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {a.guestName}
                    </Link>
                    <span className="ml-1.5 text-muted-foreground">{a.confirmationNo}</span>
                    <p className="mt-0.5 text-muted-foreground">
                      <span className="font-medium">{a.traceType}</span> — {a.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Guest mix */}
        {data.profiles && (
          <Panel title="Guest mix" description="Who is in the house" icon={Contact} action={<PanelLink href={`${dash}/profiles`}>Client relations</PanelLink>}>
            {data.profiles.inHouseNationalities.length === 0 ? (
              <TileEmpty>No in-house guests to profile.</TileEmpty>
            ) : (
              <RankedBars
                color={hueFor(0)}
                rows={data.profiles.inHouseNationalities.map((n) => ({ label: nationalityLabel(n.code), value: n.count }))}
              />
            )}
            <div className="mt-3 border-t border-border/60 pt-2">
              <DataRow label="VIPs in house" value={data.profiles.vipInHouse} />
              <DataRow label="Repeat guests" value={data.profiles.repeatGuestPct !== null ? pct(data.profiles.repeatGuestPct) : "—"} />
              <DataRow label="New profiles (7d)" value={data.profiles.newProfiles7d} />
            </div>
          </Panel>
        )}

        {/* Outlets */}
        {data.pos && (
          <Panel title="Outlet sales" description="Posted through Fast Post today" icon={Store} action={<PanelLink href={`${dash}/pos`}>Fast Post</PanelLink>}>
            {data.pos.byOutlet.length === 0 ? (
              <TileEmpty>No outlet sales posted today.</TileEmpty>
            ) : (
              <>
                <RankedBars color={hueFor(0)} rows={data.pos.byOutlet.map((o) => ({ label: o.name, value: o.amount, hint: money.short(o.amount) }))} />
                <div className="mt-3 border-t border-border/60 pt-2">
                  <DataRow label="Checks opened" value={data.pos.checksToday} />
                  <DataRow label="Total sales" value={money.exact(data.pos.salesToday)} />
                </div>
              </>
            )}
          </Panel>
        )}

        {/* Group blocks */}
        {data.groups && (
          <Panel title="Group blocks" description="In house or arriving within a week" icon={Layers} action={<PanelLink href={`${dash}/groups`}>Groups</PanelLink>}>
            {data.groups.active.length === 0 ? (
              <TileEmpty>No active group blocks.</TileEmpty>
            ) : (
              <ul className="space-y-2.5">
                {data.groups.active.map((g) => (
                  <li key={g.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`${dash}/groups/${g.id}`} className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline">
                        {g.name}
                      </Link>
                      <StatusBadge label={g.status} status={g.status} />
                    </div>
                    <p className="mt-0.5 text-muted-foreground">
                      {g.code} · {g.pickedUp} of {g.roomsHeld} rooms picked up
                    </p>
                    <Meter value={g.pickedUp} max={Math.max(g.roomsHeld, g.pickedUp)} tone={hueFor(0)} label={`${g.name} pickup`} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Spa */}
        {data.spa && (
          <Panel title="Spa today" description={`${data.spa.count} appointment${data.spa.count === 1 ? "" : "s"} booked`} icon={Sparkles} action={<PanelLink href={`${dash}/spa`}>Spa</PanelLink>}>
            {data.spa.upcoming.length === 0 ? (
              <TileEmpty>No appointments today.</TileEmpty>
            ) : (
              <ul className="space-y-1.5">
                {data.spa.upcoming.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 text-xs last:border-0">
                    <span className="min-w-0 truncate">
                      <span className="font-medium tabular-nums text-foreground">{a.startTime}</span>
                      <span className="ml-2 text-muted-foreground">{a.treatment} — {a.guest}</span>
                    </span>
                    <StatusBadge label={a.status.replace(/_/g, " ")} status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Excursions */}
        {data.excursions && (
          <Panel
            title="Excursions today"
            description={`${data.excursions.count} departure${data.excursions.count === 1 ? "" : "s"} scheduled`}
            icon={Compass}
            action={<PanelLink href={`${dash}/excursions`}>Excursions</PanelLink>}
          >
            {data.excursions.departures.length === 0 ? (
              <TileEmpty>No departures today.</TileEmpty>
            ) : (
              <ul className="space-y-2.5">
                {data.excursions.departures.map((d) => (
                  <li key={d.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium tabular-nums text-foreground">{d.time}</span>
                        <span className="ml-2 text-muted-foreground">{d.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {d.booked}/{d.capacity}
                      </span>
                    </div>
                    <Meter value={d.booked} max={Math.max(d.capacity, d.booked)} tone={hueFor(0)} label={`${d.name} load`} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Activity */}
        {data.activity && (
          <Panel title="Recent activity" description="Latest audited actions in this enterprise" icon={History} className="md:col-span-2 xl:col-span-1" action={<PanelLink href={`${dash}/activity-log`}>Activity log</PanelLink>}>
            {data.activity.length === 0 ? (
              <TileEmpty>Nothing recorded yet.</TileEmpty>
            ) : (
              <ul className="space-y-2">
                {data.activity.map((a) => (
                  <li key={a.id} className="border-b border-border/50 pb-2 text-xs last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium text-foreground">{a.user}</span>
                      <time className="shrink-0 tabular-nums text-muted-foreground" dateTime={a.at}>
                        {new Date(a.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </time>
                    </div>
                    <p className="truncate text-muted-foreground">{a.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}

const PACE_SERIES: SeriesDef[] = [
  { key: "created", label: "Created", color: hueFor(0) },
  { key: "cancelled", label: "Cancelled", color: hueFor(1) },
]

// ── Sub-components ────────────────────────────────────────────────────────────────

function DashboardHeading({ data, action }: { data: DashboardOverview; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Operations Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {data.property.name} · business date {fullDateLabel(data.property.businessDate)}
        </p>
      </div>
      {action}
    </div>
  )
}

/** The thin status line above the tiles: is the day closed, is a drawer open, is the
 *  channel feed healthy. Each chip is independently permission-gated by its section. */
function OpsRibbon({ data, dash }: { data: DashboardOverview; dash: string }) {
  const chips: React.ReactNode[] = []

  if (data.nightAudit) {
    const na = data.nightAudit
    const tone = na.inProgress ? "warning" : na.daysBehind > 1 ? "danger" : "success"
    chips.push(
      <Chip
        key="na"
        icon={Calculator}
        tone={tone}
        href={`${dash}/financials/night-audit`}
        label={
          na.inProgress
            ? `Night Audit running — step ${na.stepsDone + 1} of ${na.totalSteps}`
            : na.daysBehind > 1
              ? `Night Audit ${na.daysBehind} days behind`
              : `Night Audit up to date${na.lastCompletedBusinessDate ? ` — last closed ${fullDateLabel(na.lastCompletedBusinessDate)}` : ""}`
        }
      />
    )
  }

  if (data.cashiering) {
    chips.push(
      <Chip
        key="shift"
        icon={Wallet}
        tone={data.cashiering.openShifts > 0 ? "info" : "neutral"}
        href={`${dash}/cashiering`}
        label={`${data.cashiering.openShifts} cashier shift${data.cashiering.openShifts === 1 ? "" : "s"} open`}
      />
    )
  }

  if (data.integrations) {
    const i = data.integrations
    const unhealthy = i.failedInbound > 0 || i.syncErrors24h > 0
    chips.push(
      <Chip
        key="chan"
        icon={Layers}
        tone={i.connections === 0 ? "neutral" : unhealthy ? "danger" : "success"}
        label={
          i.connections === 0
            ? "No channel connections"
            : unhealthy
              ? `Channel issues — ${i.failedInbound} failed, ${i.syncErrors24h} sync errors (24h)`
              : `${i.activeConnections}/${i.connections} channels connected${i.pendingInbound ? ` · ${i.pendingInbound} pending` : ""}`
        }
      />
    )
  }

  if (chips.length === 0) return null
  return <div className="flex flex-wrap items-center gap-2">{chips}</div>
}

const CHIP_TONES: Record<string, string> = {
  success: "bg-success-muted text-success ring-success/25",
  warning: "bg-warning-muted text-warning ring-warning/25",
  danger: "bg-destructive-muted text-destructive ring-destructive/25",
  info: "bg-info-muted text-info ring-info/25",
  neutral: "bg-muted text-muted-foreground ring-border",
}

function Chip({
  icon: Icon,
  label,
  tone,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone: string
  href?: string
}) {
  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </>
  )
  const className = cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
    CHIP_TONES[tone] ?? CHIP_TONES.neutral,
    href && "transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  )
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  )
}

function MovementMeter({ label, done, total, pending, tone }: { label: string; done: number; total: number; pending: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{done}</span> of {total} done
          {pending > 0 && <span className="ml-1.5 text-warning">· {pending} pending</span>}
        </span>
      </div>
      <Meter value={done} max={Math.max(total, 1)} tone={tone} label={`${label}: ${done} of ${total}`} />
    </div>
  )
}

function Figure({ value, label, tone }: { value: number; label: string; tone?: "warning" | "danger" }) {
  return (
    <div>
      <p className={cn("text-lg font-semibold leading-none", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground")}>
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  )
}

function WorklistRows({
  rows,
  money,
  empty,
  dash,
  showBalance,
}: {
  rows: OverviewWorklistRow[]
  money: ReturnType<typeof makeMoneyFormatter>
  empty: string
  dash: string
  showBalance?: boolean
}) {
  if (rows.length === 0) return <TileEmpty>{empty}</TileEmpty>
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 text-xs last:border-0">
          <span className="min-w-0">
            <Link
              href={`${dash}/reservations/${r.id}`}
              className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {r.guestName}
            </Link>
            {r.flag && <span className="ml-1.5 rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning">{r.flag}</span>}
            <span className="block truncate text-muted-foreground">
              {r.roomNumber ? `Room ${r.roomNumber}` : r.roomTypeName ?? "Unassigned"} · {r.nights} night{r.nights === 1 ? "" : "s"}
            </span>
          </span>
          {showBalance && (
            <span className={cn("shrink-0 tabular-nums", r.balance > 0.005 ? "font-medium text-destructive" : "text-success")}>
              {money.short(r.balance)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl md:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  )
}
