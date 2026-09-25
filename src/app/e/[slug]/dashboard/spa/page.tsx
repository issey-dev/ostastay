"use client"

import { toDateKey, todayKey } from "@/lib/date-only"
import { Suspense, useState, useEffect, useCallback } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useUrlState } from "@/lib/use-url-state"
import { useProperty } from "@/components/providers/property-provider"
import { useParams } from "next/navigation"
import { Sparkles, Clock, Users, X, Receipt, UserRound, Search, Calendar, ClipboardList } from "@/components/icons"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SpaSchedule } from "@/components/front-office/spa-schedule"
import { SpaAppointmentSheet } from "@/components/front-office/spa-appointment-sheet"
import { SalesHistory, type SalesRow } from "@/components/front-office/sales-history"
import { InHousePaymentChoice } from "@/components/front-office/in-house-payment-choice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumberStepper } from "@/components/ui/number-stepper"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SubmitButton } from "@/components/ui/submit-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { StatusBadge } from "@/components/ui/status-badge"
import { ErrorState } from "@/components/ui/error-state"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { MobileActionBar } from "@/components/ui/mobile"
import { useIsMobile } from "@/hooks/use-mobile"
import { PageHeader } from "@/components/ui/page-header"
import {
  emptySpaBooking,
  emptySpaParticipantSlot,
  emptyWalkInGuest,
  spaBookingSchemaFor,
  walkInGuestSchema,
  type SpaBookingValues,
  type SpaGenderChoice,
  type SpaParticipantValue,
  type WalkInGuestValues,
} from "@/lib/sales-form-schemas"

type GuestResult = {
  reservationId: string
  guestName: string
  roomNumber: string
  status: string
  folioId: string | null
  profileId: string
  accompanyingGuests: { upid: string; guestName: string }[]
}

// Participant 1 (the billing anchor) is either an in-house reservation or the
// already-open walk-in folio; any additional participant (a couple/group
// treatment's companion) is either another reservation or a plain name — never
// billed separately, so a companion never needs a folio of their own (SPA_PLAN.md
// §4 / the appointments route's own header comment).
//
// A companion sharing the SAME reservation as participant 1 (the couple-in-one-room
// case) is deliberately represented as "walkin_companion" (free text), not a second
// "reservation" entry pointing at the same reservationId — SpaAppointmentParticipant
// only has one reservation relation per row, resolved via `reservation.primaryGuest`,
// so a second participant referencing that same reservationId would display as the
// SAME primary guest's name, not the actual companion. Free text sidesteps that
// display bug entirely; the real name still shows correctly, it just isn't linked to
// a Profile for this booking.
//
// Each slot (SpaParticipantSlot in sales-form-schemas) bundles the guest identity PLUS
// its own therapist ask — together, not parallel arrays, so every place that touches a
// participant only has one thing to read/update. specificTherapistId and genderChoice
// are mutually exclusive by construction (see setSlotGender/setSlotTherapist below):
// picking one always clears the other, since a named request makes a gender filter moot.
type ParticipantValue = SpaParticipantValue
type GenderChoice = SpaGenderChoice
const emptySlot = emptySpaParticipantSlot

type QualifiedTherapist = { id: string; displayName: string; gender: string | null; preferred: boolean; isPreferredForGuest: boolean }

type Treatment = {
  id: string
  name: string
  category: { id: string; name: string }
  defaultDurationMinutes: number
  maxParticipants: number
  allowInHouseGuest: boolean
  allowWalkIn: boolean
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
  folioId: string | null
  treatment: { id: string; name: string }
  room: { id: string; name: string } | null
  participants: {
    reservation: { primaryGuest: { firstName: string; lastName: string | null }; assignments: { room: { roomNumber: string } }[] } | null
    walkInGuestName: string | null
    therapist: { id: string; displayName: string } | null
  }[]
}

// Front Office's Spa booking screen. In-house: search a guest by room number
// (identical query shape to /api/pos/search, same as Excursions). Walk-in: open a
// bare walk-in folio first (/api/folios/walk-in, same as POS/Excursions), then book
// against it — pay-now/pay-later/close is handled entirely by reusing
// WalkInFolioPanel rather than building a second payment UI.
//
// Therapist-first booking: each participant can carry its own request (a specific
// qualified therapist, or a hard gender filter) BEFORE a date is even picked — the
// date picker itself only lights up days where every participant's own request (or
// lack of one) is actually satisfiable, via GET .../availability's from/to mode. A
// guest's last deliberately-requested therapist at this property is remembered
// (SpaGuestTherapistPreference) and pre-selected next time, written back only when a
// specific-name request was actually honored (see the appointments route).
function SpaPage() {
  const { currentProperty } = useProperty()

  const { slug } = useParams<{ slug: string }>()
  // Phones open on today's schedule (the desk's most common look-up); desktop keeps Book.
  // Derived, not set in an effect: until someone picks a tab, the default follows the
  // screen — and useIsMobile() is false on the first render, so desktop never changes.
  const isMobile = useIsMobile()
  // The tab lives in the URL (?tab=); with none named, a phone opens on Schedule, desktop on Book.
  const [pickedTab, setPageTab] = useUrlState<"book" | "schedule" | "history" | "">("tab", "", ["book", "schedule", "history"])
  const pageTab = pickedTab || (isMobile ? "schedule" : "book")
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [mode, setMode] = useState<"guest" | "walkin">("guest")

  // APP STANDARD 001: the booking form (treatment, party size, participant slots, date,
  // time, notes, payment) and the walk-in mini form. The slots are a field array whose
  // length always follows partySize; each slot's guest is picked from search results and
  // its therapist may be pre-filled from the guest's remembered one (setValue, below).
  // The payment choice only applies in-house, so its rule follows the mode.
  const form = useForm<SpaBookingValues>({
    resolver: zodResolver(spaBookingSchemaFor(mode === "guest")),
    mode: "onChange",
    defaultValues: emptySpaBooking,
  })
  const { setValue, getValues } = form
  const participantsArray = useFieldArray({ control: form.control, name: "participants" })
  const [selectedTreatmentId, partySize, selectedDate, selectedStartTime, inHousePayment, participants] =
    form.watch(["treatmentId", "partySize", "appointmentDate", "startTime", "payment", "participants"])
  const walkInForm = useForm<WalkInGuestValues>({ resolver: zodResolver(walkInGuestSchema), mode: "onChange", defaultValues: emptyWalkInGuest })
  const walkInName = walkInForm.watch("name")

  const [treatments, setTreatments] = useState<Treatment[]>([])
  const selectedTreatment = treatments.find((t) => t.id === selectedTreatmentId) ?? null
  const availableTreatments = treatments.filter((t) => (mode === "guest" ? t.allowInHouseGuest : t.allowWalkIn))

  const [participantTherapistOptions, setParticipantTherapistOptions] = useState<QualifiedTherapist[][]>([])
  const [activeSlot, setActiveSlot] = useState<number | null>(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<GuestResult[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)

  const [startingWalkIn, setStartingWalkIn] = useState(false)
  const [walkInFolioId, setWalkInFolioId] = useState<string | null>(null)
  const [isWalkInPanelOpen, setIsWalkInPanelOpen] = useState(false)
  const [_openWalkIns, setOpenWalkIns] = useState<AppointmentListItem[]>([])

  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [slots, setSlots] = useState<SlotAvailability[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [price, setPrice] = useState<number | null>(null)
  const [currency, setCurrency] = useState("")

  const [booking, setBooking] = useState(false)
  // The appointment open in the side panel (lifecycle actions), and a counter that makes
  // the schedule reload after one of them.
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null)
  const [scheduleRefresh, setScheduleRefresh] = useState(0)
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)

  const [_todaysAppointments, setTodaysAppointments] = useState<AppointmentListItem[]>([])
  const [_loadingAppointments, setLoadingAppointments] = useState(true)

  useEffect(() => {
    if (!currentProperty) return
    fetch(`/api/spa/treatments?propertyId=${currentProperty.id}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTreatments(data.filter((t: Treatment) => t.isActive)) })
  }, [currentProperty])

  const fetchTodaysAppointments = useCallback(() => {
    if (!currentProperty) return
    const date = selectedDate || todayKey()
    setLoadingAppointments(true)
    fetch(`/api/spa/appointments?propertyId=${currentProperty.id}&date=${date}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTodaysAppointments(data) })
      .finally(() => setLoadingAppointments(false))
  }, [currentProperty, selectedDate])

  useEffect(() => { fetchTodaysAppointments() }, [fetchTodaysAppointments])

  const fetchOpenWalkIns = useCallback(() => {
    if (!currentProperty) return
    fetch(`/api/spa/appointments?propertyId=${currentProperty.id}&openWalkIns=true`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setOpenWalkIns(data) })
      .catch(console.error)
  }, [currentProperty])

  useEffect(() => { fetchOpenWalkIns() }, [fetchOpenWalkIns])

  const loadHistory = useCallback(async (date: string | null): Promise<SalesRow[]> => {
    if (!currentProperty) return []
    const iso = toDateKey
    const from = date || iso(new Date(Date.now() - 60 * 86_400_000))
    const to = date || iso(new Date(Date.now() + 60 * 86_400_000))
    const res = await fetch(`/api/spa/appointments?propertyId=${currentProperty.id}&from=${from}&to=${to}`)
    const data = await res.json()
    return (Array.isArray(data) ? data : []).map((a: any): SalesRow => {
      const p = a.participants?.[0]
      const isGuest = !!p?.reservation
      return {
        id: a.id,
        date: a.appointmentDate,
        time: a.startTime,
        guest: isGuest ? `${p.reservation.primaryGuest.firstName} ${p.reservation.primaryGuest.lastName ?? ""}`.trim() : (p?.walkInGuestName ?? "Walk-in"),
        item: a.treatment.name,
        amount: a.priceSnapshot,
        status: a.paymentStatus,
        source: isGuest ? "guest" : "walkin",
        folioId: a.folio?.id ?? a.folioId ?? null,
        folioClosed: a.folio?.isClosed,
        taxInvoiceNumber: a.folio?.taxInvoiceNumber,
      }
    })
  }, [currentProperty])

  const resetParticipants = (size: number) => {
    setValue("partySize", size)
    participantsArray.replace(Array.from({ length: size }, emptySlot))
    setActiveSlot(0)
    setValue("startTime", "")
    setSlots([])
  }

  const handleModeChange = (next: "guest" | "walkin") => {
    setMode(next)
    setValue("treatmentId", "")
    setWalkInFolioId(null)
    resetParticipants(1)
  }

  const handleTreatmentChange = (value: string | null) => {
    setValue("treatmentId", value ?? "", { shouldValidate: true })
    resetParticipants(1)
  }

  const handlePartySizeChange = (value: string | null) => {
    const n = Math.max(1, parseInt(value ?? "1") || 1)
    setValue("partySize", n, { shouldValidate: true })
    // Grow/shrink WITHOUT wiping already-selected participants (esp. the primary in slot 0).
    const current = getValues("participants").length
    if (n < current) participantsArray.remove(Array.from({ length: current - n }, (_, k) => n + k))
    else if (n > current) participantsArray.append(Array.from({ length: n - current }, emptySlot), { shouldFocus: false })
    setValue("startTime", "")
    setSlots([])
  }

  // A stable primitive key for "which guest is in which slot" — used (instead of the
  // participants array itself) as an effect dependency below, so picking a gender/
  // specific-therapist choice doesn't re-trigger the qualified-therapist-list fetch,
  // only an actual identity change does.
  const participantProfileKey = participants.map((p) => (p.value?.kind === "reservation" ? p.value.profileId : "")).join("|")

  // Qualified therapists for the current treatment, fetched per participant slot so
  // each guest's OWN remembered preference (if any) surfaces independently — a couple
  // can have two different "usually requested" therapists pinned at once.
  useEffect(() => {
    if (!currentProperty || !selectedTreatmentId) {
      setParticipantTherapistOptions([])
      return
    }
    let cancelled = false
    Promise.all(
      participants.map((slot) => {
        const profileId = slot.value?.kind === "reservation" ? slot.value.profileId : undefined
        const qs = new URLSearchParams({ propertyId: currentProperty.id, ...(profileId ? { profileId } : {}) })
        return fetch(`/api/spa/treatments/${selectedTreatmentId}/therapists?${qs.toString()}`).then((r) => (r.ok ? r.json() : []))
      })
    ).then((lists: QualifiedTherapist[][]) => {
      if (cancelled) return
      setParticipantTherapistOptions(lists)
      // Pre-fill each guest's usual therapist — only into a slot where nobody has made a
      // choice yet (no gender filter, no named therapist), read at the moment the lists land.
      getValues("participants").forEach((slot, i) => {
        const preferred = lists[i]?.find((t) => t.isPreferredForGuest)
        if (preferred && slot.genderChoice === "ANY" && !slot.specificTherapistId) {
          setValue(`participants.${i}.specificTherapistId`, preferred.id)
        }
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProperty, selectedTreatmentId, partySize, participantProfileKey])

  // Every participant's current ask, serialized once for reuse as both an effect
  // dependency (stable primitive, won't re-fire from an unrelated re-render) and the
  // literal query param sent to the availability route.
  const requirementsKey = JSON.stringify(
    participants.map((p) =>
      p.specificTherapistId ? { requestedTherapistId: p.specificTherapistId } : p.genderChoice !== "ANY" ? { requestedGender: p.genderChoice } : {}
    )
  )

  // Which days (of the next ~60) are actually bookable given everyone's current
  // therapist ask — feeds the DatePicker's availableDates so a day nobody-matching
  // works simply grays out, instead of the guest picking it and hitting a dead end.
  useEffect(() => {
    if (!currentProperty || !selectedTreatmentId) {
      setAvailableDates([])
      return
    }
    const from = new Date()
    const to = new Date()
    to.setDate(to.getDate() + 60)
    const qs = new URLSearchParams({
      propertyId: currentProperty.id,
      treatmentId: selectedTreatmentId,
      partySize: String(partySize),
      from: toDateKey(from),
      to: toDateKey(to),
      requirements: requirementsKey,
    })
    fetch(`/api/spa/appointments/availability?${qs.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.days)) {
          setAvailableDates(data.days.filter((d: { available: boolean }) => d.available).map((d: { date: string }) => d.date))
        }
      })
  }, [currentProperty, selectedTreatmentId, partySize, requirementsKey])

  // Fetch server-computed slots whenever treatment/date/partySize/requirements change —
  // never trust a client-cached list (SPA_PLAN.md §7). The booking submit re-validates
  // the exact same way server-side regardless.
  const fetchSlots = useCallback(() => {
    if (!currentProperty || !selectedTreatmentId || !selectedDate) {
      setSlots([])
      setPrice(null)
      return
    }
    setLoadingSlots(true)
    setLoadError(false)
    setValue("startTime", "")
    const qs = new URLSearchParams({
      propertyId: currentProperty.id,
      treatmentId: selectedTreatmentId,
      date: selectedDate,
      partySize: String(partySize),
      requirements: requirementsKey,
    })
    fetch(`/api/spa/appointments/availability?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        if (Array.isArray(data.slots)) setSlots(data.slots)
        setPrice(typeof data.price === "number" ? data.price : null)
        setCurrency(data.currency || "")
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoadingSlots(false))
  }, [currentProperty, selectedTreatmentId, selectedDate, partySize, requirementsKey, setValue])

  useEffect(() => { fetchSlots() }, [fetchSlots])

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

  // Field-level setValue (not useFieldArray's update(), which remounts the row — that would
  // drop focus from the walk-in companion name input on every keystroke).
  const setSlot = (index: number, value: ParticipantValue | null) => {
    if (index >= getValues("participants").length) return
    setValue(`participants.${index}.value`, value)
    setValue(`participants.${index}.genderChoice`, "ANY")
    setValue(`participants.${index}.specificTherapistId`, "")
  }

  const setSlotGender = (index: number, choice: GenderChoice) => {
    setValue(`participants.${index}.genderChoice`, choice)
    setValue(`participants.${index}.specificTherapistId`, "")
  }

  const setSlotTherapist = (index: number, therapistId: string) => {
    setValue(`participants.${index}.specificTherapistId`, therapistId)
    setValue(`participants.${index}.genderChoice`, "ANY")
  }

  const selectGuestForSlot = (guest: GuestResult) => {
    if (activeSlot === null) return
    setSlot(activeSlot, {
      kind: "reservation",
      reservationId: guest.reservationId,
      guestName: guest.guestName,
      roomNumber: guest.roomNumber,
      profileId: guest.profileId,
      accompanyingGuests: guest.accompanyingGuests,
    })
    setSearchQuery("")
    setGuests([])
    const nextEmpty = participants.findIndex((p, i) => i !== activeSlot && !p.value)
    setActiveSlot(nextEmpty >= 0 ? nextEmpty : null)
  }

  const selectCompanionForSlot = (index: number, companion: { upid: string; guestName: string }) => {
    setSlot(index, { kind: "walkin_companion", guestName: companion.guestName })
  }

  const clearSlot = (index: number) => {
    setSlot(index, null)
    setActiveSlot(index)
  }

  const handleStartWalkIn = async (values: WalkInGuestValues) => {
    if (!currentProperty) return
    setStartingWalkIn(true)
    try {
      const res = await fetch(`/api/folios/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, walkInGuestName: values.name, walkInGuestContact: values.contact }),
      })
      if (res.ok) {
        const folio = await res.json()
        setWalkInFolioId(folio.id)
        setSlot(0, { kind: "walkin_primary", folioId: folio.id, guestName: values.name })
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to start walk-in bill", type: "error" })
      }
    } finally {
      setStartingWalkIn(false)
    }
  }

  const canBook =
    participants.length === partySize &&
    participants.every((p) => !!p.value) &&
    !!selectedStartTime &&
    (mode === "guest" || !!walkInFolioId) &&
    (mode !== "guest" || !inHousePayment.settleNow || !!inHousePayment.paymentMethodId)

  const handleBook = async (values: SpaBookingValues) => {
    if (!currentProperty || !canBook || !selectedTreatment) return
    setBooking(true)
    setFeedback(null)
    try {
      const payloadParticipants = values.participants.map((slot) => {
        const v = slot.value!
        const identity =
          v.kind === "reservation" ? { reservationId: v.reservationId } : v.kind === "walkin_primary" ? { folioId: v.folioId } : { walkInGuestName: v.guestName }
        const therapistAsk = slot.specificTherapistId
          ? { therapistId: slot.specificTherapistId }
          : slot.genderChoice !== "ANY"
            ? { requestedGender: slot.genderChoice }
            : {}
        return { ...identity, ...therapistAsk }
      })
      const res = await fetch("/api/spa/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          treatmentId: values.treatmentId,
          appointmentDate: values.appointmentDate,
          startTime: values.startTime,
          participants: payloadParticipants,
          notes: values.notes || undefined,
          settlement: mode === "guest" && values.payment.settleNow && values.payment.paymentMethodId
            ? { paymentMethodId: values.payment.paymentMethodId }
            : undefined,
        }),
      })
      if (res.ok) {
        const settled = mode === "guest" && values.payment.settleNow && values.payment.paymentMethodId
        setFeedback({ message: `Booked ${selectedTreatment.name} at ${values.startTime}${settled ? " — paid" : ""}.`, type: "success" })
        resetParticipants(values.partySize)
        setValue("notes", "")
        setValue("payment", emptySpaBooking.payment)
        fetchTodaysAppointments()
        setHistoryRefresh((n) => n + 1)
        if (mode === "walkin") {
          fetchOpenWalkIns()
          setIsWalkInPanelOpen(true) // let staff take payment or leave the bill open right away
        }
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

  const primaryReservation = participants[0]?.value?.kind === "reservation" ? participants[0].value : null

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <PageHeader
        title="Spa"
        hint="Search for an in-house guest, or start a walk-in bill, then book a treatment."
      />

      <Tabs value={pageTab} onValueChange={(v) => setPageTab((v as "book" | "schedule" | "history") ?? "book")}>
        <TabsList>
          <TabsTrigger value="book"><Sparkles className="w-4 h-4 mr-2" /> Book</TabsTrigger>
          <TabsTrigger value="schedule"><Calendar className="w-4 h-4 mr-2" /> Schedule</TabsTrigger>
          <TabsTrigger value="history"><ClipboardList className="w-4 h-4 mr-2" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="book" className="m-0">
      <div className="flex flex-col md:flex-row gap-8">
        {/* Left: booking form */}
        <div className="flex-1 space-y-6">
          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                {mode === "guest" ? <Search className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}
                {mode === "guest" ? "Find guest" : "Walk-in guest"}
              </h3>
              <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                <button
                  type="button"
                  className={`px-3 py-1.5 max-md:min-h-10 max-md:px-4 pointer-coarse:min-h-10 pointer-coarse:px-4 ${mode === "guest" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => handleModeChange("guest")}
                >
                  Guest
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 max-md:min-h-10 max-md:px-4 pointer-coarse:min-h-10 pointer-coarse:px-4 ${mode === "walkin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => handleModeChange("walkin")}
                >
                  Walk-in
                </button>
              </div>
            </div>

            {mode === "guest" && (
              primaryReservation ? (
                <div className="flex items-center justify-between bg-muted rounded-lg p-4">
                  <div>
                    <p className="font-bold text-foreground">{primaryReservation.guestName}</p>
                    <p className="text-sm text-muted-foreground">Room {primaryReservation.roomNumber}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => clearSlot(0)}>Change</Button>
                </div>
              ) : (
                <>
                  <form onSubmit={handleSearch} className="flex gap-3">
                    <Input
                      placeholder={isMobile ? "Room no. or last name" : "Search by room number or last name..."}
                      enterKeyHint="search"
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
                          onClick={() => {
                            setSlot(0, { kind: "reservation", reservationId: g.reservationId, guestName: g.guestName, roomNumber: g.roomNumber, profileId: g.profileId, accompanyingGuests: g.accompanyingGuests })
                            setSearchQuery("")
                            setGuests([])
                          }}
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
                  {searchQuery && guests.length === 0 && !loadingSearch && (
                    <p className="text-sm text-muted-foreground mt-3 text-center">No in-house guests match &quot;{searchQuery}&quot;.</p>
                  )}
                </>
              )
            )}

            {mode === "walkin" && (
              walkInFolioId ? (
                <div className="flex items-center justify-between bg-muted rounded-lg p-4">
                  <div>
                    <p className="font-bold text-foreground">{walkInName}</p>
                    <p className="text-sm text-muted-foreground">Walk-in bill open</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setIsWalkInPanelOpen(true)}>
                    <Receipt className="w-4 h-4 mr-2" /> View / close bill
                  </Button>
                </div>
              ) : (
                <Form {...walkInForm}>
                  <form onSubmit={walkInForm.handleSubmit(handleStartWalkIn)} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField control={walkInForm.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormControl><Input placeholder="Guest name" aria-label="Guest name" {...field} /></FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                    <FormField control={walkInForm.control} name="contact" render={({ field }) => (
                      <FormItem>
                        <FormControl><Input placeholder="Phone / email (optional)" aria-label="Phone or email" {...field} /></FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                    <SubmitButton className="md:col-span-2" pending={startingWalkIn} pendingLabel="Starting…" disabled={!walkInName}>
                      Start walk-in bill
                    </SubmitButton>
                  </form>
                </Form>
              )
            )}
          </div>

          <div className="bg-card rounded-xl shadow-sm border border-border p-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" /> Treatment
            </h3>
            <Form {...form}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <FormField control={form.control} name="treatmentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Treatment</FormLabel>
                  <Select value={field.value} onValueChange={handleTreatmentChange} disabled={mode === "walkin" && !walkInFolioId}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>{selectedTreatment ? selectedTreatment.name : "Choose treatment..."}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableTreatments.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.defaultDurationMinutes} min)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />
              {selectedTreatment && selectedTreatment.maxParticipants > 1 && (
                <FormField control={form.control} name="partySize" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Party size</FormLabel>
                    {/* Phone stepper first, so on desktop the Select stays the last child (space-y). */}
                    <NumberStepper
                      className="md:hidden"
                      label="Guests"
                      min={1}
                      max={selectedTreatment.maxParticipants}
                      value={field.value}
                      onChange={(n) => handlePartySizeChange(String(n))}
                    />
                    <Select value={String(field.value)} onValueChange={handlePartySizeChange}>
                      <FormControl>
                        <SelectTrigger className="w-full max-md:hidden"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.from({ length: selectedTreatment.maxParticipants }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "guest" : "guests"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
              )}
            </div>
            </Form>
          </div>

          {selectedTreatmentId && (
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-primary" /> Guest{partySize > 1 ? "s" : ""}
              </h3>
              <div className="space-y-3 mb-4">
                {participants.map((slot, i) => {
                  const rowKey = participantsArray.fields[i]?.id ?? i
                  const usedCompanionNames = new Set(
                    participants.filter((s, si) => si !== i && s.value?.kind === "walkin_companion").map((s) => (s.value as { guestName: string }).guestName)
                  )
                  const companionOptions = i > 0 && primaryReservation
                    ? primaryReservation.accompanyingGuests.filter((c) => !usedCompanionNames.has(c.guestName))
                    : []

                  return (
                    <div key={rowKey} className="space-y-2">
                      {i === 0 && mode === "walkin" ? (
                        <div className="flex items-center justify-between rounded-lg border p-3">
                          {walkInFolioId ? (
                            <p className="text-sm text-foreground">{walkInName} <span className="text-muted-foreground">(walk-in)</span></p>
                          ) : (
                            <p className="text-sm text-muted-foreground">Start a walk-in bill above first</p>
                          )}
                        </div>
                      ) : mode === "walkin" && i > 0 ? (
                        <Input
                          placeholder={`Guest ${i + 1} name`}
                          value={slot.value?.kind === "walkin_companion" ? slot.value.guestName : ""}
                          onChange={(e) => setSlot(i, e.target.value ? { kind: "walkin_companion", guestName: e.target.value } : null)}
                        />
                      ) : slot.value?.kind === "reservation" ? (
                        <div className="flex items-center justify-between rounded-lg border p-3">
                          <div>
                            <p className="font-medium text-sm text-foreground">{slot.value.guestName}</p>
                            <p className="text-xs text-muted-foreground">Room {slot.value.roomNumber}</p>
                          </div>
                          <Button type="button" size="icon" variant="ghost" aria-label="Clear guest" onClick={() => clearSlot(i)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : slot.value?.kind === "walkin_companion" ? (
                        <div className="flex items-center justify-between rounded-lg border p-3">
                          <p className="font-medium text-sm text-foreground">
                            {slot.value.guestName} <span className="text-muted-foreground text-xs">(companion)</span>
                          </p>
                          <Button type="button" size="icon" variant="ghost" aria-label="Remove companion" onClick={() => clearSlot(i)}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          {companionOptions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted-foreground">Also in room {primaryReservation!.roomNumber}:</span>
                              {companionOptions.map((c) => (
                                <Button key={c.upid} type="button" size="sm" variant="outline" onClick={() => selectCompanionForSlot(i, c)}>
                                  + {c.guestName}
                                </Button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className={`w-full text-left text-sm rounded-lg border p-3 ${activeSlot === i ? "text-primary font-medium border-primary" : "text-muted-foreground"}`}
                            onClick={() => setActiveSlot(i)}
                          >
                            {partySize > 1 ? `Guest ${i + 1} — click to search` : "Search for a guest..."}
                          </button>
                        </>
                      )}

                      {slot.value && (
                        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                          <Label className="text-xs text-muted-foreground">Therapist</Label>
                          <div className="flex items-center gap-3">
                            <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                              {(["ANY", "FEMALE", "MALE"] as const).map((g) => (
                                <button
                                  key={g}
                                  type="button"
                                  disabled={!!slot.specificTherapistId}
                                  className={`px-3 py-1.5 max-md:min-h-10 pointer-coarse:min-h-10 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    slot.genderChoice === g && !slot.specificTherapistId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                  }`}
                                  onClick={() => setSlotGender(i, g)}
                                >
                                  {g === "ANY" ? "Any" : g === "FEMALE" ? "Female" : "Male"}
                                </button>
                              ))}
                            </div>
                          </div>
                          {(participantTherapistOptions[i]?.length ?? 0) > 0 && (
                            <Select value={slot.specificTherapistId} onValueChange={(v) => setSlotTherapist(i, v ?? "")}>
                              <SelectTrigger className="w-full">
                                <SelectValue>
                                  {slot.specificTherapistId
                                    ? participantTherapistOptions[i]?.find((t) => t.id === slot.specificTherapistId)?.displayName
                                    : "Or request someone specific..."}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {participantTherapistOptions[i]?.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.isPreferredForGuest ? `★ ${t.displayName} — usually requested` : t.displayName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {mode === "guest" && activeSlot !== null && (
                <>
                  <form onSubmit={handleSearch} className="flex gap-3">
                    <Input
                      placeholder={isMobile ? "Room no. or last name" : "Search by room number or last name..."}
                      enterKeyHint="search"
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
              <Form {...form}>
              <div className="space-y-4">
                <FormField control={form.control} name="appointmentDate" render={({ field }) => (
                  <FormItem className="max-w-[240px]">
                    <FormLabel>Date</FormLabel>
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Choose date..."
                      minDate={todayKey()}
                      availableDates={availableDates}
                    />
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                {selectedDate && (
                  loadingSlots ? (
                    <p className="text-sm text-muted-foreground">Checking availability...</p>
                  ) : loadError ? (
                    <ErrorState title="Couldn't load time slots" onRetry={fetchSlots} />
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No time slots available on this date.</p>
                  ) : (
                    <FormField control={form.control} name="startTime" render={({ field }) => (
                      <FormItem>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {slots.map((s) => (
                            <button
                              key={s.startTime}
                              type="button"
                              aria-pressed={field.value === s.startTime}
                              disabled={!s.available}
                              onClick={() => field.onChange(s.startTime)}
                              className={`px-2 py-1.5 rounded-md text-sm border transition-colors ${
                                !s.available
                                  ? "opacity-40 cursor-not-allowed border-border text-muted-foreground"
                                  : field.value === s.startTime
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "border-border hover:bg-muted text-foreground"
                              }`}
                            >
                              {s.startTime}
                            </button>
                          ))}
                        </div>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )} />
                  )
                )}

                {selectedStartTime && (
                  <div className="rounded-lg bg-muted p-3 space-y-1.5">
                    {participants.map((slot, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Guest {i + 1}</span>
                        <span className="font-medium text-foreground">
                          {slot.specificTherapistId
                            ? participantTherapistOptions[i]?.find((t) => t.id === slot.specificTherapistId)?.displayName ?? "Requested therapist"
                            : slot.genderChoice !== "ANY"
                              ? `${slot.genderChoice === "FEMALE" ? "Female" : "Male"} therapist`
                              : "Any available"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {price !== null && (
                  <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                    <span className="text-sm text-muted-foreground">Price</span>
                    <span className="font-mono font-medium text-foreground">{currency} {price.toFixed(2)}</span>
                  </div>
                )}
              </div>
              </Form>
            </div>
          )}

          {selectedTreatmentId && (
            <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!canBook ? "opacity-60" : "border-primary/30 shadow-md"}`}>
              <Form {...form}>
              <form id="spa-book-form" onSubmit={form.handleSubmit(handleBook)} className="space-y-4">
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl><Input placeholder="e.g. Prefers firm pressure" {...field} /></FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />

                {mode === "guest" && primaryReservation && (
                  <FormField control={form.control} name="payment" render={({ field }) => (
                    <FormItem>
                      <InHousePaymentChoice value={field.value} onChange={field.onChange} amount={price} currency={currency} />
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )} />
                )}

                {feedback && (
                  <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}`}>
                    {feedback.message}
                  </div>
                )}

                <SubmitButton className="w-full max-md:hidden" pending={booking} pendingLabel="Booking…" disabled={!canBook}>
                  Book appointment
                </SubmitButton>
              </form>
              </Form>
            </div>
          )}
        </div>

      </div>
      {selectedTreatmentId && (
        <MobileActionBar>
          <Button type="submit" form="spa-book-form" className="h-11 flex-1 min-w-0 text-base" disabled={booking || !canBook}>
            <span className="truncate">
              {booking ? "Booking..." : `Book${selectedStartTime ? ` ${selectedStartTime}` : ""}${price !== null ? ` · ${currency} ${price.toFixed(2)}` : ""}`}
            </span>
          </Button>
        </MobileActionBar>
      )}
        </TabsContent>

        <TabsContent value="schedule" className="m-0">
          {currentProperty && (
            <div className="bg-card rounded-xl shadow-sm border border-border p-6">
              <SpaSchedule
                propertyId={currentProperty.id}
                refreshKey={scheduleRefresh}
                onSelectAppointment={(a) => setSelectedAppointmentId(a.id)}
              />
            </div>
          )}
          <MobileActionBar>
            <Button className="h-11 flex-1" onClick={() => setPageTab("book")}>
              <Sparkles className="w-4 h-4 mr-2" /> Book a treatment
            </Button>
          </MobileActionBar>
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

      <SpaAppointmentSheet
        appointmentId={selectedAppointmentId}
        onClose={() => setSelectedAppointmentId(null)}
        onChanged={() => { setScheduleRefresh((n) => n + 1); setHistoryRefresh((n) => n + 1) }}
        onOpenBill={(folioId) => { setSelectedAppointmentId(null); setWalkInFolioId(folioId); setIsWalkInPanelOpen(true) }}
      />

      <WalkInFolioPanel
        folioId={walkInFolioId}
        isOpen={isWalkInPanelOpen}
        onClose={() => { setIsWalkInPanelOpen(false); setHistoryRefresh((n) => n + 1) }}
        onClosed={() => {
          setIsWalkInPanelOpen(false)
          setWalkInFolioId(null)
          walkInForm.reset(emptyWalkInGuest)
          setMode("guest")
          resetParticipants(1)
          fetchOpenWalkIns()
          setHistoryRefresh((n) => n + 1)
        }}
      />
    </div>
  )
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function SpaRoute() {
  return (
    <Suspense>
      <SpaPage />
    </Suspense>
  )
}
