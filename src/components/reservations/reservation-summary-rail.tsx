"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { ExternalLink, MessageSquare } from "@/components/icons"

export type RailAction = {
  label: string
  icon?: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  variant?: "default" | "outline"
  tone?: "warning"
}

type RailFolio = { id: string; number: number | string; isClosed?: boolean; charges: number; payments: number; balance: number }

const money = (n: number) => `$${n.toFixed(2)}`
const settled = (n: number) => Math.abs(n) < 0.005

/**
 * The reservation page's right-hand column on large screens (DESKTOP_PLAN §2.2, owner-approved
 * 2026-09-25): what the stay is, what is owed, and the ONE next step. Sticky, so the balance
 * never scrolls away. Rendered from `lg` only — below that the page keeps its single column and
 * phones keep their own summary strip.
 */
export function ReservationSummaryRail({
  stateLabel,
  state,
  checkIn,
  checkOut,
  nights,
  rooms,
  roomType,
  pax,
  folios,
  balance,
  depositsHeld,
  openTraces,
  next,
  onOpenFolio,
  folioPageHref,
  onOpenTraces,
}: {
  stateLabel: string
  state: string
  checkIn: string
  checkOut: string
  nights: number
  rooms: string[]
  roomType: string | null
  pax: string
  folios: RailFolio[]
  balance: number
  depositsHeld: number | null
  openTraces: number
  next: RailAction | null
  onOpenFolio: () => void
  folioPageHref: string | null
  onOpenTraces: () => void
}) {
  const hasFolios = folios.length > 0
  return (
    <aside className="hidden lg:sticky lg:top-20 lg:block" aria-label="Stay summary">
      <div className="border border-border bg-card shadow-elevation-1">
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge label={stateLabel} status={state} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {nights} night{nights === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-sm">
            <p className="font-semibold tabular-nums">
              {format(new Date(checkIn), "EEE dd MMM")} → {format(new Date(checkOut), "EEE dd MMM")}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {rooms.length > 0 ? `Room ${rooms.join(", ")}` : <span className="text-warning">Room unassigned</span>}
              {roomType && ` · ${roomType}`}
            </p>
            <p className="text-muted-foreground">{pax}</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-border p-4">
          <div>
            <p className="text-xs text-muted-foreground">Balance</p>
            {hasFolios ? (
              <p className={cn("text-2xl font-semibold tabular-nums", settled(balance) && "text-success")}>{money(balance)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No folio yet</p>
            )}
            {folios.length === 1 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {money(folios[0].charges)} charges · {money(folios[0].payments)} paid
              </p>
            )}
            {folios.length > 1 && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground tabular-nums">
                {folios.map((f) => (
                  <li key={f.id} className="flex justify-between gap-2">
                    <span>
                      Folio #{f.number}
                      {f.isClosed ? " · closed" : ""}
                    </span>
                    <span>{money(f.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
            {depositsHeld !== null && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">Deposits held {money(depositsHeld)}</p>
            )}
          </div>

          {next && (
            <Button
              className={cn(
                "w-full",
                next.tone === "warning" && "border-warning/40 text-warning hover:bg-warning-muted hover:text-warning"
              )}
              variant={next.tone === "warning" ? "outline" : (next.variant ?? "default")}
              onClick={next.onClick}
              disabled={next.disabled}
            >
              {next.icon && <next.icon className="mr-2 h-4 w-4" />}
              {next.label}
            </Button>
          )}
          {hasFolios && (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="flex-1" onClick={onOpenFolio}>
                Open folio
              </Button>
              {folioPageHref && (
                <Link href={folioPageHref} target="_blank" rel="noopener" title="Open the folio in a new tab" aria-label="Open the folio in a new tab">
                  <Button variant="outline" size="icon">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>

        {openTraces > 0 && (
          <button
            type="button"
            onClick={onOpenTraces}
            className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left text-sm text-destructive hover:bg-muted"
          >
            <MessageSquare className="h-4 w-4" />
            {openTraces} open trace{openTraces === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </aside>
  )
}
