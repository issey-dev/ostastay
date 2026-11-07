"use client"

import * as React from "react"
import Link from "next/link"
import type { ComponentType } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { ArrowRight, ChevronUp, ChevronDown } from "@/components/icons"
import { Sparkline } from "@/components/dashboard/charts"
import { CountUp, DUR, EASE_OUT, SPRING_POP, useReveal } from "@/components/dashboard/motion-kit"

// The shells every dashboard tile is built from. Nothing here decides *whether* a tile
// appears — that is the caller's job, driven purely by whether the API sent the section
// (see src/lib/dashboard/overview.ts). These only decide how it looks once it does.

// ── Formatting ────────────────────────────────────────────────────────────────────

/** Money in the property's own currency. Compacted past six figures so a tile value
 *  never wraps; the exact number stays available in the tooltip/table twin. */
export function makeMoneyFormatter(currency: string) {
  const full = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 })
  const compact = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 })
  const exact = new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return {
    /** Tile-sized: no decimals, compacted above 100k. */
    short: (n: number) => (Math.abs(n) >= 100_000 ? compact.format(n) : full.format(n)),
    /** Statement-sized: always two decimals. */
    exact: (n: number) => exact.format(n),
  }
}

export const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`

/** Short weekday+day for a chart axis; the full date rides the tooltip. */
export function axisLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
}
export function fullDateLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
}

// ── Stat tile ─────────────────────────────────────────────────────────────────────

export type StatTileProps = {
  label: string
  value: string
  /** One short line under the value — the denominator, the split, the "of what". */
  footnote?: React.ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Signed change against a named period, e.g. { value: -4.2, suffix: "pts", period: "vs last week" }. */
  delta?: { value: number; suffix?: string; period: string; higherIsBetter?: boolean } | null
  trend?: number[]
  trendColor?: string
  /** 0–100. Draws a progress ring beside the figure (a "share of capacity" figure). */
  ring?: number
  href?: string
  accent?: string
}

// The "instrument" tile: a glow in the corner, the figure large and counting up, the
// chart sized to the data (a ring for a share, a full-width line for a trend) and the
// change as a pill. All entrance motion comes from motion-kit — the markup itself is the
// finished tile, so a reduced-motion user simply sees that.
export function StatTile({ label, value, footnote, icon: Icon, delta, trend, trendColor, ring, href, accent = "var(--series-1)" }: StatTileProps) {
  const showDelta = delta && Number.isFinite(delta.value) && Math.abs(delta.value) > 0.049
  const higherIsBetter = delta?.higherIsBetter ?? true
  const good = showDelta ? (delta!.value > 0) === higherIsBetter : false
  const Wrapper: React.ElementType = href ? Link : "div"
  const { ref, ok, show, delay } = useReveal<HTMLDivElement>()

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        "group relative flex h-full flex-col justify-between gap-3 overflow-hidden rounded-2xl bg-card p-4 shadow-elevation-1 ring-1 ring-foreground/5 transition-[transform,box-shadow] duration-300 ease-out",
        href && "hover:-translate-y-0.5 hover:shadow-elevation-2 hover:ring-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {/* Observed element: a plain span inside the tile, because a Link can't take the ref
          typed as a div and the reveal only needs "the tile is on screen". */}
      <span ref={ref} aria-hidden className="pointer-events-none absolute inset-0" />

      {/* Soft corner glow, blooming once the tile lands. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rounded-full"
        style={{ background: `radial-gradient(circle, color-mix(in oklab, ${accent} 5%, transparent), transparent 68%)` }}
        initial={ok ? { opacity: 0, scale: 0.4 } : false}
        animate={show ? { opacity: 1, scale: 1 } : undefined}
        transition={{ duration: DUR.draw, ease: EASE_OUT, delay: delay + 0.15 }}
      />
      {/* One light pass across the face, once. */}
      {ok && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(100deg, transparent 35%, color-mix(in oklab, var(--primary) 7%, transparent) 50%, transparent 65%)" }}
          initial={{ x: "-120%" }}
          animate={show ? { x: "120%" } : undefined}
          transition={{ duration: 1.2, ease: EASE_OUT, delay: delay + 0.3 }}
        />
      )}

      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />}
            <span className="truncate">{label}</span>
          </p>
          {/* Proportional figures deliberately — tabular-nums makes a display-size number
              look loose (CountUp switches to tabular only while it is counting). */}
          <p className="mt-2.5 text-3xl leading-none font-semibold tracking-tight text-foreground max-sm:text-2xl max-sm:break-words">
            <CountUp value={value} />
          </p>
        </div>
        {ring !== undefined && <TileRing value={ring} color={accent} label={`${label}: ${Math.round(ring)} percent`} />}
      </div>

      {/* Phones show the tiles two-up (~170px): the line gives way to the figures. */}
      {trend && trend.length > 1 && ring === undefined && (
        <Sparkline values={trend} color={trendColor ?? accent} height={36} fluid className="relative max-sm:hidden" />
      )}

      <div className="relative flex flex-wrap items-center gap-x-2 gap-y-1">
        {showDelta && (
          <motion.span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              good ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            )}
            initial={ok ? { opacity: 0, scale: 0.6 } : false}
            animate={show ? { opacity: 1, scale: 1 } : undefined}
            transition={{ ...SPRING_POP, delay: delay + 0.6 }}
          >
            {delta!.value > 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {Math.abs(delta!.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}
            {delta!.suffix ?? ""}
          </motion.span>
        )}
        <p className="min-w-0 text-xs text-muted-foreground">
          {showDelta && <span className="mr-1">{delta!.period} ·</span>}
          {footnote}
        </p>
      </div>
    </Wrapper>
  )
}

function TileRing({ value, color, label }: { value: number; color: string; label: string }) {
  const { ref, ok, show, delay } = useReveal<SVGSVGElement>()
  const share = Math.max(0, Math.min(100, value))
  return (
    <svg ref={ref} width={56} height={56} viewBox="0 0 56 56" role="img" aria-label={label} className="shrink-0 -rotate-90 max-sm:h-11 max-sm:w-11">
      <circle cx={28} cy={28} r={22} fill="none" stroke="var(--muted)" strokeWidth={6} />
      <motion.circle
        cx={28}
        cy={28}
        r={22}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        initial={ok ? { pathLength: 0 } : false}
        animate={{ pathLength: show ? Math.max(0.001, share / 100) : 0 }}
        transition={{ duration: DUR.draw * 1.2, ease: EASE_OUT, delay: delay + 0.3 }}
      />
    </svg>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl bg-card shadow-elevation-1 ring-1 ring-foreground/5",
        className
      )}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{title}</span>
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className={cn("flex-1 px-4 pb-4", contentClassName)}>{children}</div>
    </section>
  )
}

/** The "open the real screen" affordance every panel ends with — the dashboard reports,
 *  the module acts. */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}

/** A compact label/value row for the list-style panels. */
export function DataRow({ label, value, hint, tone }: { label: React.ReactNode; value: React.ReactNode; hint?: string; tone?: "default" | "danger" | "success" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="min-w-0 truncate text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium tabular-nums",
          tone === "danger" ? "text-destructive" : tone === "success" ? "text-success" : "text-foreground"
        )}
        title={hint}
      >
        {value}
      </span>
    </div>
  )
}

export function TileEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>
}
