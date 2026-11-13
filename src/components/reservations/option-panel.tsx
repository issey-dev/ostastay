"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Clock } from "@/components/icons"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// The option panel on a reservation (Agent Portal plan §7, Phase 1). Shown for a TENTATIVE
// booking (confirm, extend the option, release) and for one released by its option
// running out (reinstate as tentative). Every action is the same POST to
// /api/reservations/[id]/option; the server checks the "Confirm, extend or release an
// option" capability and races against the expiry job safely.

type Props = {
  reservationId: string
  confirmationNo: string
  status: string
  optionDate?: string | null
  checkInDate: string
  confirmationRequestedAt?: string | null
  confirmationNote?: string | null
  cancellationReasonCode?: string | null
  onChanged: () => void
}

export function OptionPanel(p: Props) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const [extendTo, setExtendTo] = useState("")
  // Read once per mount: "days left" does not need to tick while the page is open.
  const [now] = useState(() => Date.now())

  const isTentative = p.status === "TENTATIVE"
  const isReleased = p.status === "CANCELLED" && p.cancellationReasonCode === "OPTION_EXPIRED"
  if (!isTentative && !isReleased) return null

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/reservations/${p.reservationId}/option`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "That didn't work. Try again.")
        return
      }
      toast.success(ok)
      setExtendTo("")
      setNote("")
      p.onChanged()
    } catch {
      toast.error("That didn't work. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const release = async () => {
    if (
      !(await confirm({
        title: `Release ${p.confirmationNo}?`,
        description: "The booking is cancelled and its rooms go back on sale. It stays in the lists as a record and can be reinstated while rooms are free.",
        confirmLabel: "Release",
        destructive: true,
      }))
    )
      return
    await act({ action: "release", reason: note || undefined }, "Option released")
  }

  if (isReleased) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          Released: its option ran out before it was confirmed.
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "reinstate" }, "Reinstated as tentative")}>
          Reinstate as tentative
        </Button>
      </section>
    )
  }

  const opt = p.optionDate ? new Date(p.optionDate) : null
  const daysLeft = opt ? Math.ceil((opt.getTime() - now) / 86_400_000) : null

  return (
    <section className="space-y-3 rounded-lg border border-warning/40 bg-warning-muted p-3 text-sm" aria-label="Option">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium text-warning">
            <Clock className="size-4" />
            Tentative{opt ? `: on option until ${format(opt, "EEE d MMM yyyy")}` : ""}
            {daysLeft !== null && daysLeft >= 0 && ` (${daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`})`}
          </p>
          <p className="text-muted-foreground">
            The room is held until then. Confirm it once payment or the contract is checked; if nobody does, it is released
            automatically.
          </p>
          {p.confirmationRequestedAt && (
            <p className="mt-1 text-foreground">
              Confirmation requested {format(new Date(p.confirmationRequestedAt), "d MMM, HH:mm")}
              {p.confirmationNote ? `: ${p.confirmationNote}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (payment ref, contract, reason)"
          className="h-9 w-full bg-background sm:w-72"
          aria-label="Note"
        />
        <Button size="sm" disabled={busy} onClick={() => act({ action: "confirm", note: note || undefined }, "Booking confirmed")}>
          Confirm booking
        </Button>
        <div className="flex items-end gap-2">
          <DatePicker
            value={extendTo || null}
            onChange={setExtendTo}
            placeholder="New option date"
            className="h-9 w-44 bg-background"
            minDate={new Date()}
            maxDate={p.checkInDate.slice(0, 10)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !extendTo}
            onClick={() => extendTo && act({ action: "extend", optionDate: extendTo }, "Option extended")}
          >
            Extend option
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={release}>
          Release
        </Button>
      </div>
    </section>
  )
}
