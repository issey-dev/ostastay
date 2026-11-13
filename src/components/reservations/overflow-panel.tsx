"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Building2 } from "@/components/icons"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// Overflow on a reservation (Agent Portal plan A-8, Phase 2). An overflow booking is at a
// partner hotel because the house is full: it shows where, and "Move to room type" brings it
// in when a room frees up. A booking not in overflow gets a quiet "Place at a partner hotel".
// Both need the "Mark or clear Overflow" role option (checked on the server).

type Props = {
  reservationId: string
  propertyId: string
  status: string
  isOverflow?: boolean
  overflowHotelName?: string | null
  overflowNote?: string | null
  onChanged: () => void
}

export function OverflowPanel(p: Props) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [hotel, setHotel] = useState("")
  const [note, setNote] = useState("")
  const [types, setTypes] = useState<{ id: string; code: string; name: string; isPseudo?: boolean }[]>([])
  const [typeId, setTypeId] = useState("")

  const live = p.status === "TENTATIVE" || p.status === "RESERVED"

  useEffect(() => {
    if (!p.isOverflow || !live) return
    fetch(`/api/room-types?propertyId=${p.propertyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setTypes((Array.isArray(rows) ? rows : []).filter((t: { isPseudo?: boolean }) => !t.isPseudo)))
      .catch(() => setTypes([]))
  }, [p.isOverflow, p.propertyId, live])

  if (!live) return null

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/reservations/${p.reservationId}/overflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.code === "NO_AVAILABILITY") {
        if (await confirm({ title: "No room free", description: `${data.error} Overbook to move it in anyway?`, confirmLabel: "Overbook" })) {
          return post({ ...body, acknowledgeOverbook: true }, ok)
        }
        return
      }
      if (!res.ok) {
        toast.error(data.error || "That didn't work. Try again.")
        return
      }
      toast.success(ok)
      setPlacing(false)
      p.onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (p.isOverflow) {
    return (
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-label="Overflow">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Building2 className="size-4" /> Overflow: at {p.overflowHotelName ?? "a partner hotel"}
          </p>
          <p className="text-muted-foreground">
            Charged as usual. No Green Tax or registration number here; not counted in occupancy.
            {p.overflowNote ? ` ${p.overflowNote}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <SearchableSelect
              value={typeId}
              onChange={setTypeId}
              placeholder="Room type to move into"
              options={types.map((t) => ({ label: `${t.code} · ${t.name}`, value: t.id }))}
            />
          </div>
          <Button size="sm" variant="outline" disabled={busy || !typeId} onClick={() => post({ action: "clear", roomTypeId: typeId }, "Moved into the hotel")}>
            Move to room type
          </Button>
        </div>
      </section>
    )
  }

  if (!placing) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setPlacing(true)}>
          <Building2 className="mr-1.5 size-4" /> Place at a partner hotel
        </Button>
      </div>
    )
  }

  return (
    <section className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3 text-sm" aria-label="Place in Overflow">
      <Input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="Partner hotel" className="h-9 w-56" aria-label="Partner hotel" />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-9 w-64" aria-label="Note" />
      <Button size="sm" disabled={busy || !hotel.trim()} onClick={() => post({ action: "mark", hotelName: hotel, note }, "Moved to Overflow")}>
        Move to Overflow
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setPlacing(false)}>
        Cancel
      </Button>
    </section>
  )
}
