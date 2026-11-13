"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Briefcase } from "@/components/icons"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

// Change requests from the agent portal on this booking (Agent Portal plan A-15). The agent
// can never change or cancel a confirmed booking directly; they ask, and the desk accepts
// (then makes the change as usual) or declines with a reason the agent sees.

type Req = {
  id: string
  type: "AMEND" | "CANCEL"
  status: string
  note: string | null
  decisionNote: string | null
  payload: Record<string, unknown>
  createdAt: string
  agent: { name: string; email: string } | null
}

const describe = (p: Record<string, unknown>) =>
  [
    p.checkIn ? `arrive ${p.checkIn}` : null,
    p.checkOut ? `leave ${p.checkOut}` : null,
    p.roomTypeId ? "another room type" : null,
    p.adults ? `${p.adults} adults` : null,
    p.reasonCode ? `reason: ${p.reasonCode}` : null,
  ]
    .filter(Boolean)
    .join(", ")

export function AgentRequestsPanel({ reservationId, onChanged }: { reservationId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Req[]>([])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const res = await fetch(`/api/reservations/${reservationId}/change-requests`)
    setRows(res.ok ? await res.json() : [])
  }, [reservationId])
  useEffect(() => {
    load()
  }, [load])

  const pending = rows.filter((r) => r.status === "PENDING")
  if (pending.length === 0) return null

  const decide = async (id: string, action: "accept" | "decline") => {
    setBusy(true)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, note }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "That didn't work."))
        return
      }
      toast.success(action === "accept" ? "Accepted. Now make the change on the booking." : "Declined. The agent sees your reason.")
      setNote("")
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-info/40 bg-info-muted p-3 text-sm" aria-label="Agent requests">
      {pending.map((r) => (
        <div key={r.id} className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <Briefcase className="size-4" />
            {r.agent?.name ?? "The agent"} asks to {r.type === "CANCEL" ? "cancel this booking" : "change this booking"}
            <span className="font-normal text-muted-foreground">· {format(new Date(r.createdAt), "d MMM, HH:mm")}</span>
          </p>
          {(describe(r.payload) || r.note) && (
            <p className="text-foreground">{[describe(r.payload), r.note].filter(Boolean).join(" · ")}</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the agent (required to decline)" className="min-h-9 w-full bg-background sm:w-96" aria-label="Note to the agent" />
            <Button size="sm" disabled={busy} onClick={() => decide(r.id, "accept")}>Accept</Button>
            <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => decide(r.id, "decline")}>Decline</Button>
          </div>
        </div>
      ))}
    </section>
  )
}
