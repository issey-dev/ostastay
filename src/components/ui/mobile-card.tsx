import * as React from "react"
import { cn } from "@/lib/utils"

// The phone version of a table row — one shared look for every list on a phone
// (.agents/docs/MOBILE_PLAN.md, R12). A screen keeps its desktop <Table> untouched and renders
// these below `md` instead:
//
//   <div className="hidden md:block"><Table>…</Table></div>
//   <MobileCardList>
//     {rows.map((r) => (
//       <MobileCard key={r.id} title={r.name} subtitle={r.code} badge={<StatusBadge …/>}
//         meta={[{ label: "Nights", value: r.nights }, { label: "Total", value: money(r.total) }]}
//         actions={<Button …>Edit</Button>} onClick={() => open(r)} />
//     ))}
//   </MobileCardList>
//
// Title + badge on top, an optional subtitle, 2–4 label/value facts in two columns, then
// actions. `onClick` makes the whole card the tap target (buttons inside still work).

/** The phone list: a column of cards, `md:hidden` by default; an empty state when empty. */
export function MobileCardList({
  children,
  empty,
  className,
}: {
  children: React.ReactNode
  /** Shown instead of the list when it has no cards. */
  empty?: React.ReactNode
  className?: string
}) {
  const hasItems = React.Children.toArray(children).some(Boolean)
  return (
    <div data-slot="mobile-card-list" className={cn("space-y-3 md:hidden", className)}>
      {hasItems ? children : empty}
    </div>
  )
}

export type MobileCardFact = { label: React.ReactNode; value: React.ReactNode; wide?: boolean }

export function MobileCard({
  title,
  subtitle,
  badge,
  meta,
  children,
  actions,
  onClick,
  tone,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Right of the title — status, type, flags. */
  badge?: React.ReactNode
  /** Label/value facts in two columns; `wide` spans both. */
  meta?: MobileCardFact[]
  /** Anything else, between the facts and the actions. */
  children?: React.ReactNode
  /** Buttons along the bottom (a primary action, or MobileActions). */
  actions?: React.ReactNode
  /** Whole-card tap → details. */
  onClick?: () => void
  /** Row tint — e.g. a cancelled or inactive row. */
  tone?: "muted" | "danger" | "warning"
  className?: string
}) {
  const interactive = !!onClick
  return (
    <div
      data-slot="mobile-card"
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-sm shadow-sm",
        interactive && "cursor-pointer transition-colors active:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "muted" && "opacity-70",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
        tone === "warning" && "border-warning/30 bg-warning-muted",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-snug text-foreground break-words">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted-foreground break-words">{subtitle}</div>}
        </div>
        {badge && <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{badge}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {meta.map((m, i) => (
            <div key={i} className={cn("min-w-0", m.wide && "col-span-2")}>
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="font-medium text-foreground break-words">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="mt-3">{children}</div>}
      {actions && (
        // Taps on actions must not also open the card.
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}
