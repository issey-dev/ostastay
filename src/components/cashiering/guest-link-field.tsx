"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"

type Option = { value: string; label: string; guestName: string; keywords?: string }

export type GuestLinkMode = "other" | "inhouse"

// "Who is this for?" on a cashiering form: either not linked to anyone (a walk-in — the
// caller can supply a name field for it) or an in-house guest chosen from a searchable list
// of rooms. Used by Currency exchange and Paid-outs. The list loads the first time
// "In-house guest" is chosen.
export function GuestLinkField({
  label,
  otherLabel,
  inHouseLabel = "In-house guest",
  mode,
  onModeChange,
  reservationId,
  onReservationChange,
  otherField,
}: {
  label: string
  otherLabel: string
  inHouseLabel?: string
  mode: GuestLinkMode
  onModeChange: (mode: GuestLinkMode) => void
  reservationId: string
  onReservationChange: (id: string) => void
  /** What to show under the toggle in the "other" mode (e.g. a walk-in name input). */
  otherField?: React.ReactNode
}) {
  const [options, setOptions] = useState<Option[] | null>(null)

  useEffect(() => {
    if (mode !== "inhouse" || options) return
    fetch("/api/cashiering/in-house")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setOptions(Array.isArray(d) ? d : []))
      .catch(() => setOptions([]))
  }, [mode, options])

  const choose = (m: GuestLinkMode) => {
    onModeChange(m)
    onReservationChange("")
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{mode === "inhouse" ? inHouseLabel : label}</Label>
        <div role="group" aria-label={label} className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["other", "inhouse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => choose(m)}
              className={`rounded-md px-2.5 py-1 font-medium pointer-coarse:min-h-9 ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "other" ? otherLabel : inHouseLabel}
            </button>
          ))}
        </div>
      </div>
      {mode === "inhouse" ? (
        <SearchableSelect
          searchable
          options={options ?? []}
          value={reservationId}
          onChange={onReservationChange}
          placeholder={options === null ? "Loading…" : "Search room or guest…"}
          searchPlaceholder="Room, guest or confirmation no…"
          emptyText="No in-house guests."
        />
      ) : (
        otherField
      )}
    </div>
  )
}
