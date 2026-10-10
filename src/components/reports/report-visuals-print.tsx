import type { ReportBranding, ReportKpi, ReportVisual } from "@/lib/reports/types"
import { formatInsight } from "@/lib/reports/insights"

// The report's KPIs and charts, drawn for PAPER: static SVG/HTML only (no hooks, no
// measuring), fixed print palette — so the print page can render it on the server and
// Chrome can print it. The on-screen version (report-visuals.tsx) is drawn from the same
// ReportVisual data with the app's live chart components.

// Categorical ramp on the print palette: accent first, then lightness steps of it.
const RAMP = ["var(--print-accent)", "var(--print-ink)", "var(--print-muted)", "var(--print-faint)"]

type Branding = Pick<ReportBranding, "currency">

export function PrintKpis({ items, branding }: { items: ReportKpi[]; branding: Branding }) {
  if (items.length === 0) return null
  return (
    <div className="report-kpis mb-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
      {items.map((k) => (
        <div key={k.key} className="rounded border border-[var(--print-border)] px-3 py-2" style={{ breakInside: "avoid" }}>
          <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[var(--print-muted)]">{k.label}</p>
          <p className="mt-0.5 text-[16px] font-bold leading-tight tabular-nums text-[var(--print-ink)]">
            {formatInsight(k.value, k.format, k.format === "currency" ? branding.currency : undefined)}
          </p>
          {k.footnote && <p className="text-[8px] text-[var(--print-muted)]">{k.footnote}</p>}
        </div>
      ))}
    </div>
  )
}

export function PrintVisuals({ visuals, branding }: { visuals: ReportVisual[]; branding: Branding }) {
  if (visuals.length === 0) return null
  return (
    <div className="report-visuals mb-4 grid grid-cols-2 gap-3">
      {visuals.map((v, i) => (
        <figure key={i} className="rounded border border-[var(--print-border)] p-3" style={{ breakInside: "avoid" }}>
          <figcaption className="mb-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--print-muted)]">{v.title}</figcaption>
          <Visual v={v} fmt={(n) => formatInsight(n, v.format)} currency={branding.currency} />
        </figure>
      ))}
    </div>
  )
}

function Visual({ v, fmt }: { v: ReportVisual; fmt: (n: number) => string; currency?: string }) {
  switch (v.type) {
    case "ranked": {
      const max = Math.max(1, ...v.rows.map((r) => Math.abs(r.value)))
      return (
        <ul className="space-y-1">
          {v.rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[28%_1fr_auto] items-center gap-2 text-[9px]">
              <span className="truncate">{r.label}</span>
              <span className="h-2 rounded-full bg-[var(--print-surface)]">
                <span className="block h-2 rounded-full bg-[var(--print-accent)]" style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} />
              </span>
              <span className="tabular-nums text-[var(--print-ink)]">{fmt(r.value)}</span>
            </li>
          ))}
        </ul>
      )
    }
    case "donut": {
      const total = v.slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1
      const R = 34
      const C = 2 * Math.PI * R
      const offsets = v.slices.map((_, i) => v.slices.slice(0, i).reduce((s, x) => s + (Math.max(0, x.value) / total) * C, 0))
      return (
        <div className="flex items-center gap-4">
          <svg width="92" height="92" viewBox="0 0 92 92" className="shrink-0 -rotate-90" role="img" aria-label={v.title}>
            <circle cx="46" cy="46" r={R} fill="none" stroke="var(--print-surface)" strokeWidth="14" />
            {v.slices.map((s, i) => {
              const frac = Math.max(0, s.value) / total
              const len = Math.max(0, frac * C - 1.5)
              return (
                <circle key={s.label} cx="46" cy="46" r={R} fill="none" stroke={RAMP[i % RAMP.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offsets[i]} />
              )
            })}
          </svg>
          <ul className="min-w-0 flex-1 space-y-0.5 text-[9px]">
            {v.slices.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: RAMP[i % RAMP.length] }} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="tabular-nums text-[var(--print-ink)]">{fmt(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )
    }
    case "column": {
      const W = 300
      const H = 90
      const max = Math.max(1, ...v.points.flatMap((p) => p.values))
      const band = W / Math.max(1, v.points.length)
      const n = v.series.length
      const bw = Math.max(2, Math.min(14, (band * 0.7) / n))
      const every = Math.max(1, Math.ceil(v.points.length / 8))
      return (
        <div>
          <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={v.title}>
            <line x1="0" x2={W} y1={H} y2={H} stroke="var(--print-border)" />
            {v.points.map((p, i) =>
              p.values.map((val, si) => {
                const h = (Math.max(0, val) / max) * (H - 6)
                const x = i * band + band / 2 - (bw * n) / 2 + si * bw
                return <rect key={`${i}-${si}`} x={x} y={H - h} width={Math.max(1, bw - 1)} height={h} fill={RAMP[si === 0 ? 0 : 2]} />
              })
            )}
            {v.points.map((p, i) =>
              i % every === 0 ? (
                <text key={i} x={i * band + band / 2} y={H + 10} textAnchor="middle" fontSize="6.5" fill="var(--print-muted)">
                  {p.label}
                </text>
              ) : null
            )}
          </svg>
          {n > 1 && (
            <p className="mt-1 flex gap-3 text-[8px] text-[var(--print-muted)]">
              {v.series.map((s, si) => (
                <span key={s.key} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: RAMP[si === 0 ? 0 : 2] }} />
                  {s.label}
                </span>
              ))}
            </p>
          )}
        </div>
      )
    }
    case "line": {
      const W = 300
      const H = 90
      const vals = v.points.map((p) => p.value)
      const max = Math.max(1, ...vals)
      const step = W / Math.max(1, v.points.length - 1)
      const pts = v.points.map((p, i) => `${i * step},${H - (p.value / max) * (H - 8) - 2}`).join(" ")
      const every = Math.max(1, Math.ceil(v.points.length / 8))
      return (
        <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label={v.title}>
          <line x1="0" x2={W} y1={H} y2={H} stroke="var(--print-border)" />
          <polyline points={pts} fill="none" stroke="var(--print-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          {v.points.map((p, i) =>
            i % every === 0 ? (
              <text key={i} x={i * step} y={H + 10} textAnchor={i === 0 ? "start" : "middle"} fontSize="6.5" fill="var(--print-muted)">
                {p.label}
              </text>
            ) : null
          )}
        </svg>
      )
    }
  }
}
