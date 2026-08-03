"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarClock, AlertTriangle, Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { toast } from "@/lib/toast"

// Skip the business date over a period the property was CLOSED, without running an
// End-of-Day for each day (app-owner request, 2026-08-03).
//
// The dialog previews before it acts: pick a date, and it asks the server what — if
// anything — sits in that range. Blockers are listed individually and the confirm button
// stays disabled, because "you can't" is far less useful to a night auditor than "these
// three bookings arrive while you're closed". The server re-checks on submit regardless,
// so a stale preview can never let a roll through.

type Blocker = { kind: string; count: number; message: string }
type Preview = { from: string; to: string | null; days: number; blockers: Blocker[]; canRoll: boolean }

export function RollForwardDialog({
  propertyId,
  currentBusinessDate,
  onRolled,
}: {
  propertyId: string
  currentBusinessDate: string
  onRolled: () => void
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(
    async (to: string) => {
      if (!to || !propertyId) return
      setChecking(true)
      setError(null)
      try {
        const res = await fetch(`/api/eod/roll-forward?propertyId=${propertyId}&to=${to}`)
        const data = await res.json()
        if (!res.ok) {
          setPreview(null)
          setError(data.error ?? "Could not check that date")
          return
        }
        setPreview(data)
      } catch {
        setError("Could not check that date")
      } finally {
        setChecking(false)
      }
    },
    [propertyId]
  )

  useEffect(() => {
    if (open && target) void check(target)
  }, [open, target, check])

  const roll = async () => {
    setRolling(true)
    try {
      const res = await fetch("/api/eod/roll-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, to: target }),
      })
      const data = await res.json()
      if (!res.ok) {
        // A 409 carries the fresh blocker list — show it rather than a bare error.
        if (data.blockers) setPreview(data)
        setError(data.error ?? "Could not roll the business date")
        return
      }
      toast.success(`Business date moved to ${data.to} (${data.days} day${data.days > 1 ? "s" : ""} skipped)`)
      setOpen(false)
      setTarget("")
      setPreview(null)
      onRolled()
    } finally {
      setRolling(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="w-4 h-4 mr-2" /> Roll forward
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (rolling) return
          setOpen(o)
          if (!o) {
            setTarget("")
            setPreview(null)
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll the business date forward</DialogTitle>
            <DialogDescription>
              For periods the property was closed. Days skipped this way are never audited, so the range has to be
              free of bookings and activity. To close a day that had guests, run End of Day instead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Currently <span className="font-medium text-foreground">{currentBusinessDate}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roll-target">Roll to</Label>
              <DatePicker value={target} onChange={setTarget} minDate={currentBusinessDate} />
            </div>

            {checking && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the period…
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {preview && !checking && preview.to && (
              preview.canRoll ? (
                <div className="rounded-md bg-success-muted p-3 text-sm text-success">
                  Nothing scheduled in this period — {preview.days} day{preview.days > 1 ? "s" : ""} will be skipped.
                </div>
              ) : (
                <div className="space-y-2 rounded-md bg-destructive-muted p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" /> This period still has activity
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
                    {preview.blockers.map((b) => (
                      <li key={b.kind}>{b.message}</li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={rolling}>
              Cancel
            </Button>
            <Button onClick={() => void roll()} disabled={!preview?.canRoll || rolling || checking}>
              {rolling ? "Rolling…" : "Roll forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
