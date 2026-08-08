"use client"

import { useEffect, useState, useCallback } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Printer, XCircle, UserX, CloudRain, ArrowRightCircle } from "@/components/icons"

type ManifestBooking = {
  id: string
  guestName: string
  roomNumber: string | null
  isWalkIn: boolean
  adultCount: number
  childCount: number
  infantCount: number
  totalAmount: number
  status: string
  notes: string | null
}

type Manifest = {
  id: string
  excursionType: { name: string }
  departureDate: string
  departureTime: string
  meetingTime: string | null
  meetingPoint: string | null
  capacity: number
  minCapacity: number | null
  status: string
  bookings: ManifestBooking[]
}

type CascadeResult = {
  cancelledCount: number
  voidedCount: number
  movableBookingIds: string[]
  unmovable: Array<{ bookingId: string; reason: string }>
  suggestedReplacement: { id: string; departureDate: string; departureTime: string; capacity: number } | null
}

// The per-departure passenger manifest — view who's booked, cancel a booking (voids
// the posted charge when the folio's still open and the actor has cashiering access;
// otherwise cancels the record and leaves the charge for cashiering to handle), mark a
// no-show once the trip has actually left, print, or cancel the WHOLE departure (e.g.
// weather) — which cascades to every booking and offers a one-click move to the next
// available departure of the same excursion type. See .agents/docs/EXCURSIONS_PLAN.md
// Phases 4-5.
export function ExcursionManifestPanel({
  departureId,
  isOpen,
  onClose,
}: {
  departureId: string | null
  isOpen: boolean
  onClose: () => void
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState<ManifestBooking | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const [cancellingDeparture, setCancellingDeparture] = useState(false)
  const [departureCancelReason, setDepartureCancelReason] = useState("")
  const [submittingDepartureCancel, setSubmittingDepartureCancel] = useState(false)
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null)
  const [moving, setMoving] = useState(false)

  const fetchManifest = useCallback(() => {
    if (!departureId) return
    setLoading(true)
    fetch(`/api/excursions/departures/${departureId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setManifest(data) })
      .finally(() => setLoading(false))
  }, [departureId])

  useEffect(() => {
    if (isOpen && departureId) {
      fetchManifest()
      setCascadeResult(null)
    }
  }, [isOpen, departureId, fetchManifest])

  const departed = manifest ? new Date() >= new Date(`${manifest.departureDate.slice(0, 10)}T${manifest.departureTime}`) : false

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cancelling || !cancelReason.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/excursions/bookings/${cancelling.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setFeedback({ message: data.chargeNote, type: data.chargeVoided ? "success" : "error" })
        setCancelling(null)
        setCancelReason("")
        fetchManifest()
      } else {
        setFeedback({ message: data.error || "Failed to cancel booking", type: "error" })
      }
    } finally {
      setSubmitting(false)
      setTimeout(() => setFeedback(null), 6000)
    }
  }

  const handleNoShow = async (bookingId: string) => {
    const res = await fetch(`/api/excursions/bookings/${bookingId}/no-show`, { method: "POST" })
    if (res.ok) {
      fetchManifest()
    } else {
      const data = await res.json()
      setFeedback({ message: data.error || "Failed to mark no-show", type: "error" })
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  const handleCancelDeparture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!departureId || !departureCancelReason.trim()) return
    setSubmittingDepartureCancel(true)
    try {
      const res = await fetch(`/api/excursions/departures/${departureId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: departureCancelReason.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setCascadeResult(data)
        setCancellingDeparture(false)
        setDepartureCancelReason("")
        fetchManifest()
      } else {
        setFeedback({ message: data.error || "Failed to cancel departure", type: "error" })
        setTimeout(() => setFeedback(null), 6000)
      }
    } finally {
      setSubmittingDepartureCancel(false)
    }
  }

  const handleMoveAll = async () => {
    if (!departureId || !cascadeResult?.suggestedReplacement || cascadeResult.movableBookingIds.length === 0) return
    setMoving(true)
    try {
      const res = await fetch(`/api/excursions/departures/${departureId}/move-bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDepartureId: cascadeResult.suggestedReplacement.id, bookingIds: cascadeResult.movableBookingIds }),
      })
      const data = await res.json()
      if (res.ok) {
        setFeedback({ message: `Moved ${data.moved.length} booking(s) to the replacement departure.${data.failed.length ? ` ${data.failed.length} could not be moved.` : ""}`, type: data.failed.length ? "error" : "success" })
        setCascadeResult(null)
      } else {
        setFeedback({ message: data.error || "Failed to move bookings", type: "error" })
      }
    } finally {
      setMoving(false)
      setTimeout(() => setFeedback(null), 8000)
    }
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{manifest?.excursionType.name ?? "Manifest"}</SheetTitle>
          </SheetHeader>

          <div className="px-4 pb-6 space-y-6">
            {loading || !manifest ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <>
                <div className="bg-card p-4 rounded-xl border shadow-sm flex justify-between items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {new Date(manifest.departureDate).toLocaleDateString([], { dateStyle: "medium" })} at {manifest.departureTime}
                        {manifest.meetingPoint && ` · Meet at ${manifest.meetingPoint}${manifest.meetingTime ? ` (${manifest.meetingTime})` : ""}`}
                      </p>
                      <StatusBadge label={manifest.status} status={manifest.status} />
                    </div>
                    <p className="text-sm font-medium mt-1">
                      {manifest.bookings.reduce((s, b) => s + b.adultCount + b.childCount + b.infantCount, 0)}/{manifest.capacity} booked
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => window.open(`/api/excursions/departures/${departureId}/manifest-pdf`, "_blank")}>
                      <Printer className="w-4 h-4 mr-2" /> Print Manifest
                    </Button>
                    {manifest.status === "SCHEDULED" && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancellingDeparture(true)}>
                        <CloudRain className="w-4 h-4 mr-2" /> Cancel Departure
                      </Button>
                    )}
                  </div>
                </div>

                {feedback && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-warning-muted text-warning"}`}>
                    {feedback.message}
                  </div>
                )}

                {cascadeResult && (
                  <div className="bg-card p-4 rounded-xl border shadow-sm space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      Cancelled {cascadeResult.cancelledCount} booking(s), voided {cascadeResult.voidedCount} charge(s).
                    </p>
                    {cascadeResult.unmovable.length > 0 && (
                      <div className="text-sm text-warning">
                        {cascadeResult.unmovable.length} booking(s) need manual handling:
                        <ul className="list-disc list-inside mt-1">
                          {cascadeResult.unmovable.map((u) => <li key={u.bookingId}>{u.reason}</li>)}
                        </ul>
                      </div>
                    )}
                    {cascadeResult.suggestedReplacement && cascadeResult.movableBookingIds.length > 0 ? (
                      <div className="flex items-center justify-between bg-muted rounded-lg p-3">
                        <p className="text-sm">
                          Move {cascadeResult.movableBookingIds.length} guest(s) to{" "}
                          {new Date(cascadeResult.suggestedReplacement.departureDate).toLocaleDateString([], { dateStyle: "medium" })} at{" "}
                          {cascadeResult.suggestedReplacement.departureTime}?
                        </p>
                        <Button size="sm" onClick={handleMoveAll} disabled={moving}>
                          <ArrowRightCircle className="w-4 h-4 mr-2" /> {moving ? "Moving..." : "Move All"}
                        </Button>
                      </div>
                    ) : cascadeResult.movableBookingIds.length > 0 ? (
                      <p className="text-sm text-muted-foreground">No upcoming departure of this type has room for a replacement — move guests manually once one opens up.</p>
                    ) : null}
                  </div>
                )}

                {/* Phone view — stacked card per booking. The table below (md+) shows
                    the same four facts in columns; a passenger manifest checked at a
                    boat ramp on a phone shouldn't need a horizontal scroll to see who's
                    confirmed. */}
                <div className="md:hidden space-y-2">
                  {manifest.bookings.length === 0 ? (
                    <p className="text-center text-muted-foreground text-sm py-6">No bookings yet.</p>
                  ) : (
                    manifest.bookings.map((b) => (
                      <div key={b.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{b.guestName}</p>
                            <p className="text-xs text-muted-foreground">{b.isWalkIn ? "Walk-in" : b.roomNumber ? `Room ${b.roomNumber}` : "In-house"}</p>
                          </div>
                          <StatusBadge label={b.status} status={b.status} />
                        </div>
                        {b.notes && <p className="text-xs text-muted-foreground italic">{b.notes}</p>}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-muted-foreground">
                            {b.adultCount}A{b.childCount ? ` ${b.childCount}C` : ""}{b.infantCount ? ` ${b.infantCount}I` : ""}
                          </span>
                          {b.status === "CONFIRMED" && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!departed} title={departed ? "Mark no-show" : "Only available after departure"} onClick={() => handleNoShow(b.id)}>
                                <UserX className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelling(b)}>
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Guest</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {manifest.bookings.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm">No bookings yet.</TableCell></TableRow>
                      )}
                      {manifest.bookings.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <p className="font-medium">{b.guestName}</p>
                            <p className="text-xs text-muted-foreground">{b.isWalkIn ? "Walk-in" : b.roomNumber ? `Room ${b.roomNumber}` : "In-house"}</p>
                            {b.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{b.notes}</p>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {b.adultCount}A{b.childCount ? ` ${b.childCount}C` : ""}{b.infantCount ? ` ${b.infantCount}I` : ""}
                          </TableCell>
                          <TableCell><StatusBadge label={b.status} status={b.status} /></TableCell>
                          <TableCell className="text-right">
                            {b.status === "CONFIRMED" && (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!departed} title={departed ? "Mark no-show" : "Only available after departure"} onClick={() => handleNoShow(b.id)}>
                                  <UserX className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelling(b)}>
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) { setCancelling(null); setCancelReason("") } }}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCancel}>
            <DialogHeader>
              <DialogTitle>Cancel Booking</DialogTitle>
              <DialogDescription>
                Cancel {cancelling?.guestName}&apos;s booking ({cancelling?.adultCount} adult{cancelling && cancelling.adultCount === 1 ? "" : "s"}
                {cancelling?.childCount ? `, ${cancelling.childCount} child${cancelling.childCount === 1 ? "" : "ren"}` : ""})? A reason is required.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label>Reason *</Label>
              <Input required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Guest requested cancellation" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setCancelling(null); setCancelReason("") }}>Back</Button>
              <Button type="submit" variant="destructive" disabled={submitting || !cancelReason.trim()}>
                {submitting ? "Cancelling..." : "Cancel Booking"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellingDeparture} onOpenChange={(open) => { if (!open) { setCancellingDeparture(false); setDepartureCancelReason("") } }}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleCancelDeparture}>
            <DialogHeader>
              <DialogTitle>Cancel Entire Departure</DialogTitle>
              <DialogDescription>
                Cancels every booking on this departure (e.g. bad weather). Charges are voided where possible; you&apos;ll be offered a
                one-click move to the next available departure afterward. A reason is required.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
              <Label>Reason *</Label>
              <Input required value={departureCancelReason} onChange={(e) => setDepartureCancelReason(e.target.value)} placeholder="e.g. Bad weather" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setCancellingDeparture(false); setDepartureCancelReason("") }}>Back</Button>
              <Button type="submit" variant="destructive" disabled={submittingDepartureCancel || !departureCancelReason.trim()}>
                {submittingDepartureCancel ? "Cancelling..." : "Cancel Departure"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
