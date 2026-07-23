"use client"

import { useState, useEffect, useCallback } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Sparkles, Clock, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"

type GuestResult = {
  reservationId: string
  guestName: string
  roomNumber: string
  status: string
  folioId: string | null
}

type ParticipantSlot = GuestResult | null

type Treatment = {
  id: string
  name: string
  category: { id: string; name: string }
  defaultDurationMinutes: number
  maxParticipants: number
  allowInHouseGuest: boolean
  isActive: boolean
}

type SlotAvailability = { startTime: string; available: boolean }

type AppointmentListItem = {
  id: string
  startTime: string
  treatmentEndTime: string
  appointmentStatus: string
  paymentStatus: string
  partySize: number
  treatment: { id: string; name: string }
  room: { id: string; name: string } | null
  participants: {
    reservation: { primaryGuest: { firstName: string; lastName: string | null }; assignments: { room: { roomNumber: string } }[] } | null
    therapist: { id: string; displayName: string } | null
  }[]
}

// Front Office's Spa booking screen — in-house guests only for now (walk-in is
// Phase 3, matching how Excursions' own booking page was in-house-only in its
// Phase 2). Auto-assignment only in this first UI pass — manual therapist/room
// picking is supported by the API already but not yet exposed here; that's a
// deliberate UI scope cut for Phase 2, not a limitation of the booking engine.
export default function SpaPage() {
  const { currentProperty } = useProperty()

  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [selectedTreatmentId, setSelectedTreatmentId] = useState("")
  const selectedTreatment = treatments.find((t) => t.id === selectedTreatmentId) ?? null

  const [partySize, setPartySize] = useState(1)
  const [participants, setParticipants] = useState<ParticipantSlot[]>([null])
  const [activeSlot, setActiveSlot] = useState<number | null>(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<GuestResult[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)

  const [selectedDate, setSelectedDate] = useState("")
  const [slots, setSlots] = useState<SlotAvailability[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedStartTime, setSelectedStartTime] = useState("")
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState("")

  const [notes, setNotes] = useState("")
  const [booking, setBooking] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const [todaysAppointments, setTodaysAppointments] = useState<AppointmentListItem[]>([])
  const [loadingAppointments, setLoadingAppointments] = useState(true)

  useEffect(() => {
    if (!currentProperty) return
    fetch(`/api/spa/treatments?propertyId=${currentProperty.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTreatments(data.filter((t: Treatment) => t.isActive && t.allowInHouseGuest))
      })
  }, [currentProperty])

  const fetchTodaysAppointments = useCallback(() => {
    if (!currentProperty) return
    const date = selectedDate || new Date().toISOString().slice(0, 10)
    setLoadingAppointments(true)
    fetch(`/api/spa/appointments?propertyId=${currentProperty.id}&date=${date}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTodaysAppointments(data) })
      .finally(() => setLoadingAppointments(false))
  }, [currentProperty, selectedDate])

  useEffect(() => { fetchTodaysAppointments() }, [fetchTodaysAppointments])

  // Reset party-size-dependent state whenever the treatment changes.
  const handleTreatmentChange = (value: string | null) => {
    setSelectedTreatmentId(value ?? "")
    setPartySize(1)
    setParticipants([null])
    setActiveSlot(0)
    setSelectedStartTime("")
    setSlots([])
  }

  const handlePartySizeChange = (value: string | null) => {
    const size = parseInt(value ?? "1")
    setPartySize(size)
    setParticipants((prev) => {
      const next = [...prev]
      while (next.length < size) next.push(null)
      return next.slice(0, size)
    })
    setSelectedStartTime("")
    setSlots([])
  }

  // Fetch server-computed slots whenever treatment/date/partySize changes — never
  // trust a client-cached list (SPA_PLAN.md §7). The booking submit re-validates the
  // exact same way server-side regardless.
  useEffect(() => {
    if (!currentProperty || !selectedTreatmentId || !selectedDate) {
      setSlots([])
      setPrice(null)
      return
    }
    setLoadingSlots(true)
    setSelectedStartTime("")
    fetch(`/api/spa/appointments/availability?propertyId=${currentProperty.id}&treatmentId=${selectedTreatmentId}&date=${selectedDate}&partySize=${partySize}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.slots)) setSlots(data.slots)
        setPrice(typeof data.price === "number" ? data.price : null)
        setCurrency(data.currency || "")
      })
      .finally(() => setLoadingSlots(false))
  }, [currentProperty, selectedTreatmentId, selectedDate, partySize])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty || !searchQuery) return
    setLoadingSearch(true)
    try {
      const res = await fetch(`/api/pos/search?propertyId=${currentProperty.id}&query=${encodeURIComponent(searchQuery)}`)
      const data = await res.json()
      if (Array.isArray(data)) setGuests(data)
    } finally {
      setLoadingSearch(false)
    }
  }

  const selectGuestForSlot = (guest: GuestResult) => {
    if (activeSlot === null) return
    setParticipants((prev) => {
      const next = [...prev]
      next[activeSlot] = guest
      return next
    })
    setSearchQuery("")
    setGuests([])
    // Advance to the next empty slot, if any.
    const nextEmpty = participants.findIndex((p, i) => i !== activeSlot && !p)
    setActiveSlot(nextEmpty >= 0 ? nextEmpty : null)
  }

  const clearSlot = (index: number) => {
    setParticipants((prev) => {
      const next = [...prev]
      next[index] = null
      return next
    })
    setActiveSlot(index)
  }

  const canBook = participants.length === partySize && participants.every((p) => !!p) && !!selectedStartTime

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty || !canBook || !selectedTreatment) return
    setBooking(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/spa/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          treatmentId: selectedTreatmentId,
          appointmentDate: selectedDate,
          startTime: selectedStartTime,
          participants: participants.map((p) => ({ reservationId: p!.reservationId })),
          notes: notes || undefined,
        }),
      })
      if (res.ok) {
        setFeedback({ message: `Booked ${selectedTreatment.name} at ${selectedStartTime}.`, type: "success" })
        setParticipants(Array(partySize).fill(null))
        setActiveSlot(0)
        setSelectedStartTime("")
        setNotes("")
        fetchTodaysAppointments()
      } else {
        const err = await res.json().catch(() => null)
        setFeedback({ message: err?.error || "Failed to book appointment", type: "error" })
      }
    } catch {
      setFeedback({ message: "An unexpected error occurred.", type: "error" })
    } finally {
      setBooking(false)
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Spa</h2>
        <p className="text-muted-foreground">Search for in-house guests, choose a treatment and time, then confirm the appointment.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Left: booking form */}
        <div className="flex-1 space-y-6">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" /> Treatment
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Treatment</Label>
                <Select value={selectedTreatmentId} onValueChange={handleTreatmentChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{selectedTreatment ? selectedTreatment.name : "Choose treatment..."}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {treatments.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name} ({t.defaultDurationMinutes} min)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTreatment && selectedTreatment.maxParticipants > 1 && (
                <div className="space-y-2">
                  <Label>Party Size</Label>
                  <Select value={String(partySize)} onValueChange={handlePartySizeChange}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: selectedTreatment.maxParticipants }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "guest" : "guests"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {selectedTreatmentId && (
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-primary" /> Guest{partySize > 1 ? "s" : ""}
              </h3>
              <div className="space-y-2 mb-4">
                {participants.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    {p ? (
                      <>
                        <div>
                          <p className="font-medium text-sm text-foreground">{p.guestName}</p>
                          <p className="text-xs text-muted-foreground">Room {p.roomNumber}</p>
                        </div>
                        <Button type="button" size="icon" variant="ghost" onClick={() => clearSlot(i)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`w-full text-left text-sm ${activeSlot === i ? "text-primary font-medium" : "text-muted-foreground"}`}
                        onClick={() => setActiveSlot(i)}
                      >
                        {partySize > 1 ? `Guest ${i + 1} — click to search` : "Search for a guest..."}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {activeSlot !== null && (
                <>
                  <form onSubmit={handleSearch} className="flex gap-3">
                    <Input
                      placeholder="Search by Room Number or Last Name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1"
                    />
                    <Button type="submit" disabled={loadingSearch || !searchQuery}>
                      {loadingSearch ? "Searching..." : "Search"}
                    </Button>
                  </form>
                  {guests.length > 0 && (
                    <div className="mt-3 border rounded-lg overflow-hidden divide-y">
                      {guests.map((g) => (
                        <div
                          key={g.reservationId}
                          className="p-3 flex justify-between items-center cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => selectGuestForSlot(g)}
                        >
                          <div>
                            <p className="font-medium text-sm text-foreground">{g.guestName}</p>
                            <p className="text-xs text-muted-foreground">Room {g.roomNumber}</p>
                          </div>
                          <StatusBadge label={g.status} status={g.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {selectedTreatmentId && (
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-primary" /> Date &amp; Time
              </h3>
              <div className="space-y-4">
                <div className="space-y-2 max-w-[240px]">
                  <Label>Date</Label>
                  <DatePicker value={selectedDate} onChange={setSelectedDate} placeholder="Choose date..." />
                </div>

                {selectedDate && (
                  loadingSlots ? (
                    <p className="text-sm text-muted-foreground">Checking availability...</p>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No time slots available on this date.</p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {slots.map((s) => (
                        <button
                          key={s.startTime}
                          type="button"
                          disabled={!s.available}
                          onClick={() => setSelectedStartTime(s.startTime)}
                          className={`px-2 py-1.5 rounded-md text-sm border transition-colors ${
                            !s.available
                              ? "opacity-40 cursor-not-allowed border-border text-muted-foreground"
                              : selectedStartTime === s.startTime
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:bg-muted text-foreground"
                          }`}
                        >
                          {s.startTime}
                        </button>
                      ))}
                    </div>
                  )
                )}

                {price !== null && (
                  <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                    <span className="text-sm text-muted-foreground">Price</span>
                    <span className="font-mono font-medium text-foreground">{currency} {price.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedTreatmentId && (
            <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!canBook ? "opacity-60" : "border-primary/30 shadow-md"}`}>
              <form onSubmit={handleBook} className="space-y-4">
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Input placeholder="e.g. Prefers firm pressure" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                {feedback && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}`}>
                    {feedback.message}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={booking || !canBook}>
                  {booking ? "Booking..." : "Book Appointment"}
                </Button>
              </form>
            </div>
          )}
        </div>

        {/* Right: today's schedule */}
        <div className="w-full md:w-80 space-y-6">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-primary" /> {selectedDate ? "Schedule" : "Today's Schedule"}
          </h3>
          {!loadingAppointments && todaysAppointments.length === 0 ? (
            <EmptyState icon={Sparkles} title="No appointments" description="Nothing booked for this date yet." />
          ) : (
            <div className="space-y-3">
              {todaysAppointments.map((a) => (
                <div key={a.id} className="bg-card p-3 rounded-lg shadow-sm border border-border">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm text-foreground">{a.treatment.name}</p>
                    <StatusBadge label={a.appointmentStatus} status={a.appointmentStatus} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.startTime}–{a.treatmentEndTime} · {a.room?.name ?? "No room"}</p>
                  <div className="mt-2 space-y-1">
                    {a.participants.map((p, i) => (
                      <p key={i} className="text-xs text-foreground">
                        {p.reservation ? `${p.reservation.primaryGuest.firstName} ${p.reservation.primaryGuest.lastName ?? ""}`.trim() : "Guest"}
                        {p.therapist && <span className="text-muted-foreground"> — {p.therapist.displayName}</span>}
                      </p>
                    ))}
                  </div>
                  <div className="mt-1">
                    <Badge variant="outline" className="text-[10px]">{a.paymentStatus.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
