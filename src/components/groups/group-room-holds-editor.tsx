"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Plus, Trash2, AlertTriangle } from "@/components/icons"

export type RoomHold = { roomTypeId: string; quantity: number }

// Per-room-type holds editor for a group block. Real (non-pseudo) room types only,
// each usable once. Shows the max holdable per type for the block dates and warns
// (soft — staff can still proceed) when a hold would overbook.
export function GroupRoomHoldsEditor({
  propertyId,
  value,
  onChange,
  startDate,
  endDate,
  excludeGroupBlockId,
}: {
  propertyId: string
  value: RoomHold[]
  onChange: (v: RoomHold[]) => void
  startDate?: string
  endDate?: string
  excludeGroupBlockId?: string
}) {
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [available, setAvailable] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRoomTypes(d.filter((rt: any) => !rt.isPseudo && rt.isActive !== false)) })
      .catch(console.error)
  }, [propertyId])

  // Max holdable per type for the block dates (excludes this block's own holds).
  useEffect(() => {
    if (!propertyId || !startDate || !endDate) { setAvailable(null); return }
    const exclude = excludeGroupBlockId ? `&excludeGroupBlockId=${excludeGroupBlockId}` : ""
    fetch(`/api/groups/room-availability?propertyId=${propertyId}&startDate=${startDate}&endDate=${endDate}${exclude}`)
      .then((r) => r.json())
      .then((d) => setAvailable(d?.available ?? null))
      .catch(() => setAvailable(null))
  }, [propertyId, startDate, endDate, excludeGroupBlockId])

  const usedIds = new Set(value.map((v) => v.roomTypeId))
  const total = value.reduce((s, v) => s + (v.quantity || 0), 0)

  const addRow = () => {
    const next = roomTypes.find((rt) => !usedIds.has(rt.id))
    onChange([...value, { roomTypeId: next?.id ?? "", quantity: 1 }])
  }
  const update = (i: number, patch: Partial<RoomHold>) => onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-xs text-muted-foreground">No room types held yet — add one to reserve inventory.</p>}
      {value.map((row, i) => {
        const max = available && row.roomTypeId in available ? available[row.roomTypeId] : null
        const overbooked = max != null && row.quantity > max
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchableSelect
                  value={row.roomTypeId}
                  onChange={(v) => update(i, { roomTypeId: v ?? "" })}
                  placeholder="Room type"
                  options={roomTypes
                    .filter((rt) => rt.id === row.roomTypeId || !usedIds.has(rt.id))
                    .map((rt) => ({ label: `${rt.name} (${rt.code})`, value: rt.id }))}
                />
              </div>
              <Input
                type="number"
                min="0"
                className={`w-20 ${overbooked ? "border-warning focus-visible:ring-warning/40" : ""}`}
                value={row.quantity}
                onChange={(e) => update(i, { quantity: parseInt(e.target.value) || 0 })}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} title="Remove" aria-label="Remove">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            {row.roomTypeId && max != null && (
              overbooked ? (
                <p className="text-[11px] text-warning flex items-center gap-1 pl-0.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Only {max} available for these dates — holding {row.quantity} will overbook.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground pl-0.5">{max} available for these dates.</p>
              )
            )}
          </div>
        )
      })}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={roomTypes.length <= value.length}>
          <Plus className="w-4 h-4 mr-1" /> Add room type
        </Button>
        <span className="text-xs text-muted-foreground">Total held: <span className="font-semibold text-foreground">{total}</span></span>
      </div>
    </div>
  )
}
