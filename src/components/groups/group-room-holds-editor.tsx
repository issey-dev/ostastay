"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2 } from "@/components/icons"

export type RoomHold = { roomTypeId: string; quantity: number }

// Per-room-type holds editor for a group block. Real (non-pseudo) room types only,
// each usable once. The parent owns the value; totalRoomsHeld is its sum.
export function GroupRoomHoldsEditor({
  propertyId,
  value,
  onChange,
}: {
  propertyId: string
  value: RoomHold[]
  onChange: (v: RoomHold[]) => void
}) {
  const [roomTypes, setRoomTypes] = useState<any[]>([])

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRoomTypes(d.filter((rt: any) => !rt.isPseudo && rt.isActive !== false)) })
      .catch(console.error)
  }, [propertyId])

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
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select value={row.roomTypeId} onValueChange={(v) => update(i, { roomTypeId: v ?? "" })}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Room type" /></SelectTrigger>
            <SelectContent>
              {roomTypes
                .filter((rt) => rt.id === row.roomTypeId || !usedIds.has(rt.id))
                .map((rt) => <SelectItem key={rt.id} value={rt.id}>{rt.name} ({rt.code})</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="0"
            className="w-20"
            value={row.quantity}
            onChange={(e) => update(i, { quantity: parseInt(e.target.value) || 0 })}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} title="Remove">
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={roomTypes.length <= value.length}>
          <Plus className="w-4 h-4 mr-1" /> Add room type
        </Button>
        <span className="text-xs text-muted-foreground">Total held: <span className="font-semibold text-foreground">{total}</span></span>
      </div>
    </div>
  )
}
