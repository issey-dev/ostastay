"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

// Dependency-free SVG chart primitives for the Operations Dashboard.
//
// WHY HAND-ROLLED: the app ships no charting library, and the five brand chart hues
// already exist as design tokens (--chart-1..5, defined per theme in src/app/theme.css).
// Rendering straight to SVG keeps the charts on those tokens in both light and dark mode
// with no runtime theme plumbing, and adds nothing to the bundle.
//
// RULES BAKED IN HERE (so no call site has to remember them):
//   · No dual-axis charts, ever. Two measures on different scales are two stacked plots
//     sharing one x-axis (see TrendPanel) — a second y-scale invents correlations.
//   · Bars cap at 24px, 4px rounded data-end, square at the baseline; the leftover band
//     width stays as air. Lines are 2px with round caps; end markers are r=4 with a 2px
//     ring in the surface colour so they stay legible where they cross.
//   · Adjacent/stacked fills are separated by a 2px gap in the surface colour, never by
//     a stroke drawn around the mark.
//   · Grid and axis rules are solid hairlines one step off the surface — never dashed.
//   · A single-series chart gets no legend (the card title names it); two or more always
//     do, so identity never rests on colour alone.
//   · Every chart carries a <ChartTableView> twin, so no value is reachable only by
//     hovering, and hit targets are per-index bands rather than the mark itself.
//
// CATEGORICAL HUE ORDER — deliberately NOT 1,2,3,4,5. Run through the palette validator
// (OKLab ΔE, normal vision + protan/deutan/tritan), the token order puts Fern (--chart-3)
// next to Amber (--chart-4), a pair only ΔE 13 apart for a full-colour reader and ΔE 7
// under protanopia — i.e. genuinely hard to tell apart. Reordering to
// blue → amber → aubergine → fern → crimson separates that pair and takes every
// discriminability check to PASS in both light and dark mode, without touching the
// tokens themselves (they are brand values owned by DESIGN_PLAN §2.1).
export const CATEGORICAL_HUES = [
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-3)",
  "var(--chart-1)",
] as const

/** Colour for categorical slot `i`. Assigned by ENTITY, never by rank — filtering a
 *  series out must never repaint the survivors. Past the fifth slot callers fold the
 *  tail into an "Other" row rather than inventing a sixth hue. */
export const hueFor = (i: number) => CATEGORICAL_HUES[i % CATEGORICAL_HUES.length]

const GRID = "var(--border)"
const INK_MUTED = "var(--muted-foreground)"
const SURFACE = "var(--card)"

// ── Sizing ────────────────────────────────────────────────────────────────────────

/** Width of the element, tracked live. SVG text can't be scaled by viewBox without
 *  distorting, so charts are laid out in real pixels against the measured container. */
function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = React.useRef<T | null>(null)
  const [width, setWidth] = React.useState(fallback)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && Math.abs(w - width) > 1) setWidth(w)
    })
    observer.observe(el)
    setWidth(el.clientWidth || fallback)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [ref, width] as const
}

/**
 * Arrow-key traversal of a plot's points.
 *
 * The obvious alternative — one focusable hit-rect per point — puts up to 67 tab stops
 * inside a single card at the 60-day range, which is hostile to anyone actually driving
 * by keyboard. Instead the plot is ONE tab stop and the arrows walk it, which is the
 * pattern AT users expect from a chart. The `<ChartTableView>` twin remains the
 * no-interaction path to the same numbers.
 */
function useKeyboardCursor(count: number, setIndex: React.Dispatch<React.SetStateAction<number | null>>) {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (count === 0) return
      // Functional updates only, so the handler never closes over a stale index.
      const move = (delta: number) =>
        setIndex((prev) => {
          const from = prev ?? (delta > 0 ? -1 : count)
          return Math.min(count - 1, Math.max(0, from + delta))
        })
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault()
          move(1)
          break
        case "ArrowLeft":
          e.preventDefault()
          move(-1)
          break
        case "Home":
          e.preventDefault()
          setIndex(0)
          break
        case "End":
          e.preventDefault()
          setIndex(count - 1)
          break
        case "Escape":
          setIndex(null)
          break
      }
    },
    [count, setIndex]
  )
}

/** Axis ticks rounded to clean numbers, so the reader isn't decoding 3,847.62. */
function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const raw = max / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)))
  if (ticks.length < 2) ticks.push(step)
  return ticks
}

// ── Shared chrome ─────────────────────────────────────────────────────────────────

export type SeriesDef = { key: string; label: string; color: string; kind?: "bar" | "line" }

/** Identity channel that doesn't depend on colour discrimination. Rendered for two or
 *  more series only — one series is already named by the card title. */
export function ChartLegend({ series, className }: { series: SeriesDef[]; className?: string }) {
  if (series.length < 2) return null
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {s.kind === "line" ? (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          )}
          {s.label}
        </li>
      ))}
    </ul>
  )
}

/** The WCAG-clean twin every chart ships with: the same numbers as text, so a value is
 *  never reachable only by hovering a mark. Collapsed by default to stay out of the way. */
export function ChartTableView({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: string[]
  rows: (string | number)[][]
}) {
  if (rows.length === 0) return null
  return (
    <details className="group/table mt-3">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        View as table
      </summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-lg ring-1 ring-border">
        <table className="w-full text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-muted/70 backdrop-blur-sm">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={cn("px-2 py-1.5 font-medium text-muted-foreground", i === 0 ? "text-left" : "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-border/60">
                {r.map((cell, ci) => (
                  <td key={ci} className={cn("px-2 py-1", ci === 0 ? "text-left text-foreground" : "text-right tabular-nums text-muted-foreground")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** Floating value readout. Positioned in the chart's own coordinate space by the caller. */
function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: { label: string; value: string; color?: string }[] }) {
  // Flip to the left of the cursor when close to the right edge, so it never clips out.
  const flip = x > width - 150
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-32 rounded-lg bg-popover px-2.5 py-2 text-xs shadow-elevation-3 ring-1 ring-border"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 12) }}
    >
      <p className="mb-1 font-medium text-popover-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {r.color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-medium tabular-nums text-popover-foreground">{r.value}</span>
        </p>
      ))}
    </div>
  )
}

// ── Column chart (1–2 series, one shared scale) ───────────────────────────────────

export type ColumnPoint = { label: string; sub?: string; values: number[]; muted?: boolean }

export function ColumnChart({
  points,
  series,
  height = 150,
  format = (n: number) => n.toLocaleString(),
  ariaLabel,
  highlightLast,
  xLabels = true,
}: {
  points: ColumnPoint[]
  series: SeriesDef[]
  height?: number
  format?: (n: number) => string
  ariaLabel: string
  /** Direct-label the final column — selective labelling, not a number on every mark. */
  highlightLast?: boolean
  /** Off for the upper plot of a small-multiple pair, so one x-axis serves both. */
  xLabels?: boolean
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [hover, setHover] = React.useState<number | null>(null)
  const onKeyDown = useKeyboardCursor(points.length, setHover)

  const padL = 38
  const padR = 8
  const padT = highlightLast ? 18 : 8
  const axisH = xLabels ? 18 : 4
  const plotW = Math.max(10, width - padL - padR)
  const plotH = Math.max(10, height - padT - axisH)

  const max = Math.max(1, ...points.flatMap((p) => p.values))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number) => padT + plotH - (v / top) * plotH

  const band = plotW / Math.max(1, points.length)
  // Cap the mark and let the band's leftover be air; the 2px inter-mark gap is carved
  // out of the group width rather than drawn as a stroke.
  const GAP = 2
  const groupW = Math.min(24 * series.length + GAP * (series.length - 1), band * 0.66)
  const barW = Math.max(2, (groupW - GAP * (series.length - 1)) / series.length)

  const labelEvery = Math.max(1, Math.ceil(points.length / 7))

  return (
    <div
      ref={ref}
      className="relative w-full rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      tabIndex={0}
      role="application"
      aria-label={`${ariaLabel}. Use the arrow keys to read each point.`}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED} className="tabular-nums">
              {format(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const cx = padL + band * i + band / 2
          const active = hover === i
          return (
            <g key={`${p.label}-${i}`}>
              {series.map((s, si) => {
                const v = p.values[si] ?? 0
                const h = Math.max(v > 0 ? 2 : 0, (v / top) * plotH)
                const x = cx - groupW / 2 + si * (barW + GAP)
                const r = Math.min(4, barW / 2, h)
                return (
                  <path
                    key={s.key}
                    // 4px rounded data-end, square at the baseline.
                    d={`M${x} ${padT + plotH} v${-(h - r)} a${r} ${r} 0 0 1 ${r} ${-r} h${barW - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${h - r} z`}
                    fill={s.color}
                    opacity={p.muted ? 0.4 : active ? 1 : 0.9}
                  />
                )
              })}
              {highlightLast && i === points.length - 1 && (
                <text x={cx} y={y(Math.max(...p.values)) - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--foreground)" className="tabular-nums">
                  {format(Math.max(...p.values))}
                </text>
              )}
              {xLabels && i % labelEvery === 0 && (
                <text x={cx} y={height - 5} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                  {p.label}
                </text>
              )}
              {/* Full-band hit target: the whole column slot, not the thin mark, so a
                  2px bar is still comfortably hoverable. */}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={plotH}
                fill={active ? "var(--foreground)" : "transparent"}
                fillOpacity={active ? 0.04 : 0}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      </svg>

      {hover !== null && points[hover] && (
        <>
          <Tooltip
            x={padL + band * hover + band / 2}
            y={padT}
            width={width}
            title={points[hover].sub ?? points[hover].label}
            rows={series.map((s, si) => ({ label: s.label, value: format(points[hover]!.values[si] ?? 0), color: s.color }))}
          />
          {/* Announced to a screen reader as the arrow keys move the cursor. */}
          <span className="sr-only" aria-live="polite">
            {points[hover].sub ?? points[hover].label}: {series.map((s, si) => `${s.label} ${format(points[hover]!.values[si] ?? 0)}`).join(", ")}
          </span>
        </>
      )}
    </div>
  )
}

// ── Line chart (with an on-the-books tail) ────────────────────────────────────────

export type LinePoint = { label: string; sub?: string; value: number | null; forecast?: boolean }

export function LineChart({
  points,
  color = "var(--chart-2)",
  height = 120,
  format = (n: number) => n.toLocaleString(),
  ariaLabel,
  seriesLabel,
}: {
  points: LinePoint[]
  color?: string
  height?: number
  format?: (n: number) => string
  ariaLabel: string
  seriesLabel: string
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [hover, setHover] = React.useState<number | null>(null)
  const onKeyDown = useKeyboardCursor(points.length, setHover)

  const padL = 38
  const padR = 8
  const padT = 10
  const axisH = 18
  const plotW = Math.max(10, width - padL - padR)
  const plotH = Math.max(10, height - padT - axisH)

  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  const max = Math.max(1, ...values)
  const ticks = niceTicks(max, 3)
  const top = ticks[ticks.length - 1] || 1

  const step = plotW / Math.max(1, points.length - 1)
  const px = (i: number) => padL + step * i
  const py = (v: number) => padT + plotH - (v / top) * plotH

  const drawn = points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null)
  const path = drawn.map((p, n) => `${n === 0 ? "M" : "L"}${px(p.i)} ${py(p.value as number)}`).join(" ")
  const areaPath = drawn.length
    ? `${path} L${px(drawn[drawn.length - 1].i)} ${padT + plotH} L${px(drawn[0].i)} ${padT + plotH} Z`
    : ""
  const last = drawn[drawn.length - 1]
  const labelEvery = Math.max(1, Math.ceil(points.length / 7))

  return (
    <div
      ref={ref}
      className="relative w-full rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      tabIndex={0}
      role="application"
      aria-label={`${ariaLabel}. Use the arrow keys to read each point.`}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
    >
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + plotW} y1={py(t)} y2={py(t)} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={padL - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED} className="tabular-nums">
              {format(t)}
            </text>
          </g>
        ))}

        {/* Area wash at ~10% — a hint of mass under the line, never a saturated block. */}
        {areaPath && <path d={areaPath} fill={color} opacity={0.1} />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}

        {last && (
          <>
            <circle cx={px(last.i)} cy={py(last.value as number)} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />
            <text x={Math.min(px(last.i), padL + plotW - 2)} y={py(last.value as number) - 10} textAnchor="end" fontSize={10} fontWeight={600} fill="var(--foreground)" className="tabular-nums">
              {format(last.value as number)}
            </text>
          </>
        )}

        {hover !== null && points[hover]?.value !== null && (
          <line x1={px(hover)} x2={px(hover)} y1={padT} y2={padT + plotH} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
        )}

        {points.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            {i % labelEvery === 0 && (
              <text x={px(i)} y={height - 5} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                {p.label}
              </text>
            )}
            {/* Hit band, wider than the 8px marker it targets. */}
            <rect
              x={px(i) - step / 2}
              y={padT}
              width={step}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke={GRID} strokeWidth={1} shapeRendering="crispEdges" />
      </svg>

      {hover !== null && points[hover] && points[hover].value !== null && (
        <>
          <Tooltip
            x={px(hover)}
            y={padT}
            width={width}
            title={points[hover].sub ?? points[hover].label}
            rows={[{ label: seriesLabel, value: format(points[hover].value as number), color }]}
          />
          <span className="sr-only" aria-live="polite">
            {points[hover].sub ?? points[hover].label}: {seriesLabel} {format(points[hover].value as number)}
          </span>
        </>
      )}
    </div>
  )
}

// ── Donut ─────────────────────────────────────────────────────────────────────────

export type DonutSlice = { label: string; value: number; color: string }

export function DonutChart({
  slices,
  size = 168,
  centerValue,
  centerLabel,
  format = (n: number) => n.toLocaleString(),
  ariaLabel,
}: {
  slices: DonutSlice[]
  size?: number
  centerValue: string
  centerLabel: string
  format?: (n: number) => string
  ariaLabel: string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  const r = size / 2 - 8
  const stroke = 18
  const c = 2 * Math.PI * r
  // A 2px gap in the surface colour separates touching segments — expressed as a dash
  // gap here rather than a stroke drawn around each arc.
  const GAP_PX = 2

  let offset = 0

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        {total > 0 &&
          slices.map((s, i) => {
            const frac = Math.max(0, s.value) / total
            const len = Math.max(0, frac * c - GAP_PX)
            const dash = `${len} ${c - len}`
            const el = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? stroke + 3 : stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                className="transition-[stroke-width] duration-150"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            )
            offset += frac * c
            return el
          })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-semibold leading-none text-foreground">{centerValue}</span>
        <span className="mt-1 max-w-[70%] text-[11px] leading-tight text-muted-foreground">{centerLabel}</span>
      </div>
      {hover !== null && slices[hover] && (
        <div className="pointer-events-none absolute -bottom-1 left-1/2 z-10 -translate-x-1/2 translate-y-full rounded-lg bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-elevation-3 ring-1 ring-border">
          <span className="font-medium text-popover-foreground">{slices[hover].label}</span>
          <span className="ml-2 tabular-nums text-muted-foreground">{format(slices[hover].value)}</span>
        </div>
      )}
    </div>
  )
}

// ── Ranked horizontal bars (one series, one hue) ──────────────────────────────────

export function RankedBars({
  rows,
  format = (n: number) => n.toLocaleString(),
  color = "var(--chart-2)",
  /** Ordered categories (age bands, tiers) get a single-hue light→dark ramp instead of
   *  one flat colour. Never use this for nominal categories — that double-encodes length. */
  ordinal = false,
}: {
  rows: { label: string; value: number; hint?: string }[]
  format?: (n: number) => string
  color?: string
  ordinal?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="relative h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%`,
                background: color,
                opacity: ordinal ? 0.35 + (0.65 * (rows.length - i)) / rows.length : 1,
              }}
            />
          </span>
          <span className="text-xs font-medium tabular-nums text-foreground">{r.hint ?? format(r.value)}</span>
        </li>
      ))}
    </ul>
  )
}

// ── Single stacked bar (part-to-whole in one line) ────────────────────────────────

export function StackedBar({
  segments,
  ariaLabel,
}: {
  segments: { label: string; value: number; color: string }[]
  ariaLabel: string
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (total <= 0) return <div className="h-3 rounded-full bg-muted" role="img" aria-label={`${ariaLabel}: none`} />
  return (
    <div className="flex h-3 gap-0.5" role="img" aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <span
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
    </div>
  )
}

// ── Sparkline (stat-tile companion) ───────────────────────────────────────────────

export function Sparkline({ values, color = "var(--chart-2)", width = 96, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return null
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const span = max - min || 1
  const step = width / (clean.length - 1)
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6)
  const d = clean.map((v, i) => `${i === 0 ? "M" : "L"}${i * step} ${y(v)}`).join(" ")
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={y(clean[clean.length - 1])} r={3} fill={color} stroke={SURFACE} strokeWidth={2} />
    </svg>
  )
}

// ── Meter (progress against a target) ─────────────────────────────────────────────

export function Meter({ value, max, tone = "var(--chart-2)", label }: { value: number; max: number; tone?: string; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={Math.max(max, value)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: tone }} />
    </div>
  )
}
