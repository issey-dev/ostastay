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
  LayoutDashboard,
  Lock,
  Percent,
  RefreshCw,
  Settings,
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
import { WidgetShell } from "@/components/dashboard/widget-shell"
import { DashboardSettings } from "@/components/dashboard/dashboard-settings"
import { toast } from "@/lib/toast"
import {
  SIZE_CLASS,
  defaultLayout,
  fetchLayout,
  moveWidget,
  nudgeWidget,
  persistLayout,
  reconcile,
  resetStoredLayout,
  type DashboardLayout,
} from "@/lib/dashboard/layout"
import { CATALOG_BY_ID, WIDGET_CATALOG } from "@/lib/dashboard/widgets"
import type { DashboardOverview, OverviewWorklistRow } from "@/lib/dashboard/overview"

// The Operations Dashboard.
//
// PERMISSION MODEL — the one thing to keep true when editing this file: a widget is
// rendered if and only if its section is PRESENT in the payload, and the payload only
// carries sections the caller holds `canView` on (see src/lib/dashboard/overview.ts).
// So `data.revenue && <RevenueTile/>` is not a cosmetic check — it is the client half of
// a gate whose authoritative half is the server. Never render a widget from a permission
// flag passed down separately, and never fall back to a default when a section is
// missing: missing means "not allowed to see", not "no data".
//
// That gate also outranks the user's own layout. A widget the payload did not carry is
// absent from `nodes`, so it cannot be rendered, cannot be un-hidden in the settings
// dialog, and does not appear in its widget list — hiding a card is a preference, and a
// preference must never be mistaken for (or capable of relaxing) an access decision.
//
// LAYOUT — every widget is an entry in WIDGET_CATALOG rendered inside one dense 12-column
// grid, arranged by a per-user layout (src/lib/dashboard/layout.ts): visible or not, how
// wide, which page, in what order. Two consequences worth knowing before editing:
//   · The catalogue itself lives in src/lib/dashboard/widgets.ts, because the SERVER reads
//     it too — the overview endpoint answers which widgets a session's roles permit, and
//     the role editor renders its checkboxes from the same list. Adding a widget means an
//     entry there AND a `nodes` key here with the same id.
//   · Widget ids are persisted (saved layouts, per-role block rows). See widgets.ts.

const REFRESH_MS = 120_000
const RANGES = [7, 14, 30] as const

/** Revenue buckets keep a FIXED ramp slot, so filtering or a quiet F&B day never repaints
 *  the other segments. Colour follows the entity, never its rank. */
const BUCKET_SLOT: Record<string, number> = { ROOM: 0, FOOD_BEVERAGE: 1, OTHER: 2, TRANSPORT: 3 }

const ROOM_STATUS_TONE: Record<string, { label: string; color: string }> = {
  INSPECTED: { label: "Inspected", color: "var(--info)" },
  CLEAN: { label: "Clean", color: "var(--success)" },
  DIRTY: { label: "Dirty", color: "var(--destructive)" },
  OUT_OF_ORDER: { label: "Out of order", color: "var(--muted-foreground)" },
  OUT_OF_SERVICE: { label: "Out of service", color: "var(--muted-foreground)" },
}

/** Created vs cancelled: the brand hue for the thing we want, the neutral for its
 *  opposite. Deliberately not two competing hues — the pair reads as one story. */
const PACE_SERIES: SeriesDef[] = [
  { key: "created", label: "Created", color: hueFor(0) },
  { key: "cancelled", label: "Cancelled", color: hueFor(2) },
]

export function OperationsDashboard({
  enterprisePrefix,
  userName,
}: {
  enterprisePrefix: string
  /** Greeting only. Never an identity or permission input — those come from the session. */
  userName: string
}) {
  const { currentProperty, loading: propertyLoading } = useProperty()
  const { label: codeLabel } = useSystemCodeLabels()

  const [data, setData] = React.useState<DashboardOverview | null>(null)
  const [range, setRange] = React.useState<(typeof RANGES)[number]>(14)
  const [refreshing, setRefreshing] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  // The saved arrangement, and whether it has been read yet. Both matter: rendering
  // before the answer arrives would paint the default layout and then rearrange it under
  // the reader, so the skeleton stays up until the layout AND the data are in.
  const [saved, setSaved] = React.useState<DashboardLayout | null>(null)
  const [layoutLoaded, setLayoutLoaded] = React.useState(false)
  const [activePageId, setActivePageId] = React.useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [overId, setOverId] = React.useState<string | null>(null)

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

  // The saved arrangement for the property being viewed, re-read whenever that changes.
  // The abort matters twice over: on unmount, and on a property switch, so a slow response
  // for the property just left cannot land as the layout of the one now on screen.
  React.useEffect(() => {
    if (!propertyId) return
    setLayoutLoaded(false)
    const ac = new AbortController()
    void fetchLayout(propertyId, ac.signal).then((stored) => {
      if (ac.signal.aborted) return
      setSaved(stored)
      setLayoutLoaded(true)
    })
    return () => ac.abort()
  }, [propertyId])

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
  const dash = `${enterprisePrefix}/dashboard`
  const nationalityLabel = React.useCallback(
    (code: string) => codeLabel("NATIONALITY", code) ?? countryNameFor(code) ?? code,
    [codeLabel]
  )

  const nodes = React.useMemo(
    () => (data ? buildWidgetNodes({ data, dash, money, nationalityLabel }) : {}),
    [data, dash, money, nationalityLabel]
  )
  // What this session may see, in two layers that both have to say yes:
  //   1. the section gate — a widget whose data the payload never carried has no node;
  //   2. the per-role curation list an admin manages (payload `permittedWidgets`).
  // Everything downstream (the grid, the tab counts, the settings dialog) keys off this
  // one set, so a widget the user is not entitled to cannot be rendered, cannot be
  // un-hidden, and is not even listed as something to turn back on.
  const availableIds = React.useMemo(() => {
    const permitted = new Set(data?.permittedWidgets ?? [])
    return new Set(Object.keys(nodes).filter((id) => permitted.has(id)))
  }, [nodes, data?.permittedWidgets])

  const layout = React.useMemo(() => reconcile(saved, WIDGET_CATALOG), [saved])

  // A drag reads the layout from a handler, not from the closure it was created in — by
  // the second dragenter the closure is a render behind.
  const layoutRef = React.useRef(layout)
  React.useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  const lastOver = React.useRef<string | null>(null)
  // Mirrors draggingId for the handlers below, which must stay identity-stable across a
  // drag — rebuilding them mid-gesture detaches the listener the browser is firing into.
  const draggingIdRef = React.useRef<string | null>(null)

  // Saves are debounced: flipping five switches in the settings dialog is one intent, not
  // five round trips. A failure is reported once rather than per keystroke — silently
  // losing an arrangement the user just built is the thing to avoid.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedulePersist = React.useCallback(
    (next: DashboardLayout) => {
      if (!propertyId) return
      // The property is captured HERE, not read when the timer fires: switching property
      // mid-debounce would otherwise file this arrangement under the property the user
      // just moved to.
      const target = propertyId
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const ok = await persistLayout(target, next)
        if (!ok) toast.error("Couldn't save your dashboard layout", { description: "It still looks right here, but it may not be there next time you sign in." })
      }, 400)
    },
    [propertyId]
  )
  React.useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), [])

  const apply = React.useCallback(
    (next: DashboardLayout) => {
      setSaved(next)
      schedulePersist(next)
    },
    [schedulePersist]
  )

  const activePage = layout.pages.find((p) => p.id === activePageId) ?? layout.pages[0]

  const onDragEnter = React.useCallback((id: string) => {
    const dragged = draggingIdRef.current
    // Reordering on every dragenter would thrash: moving the card fires the event again
    // for the card that slid under the pointer. One move per newly-entered target.
    if (!dragged || id === dragged || lastOver.current === id) return
    lastOver.current = id
    setOverId(id)
    setSaved(moveWidget(layoutRef.current, dragged, id))
  }, [])

  const onDragStart = React.useCallback((id: string) => {
    draggingIdRef.current = id
    setDraggingId(id)
  }, [])
  const onDragEnd = React.useCallback(() => {
    draggingIdRef.current = null
    lastOver.current = null
    setDraggingId(null)
    setOverId(null)
    // The drag itself only previewed; this is the point the arrangement is worth keeping.
    schedulePersist(layoutRef.current)
  }, [schedulePersist])

  const onNudge = React.useCallback(
    (id: string, direction: -1 | 1) => apply(nudgeWidget(layoutRef.current, id, direction)),
    [apply]
  )

  const refresh = () => {
    setRefreshing(true)
    void load()
  }

  if (!propertyLoading && !propertyId) {
    return <ErrorState title="No property selected" description="Pick a property from the account menu to see its dashboard." />
  }
  if (failed && !data) return <ErrorState title="Couldn't load the dashboard" onRetry={refresh} />
  // Both halves must be in before the first paint: rendering on data alone would show
  // the default arrangement and then snap to the saved one under the reader.
  if (!data || !layoutLoaded) return <DashboardSkeleton />

  // Nothing at all authorized — a real state, not an error. Says so plainly rather than
  // rendering an empty page that looks broken.
  if (data.visibleSections.length === 0) {
    return (
      <div className="space-y-6">
        <DashboardHeading data={data} userName={userName} />
        <div className="rounded-2xl bg-card ring-1 ring-foreground/5">
          <EmptyState
            icon={Lock}
            title="No dashboard widgets available"
            description="Your role doesn't include view access to any of the areas this dashboard reports on. Ask an administrator if you think that's wrong."
          />
        </div>
      </div>
    )
  }

  const onThisPage = layout.widgets.filter((w) => !w.hidden && w.pageId === activePage.id && availableIds.has(w.id))
  const hiddenHere = layout.widgets.filter((w) => w.hidden && availableIds.has(w.id)).length

  return (
    <div className={cn("space-y-5 transition-opacity duration-200", refreshing && "opacity-70")}>
      <DashboardHeading
        data={data}
        userName={userName}
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
            <Button variant="outline" size="icon" aria-label="Customise dashboard" title="Customise dashboard" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Page tabs appear only once there is more than one page — a lone "Overview" tab
          is chrome that says nothing. */}
      {layout.pages.length > 1 && (
        <div role="tablist" aria-label="Dashboard pages" className="flex flex-wrap items-center gap-1 border-b border-border">
          {layout.pages.map((p) => {
            const count = layout.widgets.filter((w) => !w.hidden && w.pageId === p.id && availableIds.has(w.id)).length
            const on = p.id === activePage.id
            return (
              <button
                key={p.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => setActivePageId(p.id)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {p.name}
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {onThisPage.length === 0 ? (
        <div className="rounded-2xl bg-card ring-1 ring-foreground/5">
          <EmptyState
            icon={LayoutDashboard}
            title={layout.pages.length > 1 ? `Nothing on "${activePage.name}" yet` : "Every widget is hidden"}
            description={
              hiddenHere > 0
                ? `${hiddenHere} widget${hiddenHere === 1 ? " is" : "s are"} switched off. Open Customise dashboard to bring them back.`
                : "Open Customise dashboard to add widgets to this page."
            }
            action={
              <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings className="h-4 w-4" /> Customise dashboard
              </Button>
            }
          />
        </div>
      ) : (
        /* One dense 12-column grid for everything. `dense` is what makes a hidden or
           resized widget close its own gap instead of leaving a hole — the auto-fit the
           two fixed-width grids this replaced could never do. */
        <div
          className="grid grid-flow-row-dense auto-rows-min grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12"
          onDragEnd={onDragEnd}
        >
          {onThisPage.map((w) => {
            const def = CATALOG_BY_ID.get(w.id)
            if (!def) return null
            return (
              <WidgetShell
                key={w.id}
                id={w.id}
                title={def.title}
                className={cn(SIZE_CLASS[w.size], def.align === "start" && "self-start")}
                dragging={draggingId === w.id}
                isDragTarget={overId === w.id && draggingId !== null && draggingId !== w.id}
                onDragStart={onDragStart}
                onDragEnter={onDragEnter}
                onDragEnd={onDragEnd}
                onNudge={onNudge}
              >
                {nodes[w.id]}
              </WidgetShell>
            )
          })}
        </div>
      )}

      <DashboardSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        layout={layout}
        onChange={apply}
        onReset={() => {
          // Drop the row rather than saving the default over it: "reset" should leave the
          // user tracking whatever ships next, not pin today's default into their account.
          setSaved(defaultLayout(WIDGET_CATALOG))
          setActivePageId(null)
          if (propertyId) {
            void resetStoredLayout(propertyId).then((ok) => {
              if (!ok) toast.error("Couldn't reset your dashboard layout")
            })
          }
        }}
        catalog={WIDGET_CATALOG}
        availableIds={availableIds}
        activePageId={activePage.id}
        onActivePageChange={setActivePageId}
      />
    </div>
  )
}

// ── Widget bodies ─────────────────────────────────────────────────────────────────
//
// One key per catalogue id. A key is present only when its section is in the payload,
// which is what makes `availableIds` a permission answer rather than a preference.

function buildWidgetNodes({
  data,
  dash,
  money,
  nationalityLabel,
}: {
  data: DashboardOverview
  dash: string
  money: ReturnType<typeof makeMoneyFormatter>
  nationalityLabel: (code: string) => string
}): Record<string, React.ReactNode> {
  const n: Record<string, React.ReactNode> = {}
  const t = data.trend

  const ribbon = <OpsRibbon data={data} dash={dash} />
  if (ribbon) n.ribbon = ribbon

  // ── Key figures ──────────────────────────────────────────────────────────────
  if (data.occupancy) {
    n["kpi-occupancy"] = (
      <StatTile
        label="Occupancy"
        value={pct(data.occupancy.occupancyPct)}
        footnote={`${data.occupancy.roomsSold} of ${data.occupancy.totalRooms} rooms sold`}
        icon={Percent}
        href={`${dash}/front-office`}
        delta={
          data.occupancy.occupancyPctLastWeek !== null
            ? { value: data.occupancy.occupancyPct - data.occupancy.occupancyPctLastWeek, suffix: "pts", period: "vs last week" }
            : null
        }
        trend={t?.hasOccupancy ? t.points.filter((p) => !p.future).map((p) => p.occupancy ?? 0) : undefined}
      />
    )
    n["kpi-in-house"] = (
      <StatTile
        label="In-house guests"
        value={String(data.occupancy.adults + data.occupancy.children)}
        footnote={`${data.occupancy.adults} adults · ${data.occupancy.children} children${data.occupancy.infants ? ` · ${data.occupancy.infants} infants` : ""}`}
        icon={UsersRound}
        href={`${dash}/front-office`}
      />
    )
  }

  if (data.revenue) {
    n["kpi-adr"] = (
      <StatTile
        label="ADR"
        value={money.short(data.revenue.adr)}
        footnote={`MTD ${money.short(data.revenue.monthToDate.adr)}`}
        icon={TrendingUp}
        href={`${dash}/revenue`}
        delta={data.revenue.adrLastWeek !== null ? { value: data.revenue.adr - data.revenue.adrLastWeek, period: "vs last week" } : null}
        trend={t?.hasRevenue ? t.points.filter((p) => !p.future).map((p) => p.adr ?? 0) : undefined}
      />
    )
    n["kpi-revpar"] = (
      <StatTile
        label="RevPAR"
        value={money.short(data.revenue.revpar)}
        footnote="Revenue per available room"
        icon={BedDouble}
        href={`${dash}/revenue`}
        trend={t?.hasRevenue ? t.points.filter((p) => !p.future).map((p) => p.revpar ?? 0) : undefined}
      />
    )
    n["kpi-revenue-today"] = (
      <StatTile
        label="Revenue today"
        value={money.short(data.revenue.today.total)}
        footnote={`Room ${money.short(data.revenue.today.room)} · Other ${money.short(data.revenue.today.nonRoom)}`}
        icon={DollarSign}
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
    )
  }

  if (data.cashiering) {
    n["kpi-payments"] = (
      <StatTile
        label="Payments today"
        value={money.short(data.cashiering.netToday)}
        footnote={`${data.cashiering.openShifts} open shift${data.cashiering.openShifts === 1 ? "" : "s"} · ${data.cashiering.openFolios} open folios`}
        icon={Wallet}
        href={`${dash}/cashiering`}
      />
    )
  }

  if (data.debtors) {
    n["kpi-receivables"] = (
      <StatTile
        label="Accounts receivable"
        value={money.short(data.debtors.totalOutstanding)}
        footnote={`${data.debtors.invoiceCount} open invoice${data.debtors.invoiceCount === 1 ? "" : "s"}`}
        icon={Landmark}
        href={`${dash}/debtors`}
      />
    )
  }

  if (data.reservations) {
    n["kpi-on-the-books"] = (
      <StatTile
        label="On the books"
        value={String(data.reservations.onTheBooksNext7)}
        footnote={`Room nights, next 7 days · ${data.reservations.createdLast7} booked this week`}
        icon={CalendarDays}
        href={`${dash}/reservations`}
      />
    )
  }

  // ── Panels ───────────────────────────────────────────────────────────────────

  // Trend — deliberately two stacked plots on ONE shared x-axis, never a second y-scale
  // on the same plot. Two scales on one frame invent a correlation.
  if (t && (t.hasOccupancy || t.hasRevenue)) {
    n.trend = (
      <Panel
        title="Occupancy & rate trend"
        description={`${data.trendDays} days back, 7 days on the books`}
        icon={TrendingUp}
        action={<PanelLink href={`${dash}/reservations/tape-chart`}>Tape chart</PanelLink>}
      >
        {t.hasOccupancy && (
          <>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Occupancy</span>
              {/* One series, two states — so the key distinguishes by the same channel
                  the chart uses (fill strength), not by a second hue. */}
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
              format={(v) => `${Math.round(v)}%`}
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
              format={(v) => money.short(v)}
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
    )
  }

  // Revenue mix — part-to-whole at a glance, ≤ 4 segments.
  if (data.revenue) {
    n["revenue-mix"] = (
      <Panel title="Revenue mix" description="Posted today, by reporting bucket" icon={DollarSign} action={<PanelLink href={`${dash}/reports`}>Reports</PanelLink>}>
        {data.revenue.today.byBucket.length === 0 ? (
          <TileEmpty>Nothing posted yet today.</TileEmpty>
        ) : (
          <>
            <div className="flex justify-center">
              <DonutChart
                ariaLabel="Revenue by bucket today"
                slices={data.revenue.today.byBucket.map((b) => ({ label: b.label, value: b.amount, color: hueFor(BUCKET_SLOT[b.bucket] ?? 3) }))}
                centerValue={money.short(data.revenue.today.total)}
                centerLabel="posted today"
                format={money.exact}
              />
            </div>
            <ul className="mt-3 space-y-1.5">
              {data.revenue.today.byBucket.map((b) => (
                <li key={b.bucket} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: hueFor(BUCKET_SLOT[b.bucket] ?? 3) }} />
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
    )
  }

  if (data.occupancy) {
    n.movements = (
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
            <Figure
              value={data.occupancy.outOfOrder + data.occupancy.outOfService}
              label="Out of service"
              tone={data.occupancy.outOfOrder + data.occupancy.outOfService > 0 ? "danger" : undefined}
            />
          </div>
        </div>
      </Panel>
    )
  }

  if (data.housekeeping) {
    const hk = data.housekeeping
    n.housekeeping = (
      <Panel title="Rooms & housekeeping" description="Status of every room right now" icon={ClipboardList} action={<PanelLink href={`${dash}/housekeeping`}>Housekeeping</PanelLink>}>
        {hk.statusMix.length === 0 ? (
          <TileEmpty>No rooms configured yet.</TileEmpty>
        ) : (
          <>
            <div className="flex justify-center">
              <DonutChart
                ariaLabel="Room status mix"
                size={148}
                slices={hk.statusMix.map((s) => ({
                  label: ROOM_STATUS_TONE[s.status]?.label ?? s.status,
                  value: s.count,
                  color: ROOM_STATUS_TONE[s.status]?.color ?? "var(--muted-foreground)",
                }))}
                centerValue={String(hk.statusMix.reduce((a, b) => a + b.count, 0))}
                centerLabel="rooms"
              />
            </div>
            <ul className="mt-3 space-y-1">
              {hk.statusMix.map((s) => (
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
              <DataRow label="Tasks today" value={`${hk.tasks.completed} / ${hk.tasks.total} done`} />
              <DataRow label="Dirty & unoccupied" value={hk.discrepancies} tone={hk.discrepancies > 0 ? "danger" : "success"} />
            </div>
          </>
        )}
      </Panel>
    )
  }

  if (data.reservations) {
    const r = data.reservations
    n["booking-pace"] = (
      <Panel
        title="Booking pace"
        description={`Reservations created and cancelled, last ${data.trendDays} days`}
        icon={CalendarDays}
        action={<PanelLink href={`${dash}/reservations`}>Reservations</PanelLink>}
      >
        <ChartLegend className="mb-2" series={PACE_SERIES} />
        <ColumnChart
          ariaLabel="Reservations created and cancelled per day"
          height={150}
          series={PACE_SERIES}
          points={r.pace.map((p) => ({ label: axisLabel(p.date), sub: fullDateLabel(p.date), values: [p.created, p.cancelled] }))}
        />
        <div className="mt-3 grid grid-cols-2 gap-x-6 border-t border-border/60 pt-2 sm:grid-cols-4">
          <DataRow label="Booked (7d)" value={r.createdLast7} />
          <DataRow label="Cancelled (7d)" value={r.cancelledLast7} tone={r.cancelledLast7 > 0 ? "danger" : undefined} />
          <DataRow label="No-shows (7d)" value={r.noShowLast7} tone={r.noShowLast7 > 0 ? "danger" : undefined} />
          <DataRow label="Avg lead time" value={r.avgLeadTimeDays !== null ? `${r.avgLeadTimeDays} d` : "—"} />
        </div>
        <ChartTableView
          caption="Reservations created and cancelled per day"
          columns={["Day", "Created", "Cancelled"]}
          rows={r.pace.map((p) => [fullDateLabel(p.date), p.created, p.cancelled])}
        />
      </Panel>
    )
  }

  if (data.cashiering) {
    const c = data.cashiering
    n.payments = (
      <Panel title="Payments by method" description="Taken on today's business date" icon={Wallet} action={<PanelLink href={`${dash}/cashiering`}>Cashiering</PanelLink>}>
        {c.byMethod.length === 0 ? (
          <TileEmpty>No payments taken yet today.</TileEmpty>
        ) : (
          <>
            <RankedBars rows={c.byMethod.map((m) => ({ label: m.name, value: m.amount, hint: money.short(m.amount) }))} color={hueFor(0)} />
            <div className="mt-3 border-t border-border/60 pt-2">
              <DataRow label="Receipts" value={money.exact(c.receiptsToday)} tone="success" />
              <DataRow label="Refunds" value={money.exact(c.refundsToday)} tone={c.refundsToday > 0 ? "danger" : undefined} />
              <DataRow label="Net" value={money.exact(c.netToday)} />
            </div>
            <ChartTableView caption="Payments by method" columns={["Method", "Count", "Amount"]} rows={c.byMethod.map((m) => [m.name, m.count, money.exact(m.amount)])} />
          </>
        )}
      </Panel>
    )
  }

  // AR aging — ordered age bands, so a single-hue light→dark ramp, not five hues.
  if (data.debtors) {
    const d = data.debtors
    n.receivables = (
      <Panel title="Receivables aging" description="Open city-ledger invoices by age" icon={Landmark} action={<PanelLink href={`${dash}/debtors`}>Debtors</PanelLink>}>
        {d.invoiceCount === 0 ? (
          <TileEmpty>No open debtor invoices.</TileEmpty>
        ) : (
          <>
            <RankedBars
              ordinal
              color={hueFor(0)}
              rows={[
                { label: "Current", value: d.buckets.current, hint: money.short(d.buckets.current) },
                { label: "1–30 days", value: d.buckets["1-30"], hint: money.short(d.buckets["1-30"]) },
                { label: "31–60 days", value: d.buckets["31-60"], hint: money.short(d.buckets["31-60"]) },
                { label: "61–90 days", value: d.buckets["61-90"], hint: money.short(d.buckets["61-90"]) },
                { label: "Over 90 days", value: d.buckets["90+"], hint: money.short(d.buckets["90+"]) },
              ]}
            />
            {d.top.length > 0 && (
              <div className="mt-3 border-t border-border/60 pt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Largest balances</p>
                {d.top.map((a) => (
                  <DataRow key={a.name} label={a.name} value={money.exact(a.amount)} />
                ))}
              </div>
            )}
          </>
        )}
      </Panel>
    )
  }

  if (data.maintenance) {
    const m = data.maintenance
    n.maintenance = (
      <Panel title="Maintenance" description="Open and in-progress work orders" icon={Wrench} action={<PanelLink href={`${dash}/maintenance`}>Work orders</PanelLink>}>
        {m.open + m.inProgress === 0 ? (
          <TileEmpty>No open work orders. Everything is in service.</TileEmpty>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <Figure value={m.open} label="Open" tone={m.open > 0 ? "danger" : undefined} />
              <Figure value={m.inProgress} label="In progress" />
              <Figure value={m.roomsOutOfService} label="Rooms down" tone={m.roomsOutOfService > 0 ? "warning" : undefined} />
            </div>
            <StackedBar
              ariaLabel="Open work orders by priority"
              segments={m.byPriority.map((p) => ({
                label: p.priority,
                value: p.count,
                color: p.priority === "HIGH" ? "var(--destructive)" : p.priority === "MEDIUM" ? "var(--warning)" : "var(--muted-foreground)",
              }))}
            />
            <ul className="mt-3 space-y-1.5">
              {m.recent.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-2 border-b border-border/50 pb-1.5 text-xs last:border-0">
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">Room {row.roomNumber}</span>
                    <span className="ml-1.5 text-muted-foreground">{row.description}</span>
                  </span>
                  <StatusBadge label={row.priority} status={row.priority === "HIGH" ? "OPEN" : row.priority === "MEDIUM" ? "PENDING" : "INACTIVE"} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    )
  }

  if (data.worklists) {
    const w = data.worklists
    n.arrivals = (
      <Panel title="Arrivals to check in" description="Still expected today" icon={BedDouble} action={<PanelLink href={`${dash}/front-office`}>Check in</PanelLink>}>
        <WorklistRows rows={w.arrivals} money={money} empty="Every arrival is checked in." dash={dash} />
      </Panel>
    )
    n.departures = (
      <Panel title="Departures to settle" description="Due out today" icon={Wallet} action={<PanelLink href={`${dash}/front-office`}>Check out</PanelLink>}>
        <WorklistRows rows={w.departures} money={money} empty="Every departure is settled." dash={dash} showBalance />
      </Panel>
    )
    n.alerts = (
      <Panel title="Open alerts" description="Unresolved traces on live reservations" icon={AlertTriangle} action={<PanelLink href={`${dash}/front-office`}>Front desk</PanelLink>}>
        {w.alerts.length === 0 ? (
          <TileEmpty>No open alerts.</TileEmpty>
        ) : (
          <ul className="space-y-2">
            {w.alerts.map((a) => (
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
    )
  }

  if (data.profiles) {
    const p = data.profiles
    n["guest-mix"] = (
      <Panel title="Guest mix" description="Who is in the house" icon={Contact} action={<PanelLink href={`${dash}/profiles`}>Client relations</PanelLink>}>
        {p.inHouseNationalities.length === 0 ? (
          <TileEmpty>No in-house guests to profile.</TileEmpty>
        ) : (
          <RankedBars color={hueFor(0)} rows={p.inHouseNationalities.map((x) => ({ label: nationalityLabel(x.code), value: x.count }))} />
        )}
        <div className="mt-3 border-t border-border/60 pt-2">
          <DataRow label="VIPs in house" value={p.vipInHouse} />
          <DataRow label="Repeat guests" value={p.repeatGuestPct !== null ? pct(p.repeatGuestPct) : "—"} />
          <DataRow label="New profiles (7d)" value={p.newProfiles7d} />
        </div>
      </Panel>
    )
  }

  if (data.pos) {
    const p = data.pos
    n.outlets = (
      <Panel title="Outlet sales" description="Posted through Fast Post today" icon={Store} action={<PanelLink href={`${dash}/pos`}>Fast Post</PanelLink>}>
        {p.byOutlet.length === 0 ? (
          <TileEmpty>No outlet sales posted today.</TileEmpty>
        ) : (
          <>
            <RankedBars color={hueFor(0)} rows={p.byOutlet.map((o) => ({ label: o.name, value: o.amount, hint: money.short(o.amount) }))} />
            <div className="mt-3 border-t border-border/60 pt-2">
              <DataRow label="Checks opened" value={p.checksToday} />
              <DataRow label="Total sales" value={money.exact(p.salesToday)} />
            </div>
          </>
        )}
      </Panel>
    )
  }

  if (data.groups) {
    const g = data.groups
    n.groups = (
      <Panel title="Group blocks" description="In house or arriving within a week" icon={Layers} action={<PanelLink href={`${dash}/groups`}>Groups</PanelLink>}>
        {g.active.length === 0 ? (
          <TileEmpty>No active group blocks.</TileEmpty>
        ) : (
          <ul className="space-y-2.5">
            {g.active.map((b) => (
              <li key={b.id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`${dash}/groups/${b.id}`} className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline">
                    {b.name}
                  </Link>
                  <StatusBadge label={b.status} status={b.status} />
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {b.code} · {b.pickedUp} of {b.roomsHeld} rooms picked up
                </p>
                <Meter value={b.pickedUp} max={Math.max(b.roomsHeld, b.pickedUp)} tone={hueFor(0)} label={`${b.name} pickup`} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    )
  }

  if (data.spa) {
    const s = data.spa
    n.spa = (
      <Panel title="Spa today" description={`${s.count} appointment${s.count === 1 ? "" : "s"} booked`} icon={Sparkles} action={<PanelLink href={`${dash}/spa`}>Spa</PanelLink>}>
        {s.upcoming.length === 0 ? (
          <TileEmpty>No appointments today.</TileEmpty>
        ) : (
          <ul className="space-y-1.5">
            {s.upcoming.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 text-xs last:border-0">
                <span className="min-w-0 truncate">
                  <span className="font-medium tabular-nums text-foreground">{a.startTime}</span>
                  <span className="ml-2 text-muted-foreground">
                    {a.treatment} — {a.guest}
                  </span>
                </span>
                <StatusBadge label={a.status.replace(/_/g, " ")} status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    )
  }

  if (data.excursions) {
    const x = data.excursions
    n.excursions = (
      <Panel title="Excursions today" description={`${x.count} departure${x.count === 1 ? "" : "s"} scheduled`} icon={Compass} action={<PanelLink href={`${dash}/excursions`}>Excursions</PanelLink>}>
        {x.departures.length === 0 ? (
          <TileEmpty>No departures today.</TileEmpty>
        ) : (
          <ul className="space-y-2.5">
            {x.departures.map((d) => (
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
    )
  }

  if (data.activity) {
    const rows = data.activity
    n.activity = (
      <Panel title="Recent activity" description="Latest audited actions in this enterprise" icon={History} action={<PanelLink href={`${dash}/activity-log`}>Activity log</PanelLink>}>
        {rows.length === 0 ? (
          <TileEmpty>Nothing recorded yet.</TileEmpty>
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => (
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
    )
  }

  return n
}

// ── Sub-components ────────────────────────────────────────────────────────────────

function DashboardHeading({ data, userName, action }: { data: DashboardOverview; userName: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {/* The page title is a greeting rather than "Operations Dashboard" (app-owner
            call, 2026-09-06). Where you are is already answered by the nav; who you are
            signed in as is not, and on a shared front-desk terminal that is the more
            useful fact. The name is display text only — it is never read back as an
            identity, and every gate on this page runs off the session. */}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome, {userName}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {data.property.name} · business date {fullDateLabel(data.property.businessDate)}
        </p>
      </div>
      {action}
    </div>
  )
}

/** The thin status line above the widgets: is the day closed, is a drawer open, is the
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

function Chip({ icon: Icon, label, tone, href }: { icon: React.ComponentType<{ className?: string }>; label: string; tone: string; href?: string }) {
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
      <p className={cn("text-lg font-semibold leading-none", tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground")}>{value}</p>
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
              {r.roomNumber ? `Room ${r.roomNumber}` : (r.roomTypeName ?? "Unassigned")} · {r.nights} night{r.nights === 1 ? "" : "s"}
            </span>
          </span>
          {showBalance && (
            <span className={cn("shrink-0 tabular-nums", r.balance > 0.005 ? "font-medium text-destructive" : "text-success")}>{money.short(r.balance)}</span>
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
