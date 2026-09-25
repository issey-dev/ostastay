"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Minus, Plus } from "@/components/icons"

/**
 * − value + for small counts (adults, children, infants, party size) — on a phone this is two
 * taps where a number field is tap, clear, type, dismiss the keyboard. Same `value`/`onChange`
 * contract as a controlled number input; clamps to [min, max].
 *
 * Screens keep their desktop number input and render this below `md` in its place.
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  disabled,
  className,
  id,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  /** Accessible name for the group and its buttons (e.g. "Adults"). */
  label: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  const safe = Number.isFinite(value) ? value : min
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)))
  return (
    <div role="group" aria-label={label} id={id} className={cn("flex h-11 items-stretch overflow-hidden rounded-lg border border-input", className)}>
      <Button
        type="button"
        variant="ghost"
        className="h-full min-w-11 rounded-none px-0"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={disabled || safe <= min}
        onClick={() => set(safe - step)}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <output aria-live="polite" className="flex min-w-10 flex-1 items-center justify-center border-x border-input text-base font-semibold tabular-nums">
        {safe}
      </output>
      <Button
        type="button"
        variant="ghost"
        className="h-full min-w-11 rounded-none px-0"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={disabled || safe >= max}
        onClick={() => set(safe + step)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
