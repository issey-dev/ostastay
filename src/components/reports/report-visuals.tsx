"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StatTile } from "@/components/ui/stat-tile"
import { Panel } from "@/components/dashboard/tiles"
import { ChartLegend, ChartTableView, ColumnChart, DonutChart, LineChart, RankedBars, hueFor } from "@/components/dashboard/charts"
import { formatInsight } from "@/lib/reports/insights"
import type { ReportKpi, ReportVisual } from "@/lib/reports/types"

// A report's KPIs and charts on screen: the dashboard's own tiles and SVG chart primitives
// (so they follow the theme, dark mode and the chart rules in charts.tsx), fed by the same
// ReportVisual data the PDF and Excel summary are drawn from.

export function ReportKpiStrip({ items, currency }: { items: ReportKpi[]; currency: string }) {
  if (items.length === 0) return null
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "md:grid-cols-3" : items.length === 2 ? "md:grid-cols-2" : ""
      )}
    >
      {items.map((k) => (
        <StatTile
          key={k.key}
          label={k.label}
          value={formatInsight(k.value, k.format, k.format === "currency" ? currency : undefined)}
          footnote={k.footnote}
          accent={k.tone === "danger" ? "var(--destructive)" : k.tone === "success" ? "var(--success)" : "var(--series-1)"}
        />
      ))}
    </div>
  )
}

export function ReportVisualPanels({ visuals }: { visuals: ReportVisual[] }) {
  // Phones show the first chart; the rest sit behind a button so the figures and the list
  // stay within a short scroll.
  const [more, setMore] = useState(false)
  if (visuals.length === 0) return null
  return (
    <div className="space-y-3">
      <div className={cn("grid gap-3", visuals.length > 1 && "lg:grid-cols-2")}>
        {visuals.map((v, i) => (
          <Panel
            key={`${v.type}-${i}`}
            title={v.title}
            className={cn(
              visuals.length % 2 === 1 && i === visuals.length - 1 && visuals.length > 1 && "lg:col-span-2",
              i > 0 && !more && "max-md:hidden"
            )}
          >
            <VisualBody v={v} />
          </Panel>
        ))}
      </div>
      {visuals.length > 1 && (
        <Button variant="outline" className="w-full md:hidden" onClick={() => setMore((m) => !m)}>
          {more ? "Show fewer charts" : `Show ${visuals.length - 1} more chart${visuals.length > 2 ? "s" : ""}`}
        </Button>
      )}
    </div>
  )
}

function VisualBody({ v }: { v: ReportVisual }) {
  const fmt = (n: number) => formatInsight(n, v.format)

  if (v.type === "donut") {
    const total = v.slices.reduce((s, x) => s + x.value, 0)
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 py-1">
        <DonutChart
          slices={v.slices.map((s, i) => ({ ...s, color: hueFor(i) }))}
          centerValue={fmt(total)}
          centerLabel={v.centerLabel}
          format={fmt}
          ariaLabel={v.title}
        />
        <ul className="min-w-[10rem] flex-1 space-y-1.5">
          {v.slices.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: hueFor(i) }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.label}>{s.label}</span>
              <span className="font-medium tabular-nums text-foreground">{fmt(s.value)}</span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">{total > 0 ? `${Math.round((s.value / total) * 100)}%` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (v.type === "ranked") {
    return (
      <>
        <RankedBars rows={v.rows} format={fmt} color="var(--series-1)" />
        <ChartTableView caption={v.title} columns={["Item", "Value"]} rows={v.rows.map((r) => [r.label, fmt(r.value)])} />
      </>
    )
  }

  if (v.type === "column") {
    const series = v.series.map((s, i) => ({ key: s.key, label: s.label, color: hueFor(i === 0 ? 0 : 2) }))
    return (
      <>
        <ChartLegend series={series} className="mb-2" />
        <ColumnChart
          points={v.points.map((p) => ({ label: p.label, values: p.values }))}
          series={series}
          format={fmt}
          ariaLabel={v.title}
        />
        <ChartTableView
          caption={v.title}
          columns={["", ...v.series.map((s) => s.label)]}
          rows={v.points.map((p) => [p.label, ...p.values.map(fmt)])}
        />
      </>
    )
  }

  return (
    <>
      <LineChart
        points={v.points.map((p) => ({ label: p.label, value: p.value }))}
        color="var(--series-1)"
        format={fmt}
        ariaLabel={v.title}
        seriesLabel={v.seriesLabel}
      />
      <ChartTableView caption={v.title} columns={["", v.seriesLabel]} rows={v.points.map((p) => [p.label, fmt(p.value)])} />
    </>
  )
}
