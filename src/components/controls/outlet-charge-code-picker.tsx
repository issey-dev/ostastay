"use client"

import { Checkbox } from "@/components/ui/checkbox"

export type ChargeCodeOption = { id: string; code: string; description: string; category: string }

const CATEGORY_LABELS: Record<string, string> = {
  ROOM: "Room",
  FOOD_BEVERAGE: "Food & Beverage",
  TRANSPORTATION: "Transportation",
  OTHERS: "Others",
  TAX: "Tax",
  PAYMENT: "Payment",
  SYSTEM: "System",
}

function groupByCategory(options: ChargeCodeOption[]): [string, ChargeCodeOption[]][] {
  const byCategory = new Map<string, ChargeCodeOption[]>()
  for (const opt of options) {
    const list = byCategory.get(opt.category) ?? []
    list.push(opt)
    byCategory.set(opt.category, list)
  }
  return Array.from(byCategory.entries())
}

// Dual-panel unselected/selected picker for an Outlet's curated charge-code pool —
// mirrors src/components/inventory/room-feature-picker.tsx's shape. A charge code is
// never owned by one outlet; this just picks which of the enterprise's existing codes
// this outlet exposes in its own POS view.
export function OutletChargeCodePicker({
  allChargeCodes,
  selectedIds,
  onChange,
}: {
  allChargeCodes: ChargeCodeOption[]
  selectedIds: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((i) => i !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const available = allChargeCodes.filter((cc) => !selectedIds.includes(cc.id))
  const selected = allChargeCodes.filter((cc) => selectedIds.includes(cc.id))
  const availableGrouped = groupByCategory(available)
  const selectedGrouped = groupByCategory(selected)

  if (allChargeCodes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No charge codes configured yet — add some under Controls &gt; Finance &gt; Charge Codes first.
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
                <p className="mb-1 text-xs font-semibold text-foreground">{CATEGORY_LABELS[category] || category}</p>
                <div className="space-y-1">
                  {group.map((cc) => (
                    <label key={cc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={false} onCheckedChange={() => toggle(cc.id)} />
                      <span className="font-mono text-xs text-muted-foreground">{cc.code}</span> {cc.description}
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
                <p className="mb-1 text-xs font-semibold text-foreground">{CATEGORY_LABELS[category] || category}</p>
                <div className="space-y-1">
                  {group.map((cc) => (
                    <label key={cc.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={true} onCheckedChange={() => toggle(cc.id)} />
                      <span className="font-mono text-xs text-muted-foreground">{cc.code}</span> {cc.description}
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
