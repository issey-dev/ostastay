"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Wand2, CheckCircle, AlertTriangle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineLoading } from "@/components/ui/inline-loading"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import type { AutoAssignProposal, AutoAssignUnassigned } from "@/lib/auto-assign"

// Auto-Assign for bookings that still have no room: shows the plan first (which booking
// gets which room, and which couldn't be placed) and writes nothing until staff confirm.
// Used on the Reservations list and the Front Desk arrivals tab.
export function AutoAssignButton({
  propertyId,
  onDone,
  className,
}: {
  propertyId: string | undefined
  onDone?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [plan, setPlan] = useState<{ proposals: AutoAssignProposal[]; unassigned: AutoAssignUnassigned[] } | null>(null)

  const start = async () => {
    if (!propertyId || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/reservations/auto-assign?propertyId=${propertyId}`, { method: "POST" })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't work out the room plan. Try again."))
        return
      }
      const data = (await res.json()) as { proposals: AutoAssignProposal[]; unassigned: AutoAssignUnassigned[] }
      if (data.proposals.length === 0 && data.unassigned.length === 0) {
        toast.success("Every booking already has a room.")
        return
      }
      setPlan(data)
      setOpen(true)
    } catch {
      toast.error("Couldn't work out the room plan. Try again.")
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    if (!plan || confirming) return
    setConfirming(true)
    try {
      const res = await fetch(`/api/reservations/auto-assign?propertyId=${propertyId}&apply=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: plan.proposals.map((p) => ({ assignmentId: p.assignmentId, roomId: p.roomId })) }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't assign the rooms. Try again."))
        return
      }
      const data = (await res.json()) as { assignedCount: number; skippedCount: number }
      if (data.skippedCount > 0) {
        toast.warning(`${data.assignedCount} assigned, ${data.skippedCount} skipped because the room was taken in the meantime.`)
      } else {
        toast.success(`Rooms assigned to ${data.assignedCount} booking${data.assignedCount === 1 ? "" : "s"}`)
      }
      setOpen(false)
      setPlan(null)
      onDone?.()
    } catch {
      toast.error("Couldn't assign the rooms. Try again.")
    } finally {
      setConfirming(false)
    }
  }

  const dates = (a: { startDate: string; endDate: string }) => `${format(new Date(a.startDate), "dd MMM")} → ${format(new Date(a.endDate), "dd MMM")}`

  return (
    <>
      <Button variant="outline" className={className} onClick={start} disabled={!propertyId || loading}>
        <Wand2 className="mr-2 h-4 w-4" /> {loading ? "Checking..." : "Auto-Assign"}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !confirming && setOpen(o)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Auto-assign rooms</DialogTitle>
            <DialogDescription>
              {plan && plan.proposals.length > 0
                ? "Review the rooms below. Nothing is saved until you confirm."
                : "No room could be assigned automatically."}
            </DialogDescription>
          </DialogHeader>

          {!plan ? (
            <InlineLoading lines={3} label="Working out the plan" />
          ) : (
            <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {plan.proposals.length > 0 && (
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-success">
                    <CheckCircle className="h-4 w-4" /> Will be assigned ({plan.proposals.length})
                  </h4>
                  <ul className="divide-y rounded-md border">
                    {plan.proposals.map((p) => (
                      <li key={p.assignmentId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.guestName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            <span className="font-mono">{p.confirmationNo}</span> · {dates(p)} · {p.roomTypeCode}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md bg-success-muted px-2 py-0.5 text-sm font-semibold text-success">Room {p.roomNumber}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.unassigned.length > 0 && (
                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-warning">
                    <AlertTriangle className="h-4 w-4" /> Could not be assigned ({plan.unassigned.length})
                  </h4>
                  <ul className="divide-y rounded-md border border-warning/30 bg-warning-muted/40">
                    {plan.unassigned.map((u) => (
                      <li key={u.assignmentId} className="px-3 py-2 text-sm">
                        <span className="block truncate font-medium">{u.guestName}</span>
                        <span className="block text-xs text-muted-foreground">
                          <span className="font-mono">{u.confirmationNo}</span> · {dates(u)} · {u.roomTypeCode}
                        </span>
                        <span className="block text-xs text-warning">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={confirming}>
              {plan && plan.proposals.length > 0 ? "Cancel" : "Close"}
            </Button>
            {plan && plan.proposals.length > 0 && (
              <Button onClick={confirm} disabled={confirming}>
                {confirming ? "Assigning..." : `Assign ${plan.proposals.length} room${plan.proposals.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
