"use client"

import * as React from "react"
import Link from "next/link"
import type { ComponentType } from "react"
import { cn } from "@/lib/utils"
import { ArrowRight, ChevronUp, ChevronDown } from "@/components/icons"
import { Sparkline } from "@/components/dashboard/charts"

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
  href?: string
  accent?: string
}

export function StatTile({ label, value, footnote, icon: Icon, delta, trend, trendColor, href, accent = "var(--chart-2)" }: StatTileProps) {
  const showDelta = delta && Number.isFinite(delta.value) && Math.abs(delta.value) > 0.049
  const higherIsBetter = delta?.higherIsBetter ?? true
  const good = showDelta ? (delta!.value > 0) === higherIsBetter : false
  const Wrapper: React.ElementType = href ? Link : "div"

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        "group relative flex flex-col justify-between gap-3 overflow-hidden rounded-2xl bg-card p-4 shadow-elevation-1 ring-1 ring-foreground/5 transition-all duration-200",
        href && "hover:-translate-y-0.5 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {/* A 2px hairline in the tile's own accent — enough to group tiles by domain at a
          glance without colouring any text. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent }} />

      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />}
      </div>

      <div>
        {/* Proportional figures deliberately — tabular-nums makes a display-size number
            look loose. Columns of numbers elsewhere still use tabular. */}
        <p className="text-2xl leading-none font-semibold text-foreground">{value}</p>
        <div className="mt-2 flex min-h-4 items-end justify-between gap-2">
          <div className="min-w-0">
            {footnote && <p className="truncate text-xs text-muted-foreground">{footnote}</p>}
            {showDelta && (
              <p className={cn("mt-0.5 flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-destructive")}>
                {delta!.value > 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {Math.abs(delta!.value).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                {delta!.suffix ?? ""}
                <span className="font-normal text-muted-foreground">{delta!.period}</span>
              </p>
            )}
          </div>
          {trend && trend.length > 1 && <Sparkline values={trend} color={trendColor ?? accent} width={72} height={24} />}
        </div>
      </div>
    </Wrapper>
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
