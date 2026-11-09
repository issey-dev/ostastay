"use client"

import * as React from "react"
import { useReveal } from "@/components/dashboard/motion-kit"

// The Monitoring page's load chart: one column per time bucket, stacked by series (the
// top enterprises, or an enterprise's properties). Follows the chart kit's rules
// (src/components/dashboard/charts.tsx): stacked parts separated by a 2px gap in the
// surface colour, grid and ink from theme tokens, and the arrow keys read each column.

export type StackSeries = { key: string; label: string; color: string; values: number[] }

const GRID = "var(--border)"
const INK_MUTED = "var(--muted-foreground)"
const SURFACE = "var(--card)"

function niceMax(n: number) {
  if (n <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(n)))
  const m = n / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)))

export function StackedColumns({
  series,
  buckets,
  formatBucket,
  height = 240,
  ariaLabel,
}: {
  series: StackSeries[]
  /** Bucket start times (ms). */
  buckets: number[]
  formatBucket: (ms: number) => string
  height?: number
  ariaLabel: string
}) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(800)
  const { show, ok } = useReveal(ref)
  const [hover, setHover] = React.useState<number | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((e) => setWidth(e[0]?.contentRect.width || 800))
    ro.observe(el)
    setWidth(el.clientWidth || 800)
    return () => ro.disconnect()
  }, [])

  const padL = 40
  const padR = 8
  const padT = 8
  const axisH = 20
  const plotW = Math.max(10, width - padL - padR)
  const plotH = height - padT - axisH
  const totals = buckets.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0))
  const top = niceMax(Math.max(1, ...totals))
  const ticks = [0, top / 2, top]
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const band = plotW / Math.max(1, buckets.length)
  const barW = Math.max(1, band - Math.min(4, band * 0.3))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6))
  const grown = show || !ok

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(buckets.length - 1, (h ?? -1) + 1))
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? buckets.length) - 1))
    else return
    e.preventDefault()
  }

  const tip = hover !== null ? { i: hover, x: padL + band * hover + band / 2 } : null

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      role="application"
      aria-label={`${ariaLabel}. Use the left and right arrow keys to read each period.`}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
      onMouseLeave={() => setHover(null)}
    >
      {/* width 100% + viewBox: the svg never pushes its container wider than the screen (a
          fixed 800px first render widened the phone layout before the observer measured). */}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke={GRID} shapeRendering="crispEdges" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED} className="tabular-nums">
              {compact(t)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          let acc = 0
          const x = padL + band * i + (band - barW) / 2
          return (
            <g key={b} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.55}>
              {/* Full-height hit area, so thin columns are easy to hover. */}
              <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent" />
              {series.map((s) => {
                const v = s.values[i] ?? 0
                if (v <= 0) return null
                const y0 = y(acc)
                acc += v
                const y1 = y(acc)
                const h = Math.max(0, y0 - y1)
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y1}
                    width={barW}
                    height={grown ? Math.max(0, h - 1) : 0}
                    fill={s.color}
                    stroke={SURFACE}
                    strokeWidth={barW > 4 ? 1 : 0}
                    style={{ transition: ok ? "height 600ms cubic-bezier(0.22,1,0.36,1)" : undefined }}
                  />
                )
              })}
              {i % labelEvery === 0 && (
                <text x={padL + band * i + band / 2} y={height - 5} textAnchor="middle" fontSize={10} fill={INK_MUTED}>
                  {formatBucket(b)}
                </text>
              )}
            </g>
          )
        })}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} stroke={GRID} shapeRendering="crispEdges" />
      </svg>

      {tip && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-44 border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: Math.min(Math.max(tip.x - 90, 0), Math.max(0, width - 190)) }}
          role="status"
        >
          <p className="mb-1 font-medium">{formatBucket(buckets[tip.i])}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-2">
              <span className="size-2 shrink-0" style={{ background: s.color }} aria-hidden="true" />
              <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
              <span className="tabular-nums">{(s.values[tip.i] ?? 0).toLocaleString()}</span>
            </p>
          ))}
          <p className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{totals[tip.i].toLocaleString()}</span>
          </p>
        </div>
      )}
    </div>
  )
}
