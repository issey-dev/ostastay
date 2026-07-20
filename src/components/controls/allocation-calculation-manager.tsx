"use client"

import { useState } from "react"
import { CalendarCheck, UtensilsCrossed } from "lucide-react"
import { useProperty } from "@/components/providers/property-provider"

// Per-property, top-level switch for which side drives automatic Allocation
// attachment on a reservation (see src/lib/allocations.ts resolveLinkedAllocationIds
// and .agents/docs/DECISIONS.md "Allocation Calculation mode"). Exclusive — never
// both. Changing this is NOT retroactive: it only affects reservations created or
// edited after the change, not ones already booked (a "refresh rate" tool to re-apply
// the current mode to an existing reservation is planned but not built yet).
export function AllocationCalculationManager() {
  const { currentProperty, refreshProperties } = useProperty()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const mode = currentProperty?.allocationCalculationMode === "MEAL_PLAN" ? "MEAL_PLAN" : "RATE_PLAN"

  const setMode = async (next: "RATE_PLAN" | "MEAL_PLAN") => {
    if (!currentProperty || next === mode) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/properties/${currentProperty.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocationCalculationMode: next }),
      })
      if (res.ok) {
        refreshProperties()
        setMessage({ text: "Allocation Calculation mode saved. Applies to reservations created or edited from now on — existing bookings are unaffected." })
      } else {
        const body = await res.json().catch(() => null)
        setMessage({ text: body?.error || "Failed to save.", error: true })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          type="button"
          disabled={saving || !currentProperty}
          onClick={() => setMode("MEAL_PLAN")}
          className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === "MEAL_PLAN" ? "border-primary bg-primary/5" : "border-border hover:border-foreground/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <UtensilsCrossed className="h-4 w-4" />
            <span className="font-semibold">Meal Plan level</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The reservation&apos;s selected Meal Plan drives which Allocations attach (see each Meal Plan&apos;s
            Included Allocations below). A Rate Plan&apos;s own Package Allocations are disabled and never post.
          </p>
        </button>
        <button
          type="button"
          disabled={saving || !currentProperty}
          onClick={() => setMode("RATE_PLAN")}
          className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            mode === "RATE_PLAN" ? "border-primary bg-primary/5" : "border-border hover:border-foreground/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <CalendarCheck className="h-4 w-4" />
            <span className="font-semibold">Rate Plan level</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The assigned Rate Plan&apos;s own Package Allocations (Revenue &gt; Rate Plans) drive what attaches.
            The reservation&apos;s Meal Plan field becomes a display label only — it never affects posting.
          </p>
        </button>
      </div>
      {message && (
        <p className={`text-sm ${message.error ? "text-destructive" : "text-success"}`}>{message.text}</p>
      )}
    </div>
  )
}
