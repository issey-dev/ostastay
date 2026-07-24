"use client"

import { useEffect, useMemo, useState } from "react"
import { addDays, format, startOfDay } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Loader2, UserPlus } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DateRangePicker } from "@/components/ui/date-range-picker"

type WalkInBookingDialogProps = {
  propertyId: string
  isOpen: boolean
  onClose: () => void
  onDone: (result: { title: string; message: string; isError?: boolean }) => void
  /** "walkIn" (default) checks the guest in immediately after booking; "book" just books. */
  mode?: "walkIn" | "book"
  /** Prefill (e.g. from a tape-chart cell click): room type, room, and arrival date. */
  initial?: { roomTypeId?: string; roomId?: string; checkInDate?: string }
}

const toIsoDate = (d: Date) => format(d, "yyyy-MM-dd")

// A compressed booking flow: pick or quick-create the guest, confirm dates/room/
// rate, and book — one dialog instead of the full multi-segment booking form.
// Walk-in mode additionally checks the guest straight in; book mode (used by the
// tape chart's empty-cell click) leaves the booking RESERVED.
export function WalkInBookingDialog({ propertyId, isOpen, onClose, onDone, mode = "walkIn", initial }: WalkInBookingDialogProps) {
  const [profiles, setProfiles] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [availableRooms, setAvailableRooms] = useState<any[]>([])

  const [guestId, setGuestId] = useState("")
  const [newGuestMode, setNewGuestMode] = useState(false)
  const [newFirstName, setNewFirstName] = useState("")
  const [newLastName, setNewLastName] = useState("")
  const [dates, setDates] = useState<DateRange | undefined>()
  const [roomTypeId, setRoomTypeId] = useState("")
  const [roomId, setRoomId] = useState("")
  const [ratePlanId, setRatePlanId] = useState("")
  const [adults, setAdults] = useState("1")
  const [children, setChildren] = useState("0")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const start = initial?.checkInDate ? startOfDay(new Date(initial.checkInDate)) : startOfDay(new Date())
    setDates({ from: start, to: addDays(start, 1) })
    setGuestId("")
    setNewGuestMode(false)
    setNewFirstName("")
    setNewLastName("")
    setRoomTypeId(initial?.roomTypeId ?? "")
    setRoomId(initial?.roomId ?? "")
    setRatePlanId("")
    setAdults("1")
    setChildren("0")
    setError(null)

    fetch(`/api/profiles?profileType=GUEST`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setProfiles(d) })
      .catch(console.error)
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRoomTypes(d.filter((rt: any) => rt.isActive !== false && !rt.isPseudo)) })
      .catch(console.error)
    fetch(`/api/rate-plans?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRatePlans(d.filter((rp: any) => rp.isActive !== false)) })
      .catch(console.error)
  }, [isOpen, propertyId])

  // Available rooms refresh whenever the room type or dates change.
  useEffect(() => {
    if (!isOpen || !roomTypeId || !dates?.from || !dates?.to) { setAvailableRooms([]); return }
    const params = new URLSearchParams({
      propertyId,
      roomTypeId,
      checkInDate: toIsoDate(dates.from),
      checkOutDate: toIsoDate(dates.to),
    })
    fetch(`/api/rooms/available?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setAvailableRooms(d)
          setRoomId((prev) => (d.some((room: any) => room.id === prev) ? prev : ""))
        }
      })
      .catch(console.error)
  }, [isOpen, roomTypeId, dates?.from?.getTime(), dates?.to?.getTime()])

  const guestOptions = useMemo(
    () =>
      profiles.map((p) => ({
        label: `${p.firstName} ${p.lastName ?? ""}`.trim(),
        value: p.upid,
      })),
    [profiles]
  )

  const handleSubmit = async () => {
    if (!dates?.from || !dates?.to) { setError("Pick the stay dates."); return }
    if (!newGuestMode && !guestId) { setError("Select a guest or create a new one."); return }
    if (newGuestMode && !newFirstName.trim()) { setError("Enter the guest's first name."); return }
    if (!roomTypeId) { setError("Select a room type."); return }
    if (!roomId) { setError("Select an available room."); return }
    if (!ratePlanId) { setError("Select a rate plan."); return }

    setSubmitting(true)
    setError(null)
    try {
      // 1. Quick-create the guest profile if needed.
      let primaryGuestId = guestId
      if (newGuestMode) {
        const profileRes = await fetch(`/api/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileType: "GUEST",
            firstName: newFirstName.trim(),
            lastName: newLastName.trim() || null,
            originPropertyId: propertyId,
          }),
        })
        const profileData = await profileRes.json()
        if (!profileRes.ok) {
          setError(profileData.error || "Failed to create the guest profile.")
          return
        }
        primaryGuestId = profileData.upid
      }

      // 2. Create the reservation (single segment, room pre-picked).
      const resRes = await fetch(`/api/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          primaryGuestId,
          checkInDate: toIsoDate(dates.from),
          checkOutDate: toIsoDate(dates.to),
          adults: parseInt(adults) || 1,
          children: parseInt(children) || 0,
          roomTypeId,
          roomId,
          ratePlanId,
        }),
      })
      const resData = await resRes.json()
      if (!resRes.ok) {
        setError(resData.error || "Failed to create the reservation.")
        return
      }

      if (mode === "book") {
        onClose()
        onDone({
          title: "Booking Created",
          message:
            `${resData.confirmationNo} booked.` +
            (resData.capacityWarning ? ` ${resData.capacityWarning}` : ""),
        })
        return
      }

      // 3. Immediate check-in — that's the point of a walk-in.
      const checkIn = await fetch(`/api/reservations/${resData.id}/check-in`, { method: "POST" })
      const checkInData = await checkIn.json()

      onClose()
      if (checkIn.ok) {
        onDone({
          title: "Walk-in Checked In",
          message:
            `${resData.confirmationNo} created and checked in.` +
            (checkInData.roomWarning ? ` Warning: ${checkInData.roomWarning}` : "") +
            (resData.capacityWarning ? ` ${resData.capacityWarning}` : ""),
        })
      } else {
        onDone({
          title: "Booked, Check-in Failed",
          message: `${resData.confirmationNo} was created but check-in failed: ${checkInData.error || "unknown error"}. Check them in from the arrivals list.`,
          isError: true,
        })
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "book" ? "Quick Booking" : "Walk-in Booking"}</DialogTitle>
          <DialogDescription>
            {mode === "book"
              ? "Create a booking for the selected room and dates."
              : "Create a booking and check the guest straight in."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Guest</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setNewGuestMode(!newGuestMode); setError(null) }}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" />
                {newGuestMode ? "Pick existing guest" : "New guest"}
              </Button>
            </div>
            {newGuestMode ? (
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="First name" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} />
                <Input placeholder="Last name" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} />
              </div>
            ) : (
              <SearchableSelect
                value={guestId}
                onChange={(v: string) => setGuestId(v)}
                placeholder="Select guest..."
                options={guestOptions}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Stay Dates</Label>
            <DateRangePicker value={dates} onChange={setDates} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Room Type</Label>
              <SearchableSelect
                value={roomTypeId}
                onChange={(v: string) => { setRoomTypeId(v); setRoomId("") }}
                placeholder="Room type..."
                options={roomTypes.map((rt) => ({ label: rt.name, value: rt.id }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Room</Label>
              <SearchableSelect
                value={roomId}
                onChange={(v: string) => setRoomId(v)}
                placeholder={roomTypeId ? (availableRooms.length ? "Select room..." : "No rooms available") : "Pick a type first"}
                options={availableRooms.map((r) => ({
                  label: `${r.roomNumber} — ${r.status.replace(/_/g, " ").toLowerCase()}`,
                  value: r.id,
                }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2 col-span-1">
              <Label>Rate Plan</Label>
              <SearchableSelect
                value={ratePlanId}
                onChange={(v: string) => setRatePlanId(v)}
                placeholder="Rate..."
                options={ratePlans.map((rp) => ({ label: `${rp.code} — ${rp.name}`, value: rp.id }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Adults</Label>
              <Input type="number" min="1" value={adults} onChange={(e) => setAdults(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Children</Label>
              <Input type="number" min="0" value={children} onChange={(e) => setChildren(e.target.value)} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "book" ? "Create Booking" : "Book & Check In"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
