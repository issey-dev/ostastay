"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { Loader2, BedDouble, Wallet } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Badge } from "@/components/ui/badge"

type CheckInReservation = {
  id: string
  confirmationNo: string
  checkInDate: string
  checkOutDate: string
  primaryGuest: { firstName: string; lastName: string | null }
  assignments: {
    id: string
    startDate: string
    roomId: string | null
    room: { id: string; roomNumber: string; status: string } | null
    roomType: { id: string; name: string }
  }[]
  folios?: { payments?: { amount: number; isRefund: boolean }[] }[]
}

type CheckInDialogProps = {
  reservation: CheckInReservation | null
  propertyId: string
  isOpen: boolean
  onClose: () => void
  onDone: (result: { title: string; message: string; isError?: boolean }) => void
}

const roomStatusLabel = (status: string) => status.replace(/_/g, " ").toLowerCase()

// One-stop check-in: pick/confirm the room (with housekeeping status visible),
// optionally take a payment, and check the guest in — without leaving the desk view.
export function CheckInDialog({ reservation, propertyId, isOpen, onClose, onDone }: CheckInDialogProps) {
  const [availableRooms, setAvailableRooms] = useState<{ id: string; roomNumber: string; status: string }[]>([])
  const [selectedRoomId, setSelectedRoomId] = useState("")
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])
  const [paymentMethodId, setPaymentMethodId] = useState("")
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentRef, setPaymentRef] = useState("")
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The segment being checked into: the one covering the arrival date (first by start).
  const activeAssignment = useMemo(() => {
    if (!reservation?.assignments?.length) return null
    return [...reservation.assignments].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )[0]
  }, [reservation])

  const depositTotal = useMemo(() => {
    return reservation?.folios?.flatMap((f) => f.payments || [])
      .reduce((sum, p) => sum + (p.isRefund ? -p.amount : p.amount), 0) ?? 0
  }, [reservation])

  useEffect(() => {
    if (!isOpen || !reservation || !activeAssignment) return
    setSelectedRoomId(activeAssignment.roomId ?? "")
    setPaymentAmount("")
    setPaymentRef("")
    setError(null)

    setLoadingRooms(true)
    const params = new URLSearchParams({
      propertyId,
      roomTypeId: activeAssignment.roomType.id,
      checkInDate: reservation.checkInDate,
      checkOutDate: reservation.checkOutDate,
      excludeReservationId: reservation.id,
    })
    fetch(`/api/rooms/available?${params}`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setAvailableRooms(data) })
      .catch(console.error)
      .finally(() => setLoadingRooms(false))

    fetch(`/api/payment-methods`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setPaymentMethods(data.filter((m: any) => m.isActive !== false)) })
      .catch(console.error)
  }, [isOpen, reservation?.id])

  // The currently-assigned room may not be in the available list (e.g. it went
  // DIRTY or OOO since assignment) — keep it selectable so its state is visible.
  const roomOptions = useMemo(() => {
    const options = availableRooms.map((r) => ({
      label: `${r.roomNumber} — ${roomStatusLabel(r.status)}`,
      value: r.id,
    }))
    const current = activeAssignment?.room
    if (current && !availableRooms.some((r) => r.id === current.id)) {
      options.unshift({ label: `${current.roomNumber} — ${roomStatusLabel(current.status)} (current)`, value: current.id })
    }
    return options
  }, [availableRooms, activeAssignment])

  const selectedRoom = useMemo(() => {
    if (selectedRoomId === activeAssignment?.room?.id) return activeAssignment.room
    return availableRooms.find((r) => r.id === selectedRoomId) ?? null
  }, [selectedRoomId, availableRooms, activeAssignment])

  const handleSubmit = async () => {
    if (!reservation || !activeAssignment) return
    if (!selectedRoomId) { setError("Select a room to check the guest into."); return }
    const wantsPayment = paymentAmount.trim() !== ""
    const parsedAmount = parseFloat(paymentAmount)
    if (wantsPayment && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      setError("Payment amount must be a positive number."); return
    }
    if (wantsPayment && !paymentMethodId) { setError("Select a payment method for the payment."); return }

    setSubmitting(true)
    setError(null)
    try {
      // 1. Room change first, if the desk picked a different room.
      if (selectedRoomId !== activeAssignment.roomId) {
        const reassign = await fetch(`/api/reservations/assignments/${activeAssignment.id}/reassign`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: selectedRoomId }),
        })
        if (!reassign.ok) {
          const data = await reassign.json()
          setError(data.error || "Failed to assign the selected room.")
          return
        }
      }

      // 2. Check in via the dedicated route.
      const checkIn = await fetch(`/api/reservations/${reservation.id}/check-in`, { method: "POST" })
      const checkInData = await checkIn.json()
      if (!checkIn.ok) {
        setError(checkInData.error || "Check-in failed.")
        return
      }

      // 3. Optional payment onto the billing folio the check-in guaranteed exists.
      let paymentNote = ""
      if (wantsPayment && checkInData.folioId) {
        const pay = await fetch(`/api/folios/${checkInData.folioId}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentMethodId,
            amount: parsedAmount,
            referenceNumber: paymentRef || null,
          }),
        })
        if (pay.ok) {
          paymentNote = ` $${parsedAmount.toFixed(2)} payment collected.`
        } else {
          const payData = await pay.json()
          paymentNote = ` Payment failed: ${payData.error || "unknown error"} — collect it via the Folio panel.`
        }
      }

      onClose()
      onDone({
        title: "Check-in Complete",
        message:
          (checkInData.roomWarning
            ? `Guest checked in. Warning: ${checkInData.roomWarning}`
            : "Guest has been successfully checked in.") + paymentNote,
      })
    } catch {
      setError("An unexpected error occurred during check-in.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!reservation) return null
  const guestName = `${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName ?? ""}`.trim()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check In — {guestName}</DialogTitle>
          <DialogDescription>
            {reservation.confirmationNo} · {format(new Date(reservation.checkInDate), "dd-MMM-yy")} –{" "}
            {format(new Date(reservation.checkOutDate), "dd-MMM-yy")} · {activeAssignment?.roomType.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {depositTotal > 0.005 && (
            <div className="flex items-center gap-2 text-sm bg-success-muted text-success rounded-md p-2.5 border border-success/20">
              <Wallet className="w-4 h-4 shrink-0" />
              <span>
                <span className="font-semibold">${depositTotal.toFixed(2)} deposit</span> already collected — it's on the
                billing window.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><BedDouble className="w-4 h-4" /> Room</Label>
            <SearchableSelect
              value={selectedRoomId}
              onChange={(v: string) => setSelectedRoomId(v)}
              placeholder={loadingRooms ? "Loading rooms..." : "Select room..."}
              options={roomOptions}
            />
            {selectedRoom?.status === "DIRTY" && (
              <p className="text-xs text-warning font-medium">
                Room {selectedRoom.roomNumber} has not been cleaned yet — check-in will proceed with a warning.
              </p>
            )}
            {(selectedRoom?.status === "OUT_OF_ORDER" || selectedRoom?.status === "OUT_OF_SERVICE") && (
              <p className="text-xs text-destructive font-medium">
                Room {selectedRoom.roomNumber} is {roomStatusLabel(selectedRoom.status)} — check-in will be blocked. Pick
                a different room.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Wallet className="w-4 h-4" /> Collect Payment (optional)</Label>
              <Badge variant="outline" className="text-[10px]">posts to folio</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SearchableSelect
                value={paymentMethodId}
                onChange={(v: string) => setPaymentMethodId(v)}
                placeholder="Payment method..."
                options={paymentMethods.map((m) => ({ label: m.name, value: m.id }))}
              />
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <Input
              placeholder="Reference (optional)"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !selectedRoomId}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Check In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
