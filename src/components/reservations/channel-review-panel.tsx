"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Bell } from "@/components/icons"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { useConfirm } from "@/components/providers/confirm-provider"
import { parseDateKey, toDateKey } from "@/lib/date-only"

// A booking channel cancelled or changed this booking after it became a reservation, and it
// was not applied automatically (DECISIONS.md "Channel bookings changed or cancelled after they
// became a reservation", 2026-11-23). The desk applies it the normal way — Cancel, or the edit
// form pre-filled with the channel's details — or dismisses it if it was handled another way.

type Pending = {
  action: "CANCEL" | "CHANGE"
  reason: string | null
  since: string | null
  channelName: string | null
  externalBookingId: string
  channel: {
    arrival: string | null
    departure: string | null
    adults: number | null
    children: number | null
    roomTypeId: string | null
    roomTypeName: string | null
  }
}

const day = (v: string | null) => {
  const d = parseDateKey(v)
  return d ? toDateKey(d) : ""
}

export function ChannelReviewPanel({
  reservationId,
  slug,
  onCancel,
  onChanged,
}: {
  reservationId: string
  slug: string
  /** The page's own cancel action (same confirm, fee handling and toast as the header button). */
  onCancel: () => void | Promise<void>
  onChanged?: () => void
}) {
  const confirm = useConfirm()
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/reservations/${reservationId}/channel-review`)
    setPending(res.ok ? (await res.json()).pending : null)
  }, [reservationId])
  useEffect(() => {
    load()
  }, [load])

  if (!pending) return null
  const who = pending.channelName ?? "The booking channel"

  const dismiss = async () => {
    if (!(await confirm({
      title: "Dismiss this?",
      description: "Use this only if you handled it another way, for example agreed with the channel to keep the booking as it is. The reservation is not changed.",
      confirmLabel: "Dismiss",
    }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/channel-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "That didn't work."))
        return
      }
      toast.success("Dismissed")
      setPending(null)
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    await onCancel()
    load()
  }

  const c = pending.channel
  const applyHref = (() => {
    const q = new URLSearchParams({ channelChange: "1" })
    if (c.arrival) q.set("checkIn", day(c.arrival))
    if (c.departure) q.set("checkOut", day(c.departure))
    if (c.adults != null) q.set("adults", String(c.adults))
    if (c.children != null) q.set("children", String(c.children))
    if (c.roomTypeId) q.set("roomTypeId", c.roomTypeId)
    return `/e/${slug}/dashboard/reservations/${reservationId}/edit?${q.toString()}`
  })()

  return (
    <section className="space-y-2 rounded-lg border border-warning/40 bg-warning-muted p-3 text-sm" aria-label="Booking channel update">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <Bell className="size-4" />
        {who} {pending.action === "CANCEL" ? "cancelled this booking" : "changed this booking"}
        <span className="font-normal text-muted-foreground">
          · ref {pending.externalBookingId}
          {pending.since ? ` · ${format(new Date(pending.since), "d MMM, HH:mm")}` : ""}
        </span>
      </p>
      {pending.reason && <p className="text-foreground">{pending.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {pending.action === "CANCEL" ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={cancel}>Cancel reservation</Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => router.push(applyHref)}>Apply</Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={dismiss}>Dismiss</Button>
      </div>
    </section>
  )
}
