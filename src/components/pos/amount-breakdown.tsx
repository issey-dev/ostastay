"use client"

import { useState } from "react"
import { Plus, Minus } from "@/components/icons"
import type { BreakdownLine } from "@/lib/pos/breakdown"

const money = (n: number) => `$${n.toFixed(2)}`

// A posting's GROSS amount (net + service charge + tax), with a "+" that opens the
// breakdown line by line. No "+" when there is nothing to break down (a charge with no tax).
export function AmountBreakdown({ total, lines, className = "" }: { total: number; lines?: BreakdownLine[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const hasBreakdown = (lines?.length ?? 0) > 1
  return (
    <div className={`text-right tabular-nums ${className}`}>
      <div className="flex items-center justify-end gap-1.5">
        {hasBreakdown && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Hide breakdown" : "Show breakdown"}
            className="inline-flex size-5 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-8"
          >
            {open ? <Minus className="size-3" /> : <Plus className="size-3" />}
          </button>
        )}
        <span className="font-mono text-sm font-semibold text-foreground">{money(total)}</span>
      </div>
      {open && hasBreakdown && (
        <dl className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {lines!.map((l, i) => (
            <div key={i} className="flex justify-between gap-4">
              <dt>{l.label}</dt>
              <dd className="font-mono">{money(l.amount)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
