"use client"

import { useEffect, useMemo, useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"

export type TypeChangeMove = {
  assignmentId: string
  reservationId: string
  status: string
  guestName: string
  fromRoomLabel: string
  fromTypeLabel: string
  toRoomId: string
  toRoomNumber: string
  toTypeId: string
  toTypeLabel: string
}

// The reason is required for an in-house guest (it is the Front Desk room move, which always
// records one); for a booking that has not arrived yet it is optional.
const schemaFor = (inHouse: boolean) =>
  z.object({ reason: inHouse ? z.string().trim().min(1, "Enter a reason for the change.") : z.string().trim() })
type Values = { reason: string }

// Dragging a booking onto a room of a DIFFERENT type on the tape chart: a room type change
// affects the rate, so staff choose between recalculating at the new type and keeping the
// current rate, and give a reason — the same questions the Front Desk room move asks.
// (Same-type drags never come here: they are just a move.)
export function TapeChartTypeChangeDialog({
  move,
  onClose,
  onDone,
}: {
  move: TypeChangeMove | null
  onClose: () => void
  onDone: () => void
}) {
  const [rateInfo, setRateInfo] = useState<{ keepRate: number; newRate: number; remainingNights: number } | null>(null)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateMode, setRateMode] = useState<"keep" | "new">("new")
  const inHouse = move?.status === "IN_HOUSE"
  const schema = useMemo(() => schemaFor(inHouse), [inHouse])
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { reason: "" } })

  useEffect(() => {
    if (!move) return
    form.reset({ reason: "" })
    setRateMode("new")
    setRateInfo(null)
    let cancelled = false
    setRateLoading(true)
    fetch(`/api/reservations/${move.reservationId}/room-move-rate?newRoomTypeId=${move.toTypeId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRateInfo(d && typeof d.keepRate === "number" ? d : null) })
      .catch(() => { if (!cancelled) setRateInfo(null) })
      .finally(() => { if (!cancelled) setRateLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.assignmentId, move?.toTypeId])

  const submit = async (values: Values) => {
    if (!move) return
    try {
      // In-house guests move through the Front Desk room move (old room → dirty, new segment
      // from today); anyone not yet arrived has their booked room reassigned in place.
      const res =
        move.status === "IN_HOUSE"
          ? await fetch(`/api/reservations/${move.reservationId}/room-move`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ newRoomId: move.toRoomId, newRoomTypeId: move.toTypeId, reason: values.reason, rateMode }),
            })
          : await fetch(`/api/reservations/assignments/${move.assignmentId}/reassign`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ roomId: move.toRoomId, rateMode, ...(values.reason ? { reason: values.reason } : {}) }),
            })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Couldn't move the booking. Try again.")
        return
      }
      toast.success(`Moved to room ${move.toRoomNumber} — ${rateMode === "keep" ? "rate kept" : "rate recalculated"}`)
      onDone()
      onClose()
    } catch {
      toast.error("Couldn't move the booking. Try again.")
    }
  }

  const money = (n: number) => `$${n.toFixed(2)}`

  return (
    <Dialog open={!!move} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        {move && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)}>
              <DialogHeader>
                <DialogTitle>Change room type</DialogTitle>
                <DialogDescription>
                  {move.guestName}: {move.fromRoomLabel} ({move.fromTypeLabel}) → Room {move.toRoomNumber} ({move.toTypeLabel}). A different room type
                  affects the rate.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Rate <span className="text-destructive">*</span></Label>
                  {rateLoading && <p className="text-[11px] text-muted-foreground">Checking rates…</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRateMode("new")}
                      className={`rounded-md border p-3 text-left transition-colors ${rateMode === "new" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}
                    >
                      <div className="text-xs text-muted-foreground">Recalculate at {move.toTypeLabel}</div>
                      <div className="text-lg font-semibold">
                        {rateInfo ? money(rateInfo.newRate) : "—"}
                        <span className="text-xs font-normal text-muted-foreground">/night</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRateMode("keep")}
                      className={`rounded-md border p-3 text-left transition-colors ${rateMode === "keep" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}
                    >
                      <div className="text-xs text-muted-foreground">Keep the current rate</div>
                      <div className="text-lg font-semibold">
                        {rateInfo ? money(rateInfo.keepRate) : "—"}
                        <span className="text-xs font-normal text-muted-foreground">/night</span>
                      </div>
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {rateMode === "keep"
                      ? `The room type changes to ${move.toTypeLabel} but the guest is still billed as ${move.fromTypeLabel}.`
                      : `The guest is billed at the ${move.toTypeLabel} rate.`}
                    {rateInfo ? ` Applies to the remaining ${rateInfo.remainingNights} night${rateInfo.remainingNights === 1 ? "" : "s"}.` : ""}
                  </p>
                </div>

                <FormField control={form.control} name="reason" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for change {inHouse ? <span className="text-destructive">*</span> : <span className="text-xs font-normal text-muted-foreground">(optional)</span>}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Upgrade, Guest request, A/C broken" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button>
                <SubmitButton pending={form.formState.isSubmitting} pendingLabel="Moving…">Confirm change</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
