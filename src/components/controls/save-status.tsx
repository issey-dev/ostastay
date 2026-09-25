"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { CheckCircle2 } from "@/components/icons"
import { SubmitButton } from "@/components/ui/submit-button"

// Hub save model (DECISIONS 2026-09-25 "Desktop polish"): a multi-field section has ONE Save in
// its footer, disabled until something changed, and says "Saved" afterwards; a single toggle or
// select saves on change and shows a brief inline "Saved" tick. These two pieces are that model.

export type SaveStatus = "idle" | "dirty" | "saved"

/** Section footer: status hint on the left, the one Save on the right (disabled until dirty). */
export function SectionSaveFooter({
  status,
  saving,
  disabled,
  label = "Save",
  className,
}: {
  status: SaveStatus
  saving: boolean
  /** Extra reasons to block saving (e.g. a field is invalid). */
  disabled?: boolean
  label?: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 border-t pt-4", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors",
          status === "saved" ? "text-success" : "text-muted-foreground"
        )}
        aria-live="polite"
      >
        {status === "saved" && <CheckCircle2 className="h-3.5 w-3.5" />}
        {status === "saved" ? "Saved" : status === "dirty" ? "Unsaved changes" : ""}
      </span>
      <SubmitButton pending={saving} disabled={disabled || status !== "dirty"}>
        {label}
      </SubmitButton>
    </div>
  )
}

/** The brief "Saved" tick next to an auto-saving toggle/select. */
export function SavedTick({ show, className }: { show: boolean; className?: string }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-success transition-opacity",
        show ? "opacity-100" : "opacity-0",
        className
      )}
    >
      {show && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved
        </>
      )}
    </span>
  )
}

/** `[shown, flash]` — call `flash()` after an auto-save succeeds; `shown` is true for ~2s. */
export function useSavedFlash(ms = 2000): [boolean, () => void] {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setShown(true)
    timer.current = setTimeout(() => setShown(false), ms)
  }, [ms])
  return [shown, flash]
}
