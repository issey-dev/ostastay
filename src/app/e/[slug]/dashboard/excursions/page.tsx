"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { format } from "date-fns"
import { useProperty } from "@/components/providers/property-provider"
import { CalendarClock, CalendarDays, Search, UserRound, Receipt, ClipboardList } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"
import { ErrorState } from "@/components/ui/error-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { ExcursionManifestPanel } from "@/components/front-office/excursion-manifest-panel"
import { ExcursionCalendar } from "@/components/front-office/excursion-calendar"
import { SalesHistory, type SalesRow } from "@/components/front-office/sales-history"
import { InHousePaymentChoice, type InHousePayment } from "@/components/front-office/in-house-payment-choice"

type GuestResult = {
  reservationId: string
  guestName: string
  roomNumber: string
  status: string
  folioId: string | null
}

type Departure = {
  id: string
  excursionTypeId: string
  excursionType: { id: string; code: string; name: string; pricingMode: string; cutoffHours: number }
  departureDate: string
  departureTime: string
  meetingTime: string | null
  meetingPoint: string | null
  capacity: number
  minCapacity: number | null
  bookedHeadcount: number
}

type OpenWalkInBooking = {
  id: string
  walkInGuestName: string | null
  folioId: string
  departure: { departureDate: string; departureTime: string }
}

// Front Office's Excursions booking screen. In-house: search a guest by room number
// (identical query shape to /api/pos/search). Walk-in: open a bare walk-in folio first
// (/api/folios/walk-in, same as POS), then book against it — pay-now/pay-later/close is
// handled entirely by reusing WalkInFolioPanel rather than building a second payment UI,
// same component POS already uses for its own walk-in bills. See
// .agents/docs/EXCURSIONS_PLAN.md Phase 3.
export default function ExcursionsPage() {
  const { currentProperty } = useProperty()

  const [mode, setMode] = useState<"guest" | "walkin">("guest")

  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<GuestResult[]>([])
  const [selectedGuest, setSelectedGuest] = useState<GuestResult | null>(null)
  const [loadingSearch, setLoadingSearch] = useState(false)

  const [walkInForm, setWalkInForm] = useState({ name: "", contact: "" })
  const [startingWalkIn, setStartingWalkIn] = useState(false)
  const [walkInFolioId, setWalkInFolioId] = useState<string | null>(null)
  const [isWalkInPanelOpen, setIsWalkInPanelOpen] = useState(false)

  const [_openWalkIns, setOpenWalkIns] = useState<OpenWalkInBooking[]>([])

  const [departures, setDepartures] = useState<Departure[]>([])
  const [loadingDepartures, setLoadingDepartures] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [selectedExcursionTypeId, setSelectedExcursionTypeId] = useState("")
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedDepartureId, setSelectedDepartureId] = useState<string>("")

  const [counts, setCounts] = useState({ adultCount: "1", childCount: "0", infantCount: "0" })
  const [notes, setNotes] = useState("")
  const [inHousePayment, setInHousePayment] = useState<InHousePayment>({ settleNow: false, paymentMethodId: "" })
  const [booking, setBooking] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const [manifestDepartureId, setManifestDepartureId] = useState<string | null>(null)
  const { slug } = useParams<{ slug: string }>()
  const [pageTab, setPageTab] = useState<"book" | "schedule" | "history">("book")
  const [historyRefresh, setHistoryRefresh] = useState(0)

  const loadHistory = useCallback(async (date: string | null): Promise<SalesRow[]> => {
    if (!currentProperty) return []
    const qs = new URLSearchParams({ propertyId: currentProperty.id, history: "true" })
    if (date) { qs.set("from", date); qs.set("to", date) }
    const res = await fetch(`/api/excursions/bookings?${qs}`)
    const data = await res.json()
    return (Array.isArray(data) ? data : []).map((b: any): SalesRow => ({
      id: b.id,
      date: b.departure.departureDate,
      time: b.departure.departureTime,
      guest: b.reservation ? `${b.reservation.primaryGuest.firstName} ${b.reservation.primaryGuest.lastName ?? ""}`.trim() : (b.walkInGuestName ?? "Walk-in"),
      item: b.departure.excursionType.name,
      amount: b.totalAmount,
      status: b.status,
      source: b.reservationId ? "guest" : "walkin",
      folioId: b.folio?.id ?? null,
      folioClosed: b.folio?.isClosed,
      taxInvoiceNumber: b.folio?.taxInvoiceNumber,
    }))
  }, [currentProperty])

  const fetchDepartures = useCallback(() => {
    if (!currentProperty) return
    setLoadingDepartures(true)
    setLoadError(false)
    fetch(`/api/excursions/departures?propertyId=${currentProperty.id}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data) => { if (Array.isArray(data)) setDepartures(data) })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingDepartures(false))
  }, [currentProperty])

  const fetchOpenWalkIns = useCallback(() => {
    if (!currentProperty) return
    fetch(`/api/excursions/bookings?propertyId=${currentProperty.id}`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setOpenWalkIns(data) })
      .catch(console.error)
  }, [currentProperty])

  useEffect(() => { fetchDepartures() }, [fetchDepartures])
  useEffect(() => { fetchOpenWalkIns() }, [fetchOpenWalkIns])

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

  const handleStartWalkIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty || !walkInForm.name) return
    setStartingWalkIn(true)
    try {
      const res = await fetch(`/api/folios/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, walkInGuestName: walkInForm.name, walkInGuestContact: walkInForm.contact }),
      })
      if (res.ok) {
        const folio = await res.json()
        setWalkInFolioId(folio.id)
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to start walk-in bill", type: "error" })
      }
    } finally {
      setStartingWalkIn(false)
    }
  }

  // Excursion -> date -> time-slot drill-down: excursions and their available dates are
  // both derived from the already-loaded departures list, no extra fetch needed. Map
  // preserves insertion order, and the API already sorts by date/time asc, so both lists
  // come out chronologically without an explicit sort here.
  const excursionOptions = Array.from(
    new Map(departures.map((d) => [d.excursionTypeId, d.excursionType])).values()
  )
  const availableDates = selectedExcursionTypeId
    ? Array.from(
        new Set(
          departures
            .filter((d) => d.excursionTypeId === selectedExcursionTypeId)
            .map((d) => format(new Date(d.departureDate), "yyyy-MM-dd"))
        )
      )
    : []
  const slotsForDate =
    selectedExcursionTypeId && selectedDate
      ? departures.filter(
          (d) =>
            d.excursionTypeId === selectedExcursionTypeId &&
            format(new Date(d.departureDate), "yyyy-MM-dd") === selectedDate
        )
      : []
  // Most days only run one departure per excursion, so skip the extra click and treat it
  // as chosen automatically; only fall back to an explicit picker when a day has more than one.
  const effectiveDepartureId = selectedDepartureId || (slotsForDate.length === 1 ? slotsForDate[0].id : "")
  const selectedDeparture = departures.find((d) => d.id === effectiveDepartureId) ?? null
  const canBook = (mode === "guest" ? !!selectedGuest : !!walkInFolioId) &&
    (mode !== "guest" || !inHousePayment.settleNow || !!inHousePayment.paymentMethodId)

  const handleExcursionTypeChange = (value: string | null) => {
    setSelectedExcursionTypeId(value ?? "")
    setSelectedDate("")
    setSelectedDepartureId("")
  }

  const handleDateChange = (value: string) => {
    setSelectedDate(value)
    setSelectedDepartureId("")
  }

  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canBook || !selectedDeparture) return
    setBooking(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/excursions/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departureId: selectedDeparture.id,
          ...(mode === "guest" ? { reservationId: selectedGuest!.reservationId } : { folioId: walkInFolioId }),
          adultCount: counts.adultCount,
          childCount: counts.childCount,
          infantCount: counts.infantCount,
          notes: notes || undefined,
          settlement: mode === "guest" && inHousePayment.settleNow && inHousePayment.paymentMethodId
            ? { paymentMethodId: inHousePayment.paymentMethodId }
            : undefined,
        }),
      })
      if (res.ok) {
        const label = mode === "guest" ? `Room ${selectedGuest!.roomNumber}` : walkInForm.name
        const settled = mode === "guest" && inHousePayment.settleNow && inHousePayment.paymentMethodId
        setFeedback({ message: `Booked for ${label} — ${selectedDeparture.excursionType.name}${settled ? " — paid" : ""}.`, type: "success" })
        setCounts({ adultCount: "1", childCount: "0", infantCount: "0" })
        setNotes("")
        setInHousePayment({ settleNow: false, paymentMethodId: "" })
        fetchDepartures()
        setHistoryRefresh((n) => n + 1)
        if (mode === "walkin") {
          fetchOpenWalkIns()
          setIsWalkInPanelOpen(true) // let staff take payment or leave the bill open right away
        }
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to book excursion", type: "error" })
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
        <h2 className="text-3xl font-bold tracking-tight">Excursions</h2>
        <p className="text-muted-foreground">Search for an in-house guest, or start a walk-in bill, then book them onto an upcoming excursion.</p>
      </div>

      <Tabs value={pageTab} onValueChange={(v) => setPageTab((v as "book" | "schedule" | "history") ?? "book")}>
        <TabsList>
          <TabsTrigger value="book"><CalendarClock className="w-4 h-4 mr-2" /> Book</TabsTrigger>
          <TabsTrigger value="schedule"><CalendarDays className="w-4 h-4 mr-2" /> Schedule</TabsTrigger>
          <TabsTrigger value="history"><ClipboardList className="w-4 h-4 mr-2" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="book" className="m-0">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Left: guest search / walk-in */}
        <div className="flex-1 space-y-6">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                {mode === "guest" ? <Search className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}
                {mode === "guest" ? "Find Guest" : "Walk-in Guest"}
              </h3>
              <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                <button
                  type="button"
                  className={`px-3 py-1.5 ${mode === "guest" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => { setMode("guest"); setWalkInFolioId(null) }}
                >
                  Guest
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 ${mode === "walkin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => { setMode("walkin"); setSelectedGuest(null) }}
                >
                  Walk-in
                </button>
              </div>
            </div>

            {mode === "guest" ? (
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
                  <div className="mt-4 border rounded-lg overflow-hidden divide-y">
                    {guests.map((g) => (
                      <div
                        key={g.reservationId}
                        className={`p-4 flex justify-between items-center cursor-pointer transition-colors ${selectedGuest?.reservationId === g.reservationId ? "bg-muted border-l-4 border-primary" : "hover:bg-muted"}`}
                        onClick={() => setSelectedGuest(g)}
                      >
                        <div>
                          <p className="font-bold text-foreground">{g.guestName}</p>
                          <p className="text-sm text-muted-foreground">Room {g.roomNumber}</p>
                        </div>
                        <StatusBadge label={g.status} status={g.status} />
                      </div>
                    ))}
                  </div>
                )}
                {searchQuery && guests.length === 0 && !loadingSearch && (
                  <p className="text-sm text-muted-foreground mt-4 text-center">No active guests found matching &quot;{searchQuery}&quot;</p>
                )}
              </>
            ) : walkInFolioId ? (
              <div className="flex items-center justify-between bg-muted rounded-lg p-4">
                <div>
                  <p className="font-bold text-foreground">{walkInForm.name}</p>
                  <p className="text-sm text-muted-foreground">Walk-in bill open</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setIsWalkInPanelOpen(true)}>
                  <Receipt className="w-4 h-4 mr-2" /> View / Close Bill
                </Button>
              </div>
            ) : (
              <form onSubmit={handleStartWalkIn} className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Guest name"
                  required
                  value={walkInForm.name}
                  onChange={(e) => setWalkInForm((p) => ({ ...p, name: e.target.value }))}
                />
                <Input
                  placeholder="Phone / email (optional)"
                  value={walkInForm.contact}
                  onChange={(e) => setWalkInForm((p) => ({ ...p, contact: e.target.value }))}
                />
                <Button type="submit" className="col-span-2" disabled={startingWalkIn || !walkInForm.name}>
                  {startingWalkIn ? "Starting..." : "Start Walk-in Bill"}
                </Button>
              </form>
            )}
          </div>

          {/* Booking form */}
          <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!canBook ? "opacity-50 pointer-events-none border-border" : "border-border shadow-md ring-1 ring-border"}`}>
            <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-primary" />
              {mode === "guest" && selectedGuest ? `Book Excursion for Room ${selectedGuest.roomNumber}` : mode === "walkin" && walkInFolioId ? `Book Excursion for ${walkInForm.name}` : "Book Excursion"}
            </h3>
            <form onSubmit={handleBook} className="space-y-4">
              <div className="space-y-3">
                {loadError ? (
                  <ErrorState title="Couldn't load excursions" onRetry={fetchDepartures} />
                ) : departures.length === 0 && !loadingDepartures ? (
                  <p className="text-sm text-muted-foreground">No upcoming departures — set some up in Controls &gt; Excursions.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Excursion</Label>
                      <Select value={selectedExcursionTypeId} onValueChange={handleExcursionTypeChange} disabled={loadingDepartures}>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {selectedExcursionTypeId
                              ? excursionOptions.find((et) => et.id === selectedExcursionTypeId)?.name
                              : loadingDepartures
                                ? "Loading..."
                                : "Choose excursion..."}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {excursionOptions.map((et) => (
                            <SelectItem key={et.id} value={et.id}>{et.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <DatePicker
                        value={selectedDate}
                        onChange={handleDateChange}
                        availableDates={availableDates}
                        disabled={!selectedExcursionTypeId}
                        placeholder="Choose date..."
                      />
                    </div>
                  </div>
                )}

                {selectedExcursionTypeId && selectedDate && slotsForDate.length === 0 && (
                  <p className="text-sm text-muted-foreground">No departure available on this date.</p>
                )}

                {selectedExcursionTypeId && selectedDate && slotsForDate.length > 1 && !selectedDeparture && (
                  <div className="space-y-2">
                    <Label>Time</Label>
                    <div className="border rounded-lg divide-y">
                      {slotsForDate.map((d) => {
                        const overCapacity = d.bookedHeadcount >= d.capacity
                        return (
                          <div
                            key={d.id}
                            className="p-3 cursor-pointer hover:bg-muted transition-colors flex justify-between items-center"
                            onClick={() => setSelectedDepartureId(d.id)}
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">{d.departureTime}</p>
                              {d.meetingPoint && (
                                <p className="text-xs text-muted-foreground">Meet at {d.meetingPoint}{d.meetingTime ? ` (${d.meetingTime})` : ""}</p>
                              )}
                            </div>
                            <Badge variant="outline" className={overCapacity ? "bg-warning-muted text-warning border-warning/30" : ""}>
                              {d.bookedHeadcount}/{d.capacity}
                            </Badge>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {selectedDeparture && (
                  <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-muted p-3">
                    <div>
                      <p className="font-medium text-sm text-foreground">{selectedDeparture.excursionType.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(selectedDeparture.departureDate).toLocaleDateString([], { dateStyle: "medium" })} at {selectedDeparture.departureTime}
                        {selectedDeparture.meetingPoint && ` · Meet at ${selectedDeparture.meetingPoint}${selectedDeparture.meetingTime ? ` (${selectedDeparture.meetingTime})` : ""}`}
                      </p>
                      {selectedDeparture.minCapacity != null && selectedDeparture.bookedHeadcount < selectedDeparture.minCapacity && (
                        <p className="text-[10px] text-warning mt-1">At risk of not running</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={selectedDeparture.bookedHeadcount >= selectedDeparture.capacity ? "bg-warning-muted text-warning border-warning/30" : ""}>
                        {selectedDeparture.bookedHeadcount}/{selectedDeparture.capacity}
                      </Badge>
                      {slotsForDate.length > 1 && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDepartureId("")}>
                          Change
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="View manifest"
                        onClick={() => setManifestDepartureId(selectedDeparture.id)}
                      >
                        <ClipboardList className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Adults</Label>
                  <Input type="number" min="0" value={counts.adultCount} onChange={(e) => setCounts((p) => ({ ...p, adultCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Children</Label>
                  <Input type="number" min="0" value={counts.childCount} onChange={(e) => setCounts((p) => ({ ...p, childCount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Infants</Label>
                  <Input type="number" min="0" value={counts.infantCount} onChange={(e) => setCounts((p) => ({ ...p, infantCount: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input placeholder="e.g. Non-swimmer, needs a life vest" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {mode === "guest" && selectedGuest && (
                <InHousePaymentChoice value={inHousePayment} onChange={setInHousePayment} />
              )}

              {feedback && (
                <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}`}>
                  {feedback.message}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={booking || !canBook || !selectedDeparture}>
                {booking ? "Booking..." : "Book Excursion"}
              </Button>
            </form>
          </div>
        </div>

      </div>
        </TabsContent>

        <TabsContent value="schedule" className="m-0">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            {currentProperty && (
              <ExcursionCalendar propertyId={currentProperty.id} onSelectDeparture={(id) => setManifestDepartureId(id)} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="m-0">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <SalesHistory
              slug={slug}
              refreshKey={historyRefresh}
              load={loadHistory}
              onOpenWalkInBill={(id) => { setWalkInFolioId(id); setIsWalkInPanelOpen(true) }}
            />
          </div>
        </TabsContent>
      </Tabs>

      <WalkInFolioPanel
        folioId={walkInFolioId}
        isOpen={isWalkInPanelOpen}
        onClose={() => { setIsWalkInPanelOpen(false); setHistoryRefresh((n) => n + 1) }}
        onClosed={() => {
          setIsWalkInPanelOpen(false)
          setWalkInFolioId(null)
          setWalkInForm({ name: "", contact: "" })
          setMode("guest")
          fetchOpenWalkIns()
          setHistoryRefresh((n) => n + 1)
        }}
      />

      <ExcursionManifestPanel
        departureId={manifestDepartureId}
        isOpen={!!manifestDepartureId}
        onClose={() => { setManifestDepartureId(null); fetchDepartures() }}
      />
    </div>
  )
}
