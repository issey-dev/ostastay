"use client"

import { useEffect, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { ROOM_FEATURE_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"

export type RoomFeature = { category: string; code: string }
export type FeatureOption = { category: string; code: string; value: string }

export const ROOM_FEATURE_CATEGORY_LABELS = Object.fromEntries(ROOM_FEATURE_LOV_CATEGORIES.map((c) => [c.code, c.label]))

// Shared fetch for the enterprise's own Bed Type / View / Amenity option lists — used by
// both the picker below and any read-only "inherited from Room Type" display.
export function useRoomFeatureOptions() {
  const [options, setOptions] = useState<FeatureOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all(
      ROOM_FEATURE_LOV_CATEGORIES.map((cat) =>
        fetch(`/api/settings/system-codes?category=${cat.code}`)
          .then((res) => res.json())
          .then((data) => (Array.isArray(data) ? data.map((d) => ({ category: cat.code, code: d.code, value: d.value })) : []))
      )
    )
      .then((results) => setOptions(results.flat()))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { options, loading }
}

// Groups a flat option/selection list by category, in ROOM_FEATURE_LOV_CATEGORIES order,
// dropping empty groups.
export function groupFeaturesByCategory<T extends { category: string }>(items: T[]): [string, T[]][] {
  return ROOM_FEATURE_LOV_CATEGORIES
    .map((cat) => [cat.code, items.filter((i) => i.category === cat.code)] as [string, T[]])
    .filter(([, group]) => group.length > 0)
}

export function RoomFeaturePicker({
  selected,
  onChange,
  excluded = [],
}: {
  selected: RoomFeature[]
  onChange: (next: RoomFeature[]) => void
  /** Codes to hide from the Unselected pool entirely — e.g. features already inherited from the Room Type. */
  excluded?: RoomFeature[]
}) {
  const { options: allOptions, loading } = useRoomFeatureOptions()
  const options = allOptions.filter((o) => !excluded.some((e) => e.category === o.category && e.code === o.code))

  const isSelected = (category: string, code: string) => selected.some((s) => s.category === category && s.code === code)

  const toggle = (category: string, code: string) => {
    if (isSelected(category, code)) {
      onChange(selected.filter((s) => !(s.category === category && s.code === code)))
    } else {
      onChange([...selected, { category, code }])
    }
  }

  const available = options.filter((o) => !isSelected(o.category, o.code))
  const availableGrouped = groupFeaturesByCategory(available)
  const selectedOptions = selected
    .filter((s) => !excluded.some((e) => e.category === s.category && e.code === s.code))
    .map((s) => allOptions.find((o) => o.category === s.category && o.code === s.code) ?? { ...s, value: s.code })
  const selectedGrouped = groupFeaturesByCategory(selectedOptions)

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading feature options...</p>
  }

  if (allOptions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No feature options configured yet — add some under Controls &gt; Inventory &gt; Room Features.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Unselected
        </div>
        <div className="max-h-56 overflow-y-auto p-3 space-y-3">
          {availableGrouped.length === 0 ? (
            <p className="text-xs text-muted-foreground">Everything has been selected.</p>
          ) : (
            availableGrouped.map(([category, group]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-semibold text-foreground">{ROOM_FEATURE_CATEGORY_LABELS[category]}</p>
                <div className="space-y-1">
                  {group.map((opt) => (
                    <label key={`${opt.category}:${opt.code}`} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={false} onCheckedChange={() => toggle(opt.category, opt.code)} />
                      {opt.value}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-md border border-border">
        <div className="border-b border-border bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Selected
        </div>
        <div className="max-h-56 overflow-y-auto p-3 space-y-3">
          {selectedGrouped.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing selected yet.</p>
          ) : (
            selectedGrouped.map(([category, group]) => (
              <div key={category}>
                <p className="mb-1 text-xs font-semibold text-foreground">{ROOM_FEATURE_CATEGORY_LABELS[category]}</p>
                <div className="space-y-1">
                  {group.map((opt) => (
                    <label key={`${opt.category}:${opt.code}`} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={true} onCheckedChange={() => toggle(opt.category, opt.code)} />
                      {opt.value}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
