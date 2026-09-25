"use client"

import { useEffect, useState, useCallback } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { MobileActions } from "@/components/ui/mobile"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"
import { Printer, XCircle, UserX, CloudRain, ArrowRightCircle } from "@/components/icons"
import { SubmitButton } from "@/components/ui/submit-button"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineLoading } from "@/components/ui/inline-loading"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

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
  source?: string
  onlineRef?: string | null
  paidOnline?: boolean
  paymentFlagged?: boolean
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
  heldOnline?: number
}

// Booked by the property's own website (Booking API) — the reference the guest was given.
function OnlineTag({ b }: { b: ManifestBooking }) {
  if (b.source !== "API") return null
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
      <Badge variant="outline">Online</Badge>
      {b.onlineRef && <span className="font-mono text-muted-foreground">{b.onlineRef}</span>}
      {b.paidOnline && <span className="text-muted-foreground">· paid online</span>}
      {b.paymentFlagged && <span className="text-destructive">· check payment</span>}
    </span>
  )
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
  const [noShowId, setNoShowId] = useState<string | null>(null)
  const confirm = useConfirm()

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
        // The note says what happened to the charge; a charge left for cashiering is a warning.
        if (data.chargeVoided) toast.success("Booking cancelled", { description: data.chargeNote })
        else toast.warning("Booking cancelled", { description: data.chargeNote })
        setCancelling(null)
        setCancelReason("")
        fetchManifest()
      } else {
        toast.error(data.error || "Couldn't cancel the booking. Try again.")
      }
    } catch {
      toast.error("Couldn't cancel the booking. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleNoShow = async (b: ManifestBooking) => {
    if (noShowId) return
    const ok = await confirm({
      title: `Mark ${b.guestName} as a no-show?`,
      description: "The booking stays on the manifest as a no-show.",
      confirmLabel: "Mark no-show",
      destructive: true,
    })
    if (!ok) return
    setNoShowId(b.id)
    try {
      const res = await fetch(`/api/excursions/bookings/${b.id}/no-show`, { method: "POST" })
      if (res.ok) {
        toast.success(`${b.guestName} marked no-show`)
        fetchManifest()
      } else {
        toast.error(await apiError(res, "Couldn't mark the no-show. Try again."))
      }
    } catch {
      toast.error("Couldn't mark the no-show. Try again.")
    } finally {
      setNoShowId(null)
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
        toast.error(data.error || "Couldn't cancel the departure. Try again.")
      }
    } catch {
      toast.error("Couldn't cancel the departure. Try again.")
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
        const moved = `Moved ${data.moved.length} booking(s) to the replacement departure`
        if (data.failed.length) toast.warning(moved, { description: `${data.failed.length} could not be moved.` })
        else toast.success(moved)
        setCascadeResult(null)
      } else {
        toast.error(data.error || "Couldn't move the bookings. Try again.")
      }
    } catch {
      toast.error("Couldn't move the bookings. Try again.")
    } finally {
      setMoving(false)
    }
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
        <SheetContent side="right" className="w-full data-[side=right]:sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{manifest?.excursionType.name ?? "Manifest"}</SheetTitle>
          </SheetHeader>

          <div className="px-4 pb-6 space-y-6">
            {loading || !manifest ? (
              <InlineLoading lines={5} label="Loading the manifest" />
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
                      {!!manifest.heldOnline && (
                        <span className="font-normal text-muted-foreground"> · {manifest.heldOnline} held online while the guest pays</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 max-md:hidden">
                    <Button size="sm" variant="outline" onClick={() => window.open(`/api/excursions/departures/${departureId}/manifest-pdf`, "_blank")}>
                      <Printer className="w-4 h-4 mr-2" /> Print manifest
                    </Button>
                    {manifest.status === "SCHEDULED" && (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancellingDeparture(true)}>
                        <CloudRain className="w-4 h-4 mr-2" /> Cancel departure
                      </Button>
                    )}
                  </div>
                </div>

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
                        <SubmitButton type="button" size="sm" onClick={handleMoveAll} pending={moving} pendingLabel="Moving…">
                          <ArrowRightCircle className="w-4 h-4 mr-2" /> Move all
                        </SubmitButton>
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
                <MobileCardList empty={<EmptyState size="inline" className="justify-center py-6" title="No bookings yet" />}>
                  {manifest.bookings.map((b) => (
                    <MobileCard
                      key={b.id}
                      title={b.guestName}
                      subtitle={
                        <>
                          {b.isWalkIn ? "Walk-in" : b.roomNumber ? `Room ${b.roomNumber}` : "In-house"}
                          <OnlineTag b={b} />
                        </>
                      }
                      badge={<StatusBadge label={b.status} status={b.status} />}
                      meta={[
                        {
                          label: "Party",
                          value: `${b.adultCount}A${b.childCount ? ` ${b.childCount}C` : ""}${b.infantCount ? ` ${b.infantCount}I` : ""}`,
                        },
                        ...(b.notes ? [{ label: "Notes", value: <span className="font-normal italic whitespace-pre-line">{b.notes}</span>, wide: true }] : []),
                      ]}
                      actions={
                        b.status === "CONFIRMED" ? (
                          <>
                            <Button size="sm" variant="outline" className="flex-1" disabled={!departed || noShowId === b.id} title={departed ? "Mark no-show" : "Only available after departure"} onClick={() => handleNoShow(b)}>
                              <UserX className="w-4 h-4 mr-1.5" /> No-show
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => setCancelling(b)}>
                              <XCircle className="w-4 h-4 mr-1.5" /> Cancel
                            </Button>
                          </>
                        ) : undefined
                      }
                    />
                  ))}
                </MobileCardList>

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
                        <TableRow><TableCell colSpan={4}><EmptyState size="inline" className="justify-center" title="No bookings yet" /></TableCell></TableRow>
                      )}
                      {manifest.bookings.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <p className="font-medium">{b.guestName}</p>
                            <p className="text-xs text-muted-foreground">{b.isWalkIn ? "Walk-in" : b.roomNumber ? `Room ${b.roomNumber}` : "In-house"}</p>
                            <OnlineTag b={b} />
                            {b.notes && <p className="text-xs text-muted-foreground italic mt-0.5 whitespace-pre-line">{b.notes}</p>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {b.adultCount}A{b.childCount ? ` ${b.childCount}C` : ""}{b.infantCount ? ` ${b.infantCount}I` : ""}
                          </TableCell>
                          <TableCell><StatusBadge label={b.status} status={b.status} /></TableCell>
                          <TableCell className="text-right">
                            {b.status === "CONFIRMED" && (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!departed || noShowId === b.id} title={departed ? "Mark no-show" : "Only available after departure"} aria-label="Mark no-show" onClick={() => handleNoShow(b)}>
                                  <UserX className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" title="Cancel booking" aria-label="Cancel booking" onClick={() => setCancelling(b)}>
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

          {/* Phones: the departure's main action pinned at the bottom of the panel —
              move guests after a cancellation, otherwise the manifest PDF; cancelling the
              whole departure sits under More (it still asks for a reason). */}
          {manifest && !loading && (
            <div className="sticky bottom-0 mt-auto border-t border-border bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
              <MobileActions
                primary={
                  cascadeResult?.suggestedReplacement && cascadeResult.movableBookingIds.length > 0 ? (
                    <SubmitButton type="button" onClick={handleMoveAll} pending={moving} pendingLabel="Moving…">
                      <ArrowRightCircle className="w-4 h-4 mr-2" /> {`Move ${cascadeResult.movableBookingIds.length} guest(s)`}
                    </SubmitButton>
                  ) : (
                    <Button variant="outline" onClick={() => window.open(`/api/excursions/departures/${departureId}/manifest-pdf`, "_blank")}>
                      <Printer className="w-4 h-4 mr-2" /> Manifest PDF
                    </Button>
                  )
                }
                more={manifest.status === "SCHEDULED" ? [{ label: "Cancel departure", icon: CloudRain, destructive: true, onSelect: () => setCancellingDeparture(true) }] : []}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) { setCancelling(null); setCancelReason("") } }}>
        <DialogContent size="sm">
          <form onSubmit={handleCancel}>
            <DialogHeader>
              <DialogTitle>Cancel booking</DialogTitle>
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
              <SubmitButton variant="destructive" pending={submitting} pendingLabel="Cancelling…" disabled={!cancelReason.trim()}>
                Cancel booking
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellingDeparture} onOpenChange={(open) => { if (!open) { setCancellingDeparture(false); setDepartureCancelReason("") } }}>
        <DialogContent size="sm">
          <form onSubmit={handleCancelDeparture}>
            <DialogHeader>
              <DialogTitle>Cancel entire departure</DialogTitle>
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
              <SubmitButton variant="destructive" pending={submittingDepartureCancel} pendingLabel="Cancelling…" disabled={!departureCancelReason.trim()}>
                Cancel departure
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
