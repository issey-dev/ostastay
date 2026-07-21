"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { Plus, Trash2, Star, ArrowLeft, Save, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProperty } from "@/components/providers/property-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { format, addDays, parseISO } from "date-fns"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { allocationStayTotal, type AllocationLike } from "@/lib/allocations"
import { GuestPickerModal, type GuestProfile } from "@/components/reservations/guest-picker-modal"

type ReservationDetail = {
  id: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  adults: number
  children: number
  infants: number
  remarks: string | null
  mealPlan: string
  primaryGuestId: string
  travelAgentId: string | null
  accompanyingGuests?: { profile: { upid: string } }[]
  specialRequests?: { code: string }[]
  assignments: {
    roomTypeId: string
    roomId: string | null
    ratePlanId: string
    overrideRate: number | null
    startDate: string
    endDate: string
  }[]
  allocations?: { allocationId: string; source: string }[]
}

type AllocationOption = {
  id: string
  code: string
  name: string
  mode: string
  postingRhythm: string
  sellSeparate: boolean
  isActive: boolean
  rates: { adultPrice: number, childPrice: number, effectiveFrom: string, effectiveTo: string | null }[]
}

type QuoteSegment = {
  roomTypeId: string; ratePlanId: string; nights: number
  roomBase: number; roomTax: number; roomServiceCharge: number
  extraOccupancyBase: number; extraOccupancyTax: number; extraOccupancyServiceCharge: number
  unpricedNights: number
}
type QuoteAllocationSegment = { nights: number; adultPrice: number; childPrice: number; amountPerNight: number; subtotal: number }
type QuoteAllocation = {
  allocationId: string; code: string; name: string; source: string; mode: string
  base: number; tax: number; serviceCharge: number
  breakdown: { postingRhythm: string; totalNights: number; postingNights: number; unpricedNights: number; segments: QuoteAllocationSegment[]; total: number }
}
type Quote = {
  nights: number
  pricesIncludeTaxes: boolean
  segments: QuoteSegment[]
  allocations: QuoteAllocation[]
  taxLines: { name: string; ratePercent: number; calculateOn: string; amount: number }[]
  greenTax: { enabled: boolean; adults: number; children: number; perAdultAmount: number; perChildAmount: number; nights: number; total: number }
  totals: { roomBase: number; extraOccupancyBase: number; allocationsBase: number; taxTotal: number; greenTaxTotal: number; grandTotal: number }
  warnings: string[]
}

const PIPE = "×"

const RHYTHM_LABEL: Record<string, string> = {
  EVERY_NIGHT: "every night",
  ARRIVAL_NIGHT: "arrival night only",
  DEPARTURE_NIGHT: "departure night only",
}

function money(n: number) {
  return `$${n.toFixed(2)}`
}

export function BookingForm({ reservationId }: { reservationId?: string }) {
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const enterpriseId = currentProperty?.enterpriseId ?? ""
  const isEditMode = !!reservationId

  const [loading, setLoading] = useState(isEditMode)
  const [submitting, setSubmitting] = useState(false)
  const [notification, setNotification] = useState<{ title: string; message: string } | null>(null)
  const [existingStatus, setExistingStatus] = useState<string | null>(null)
  const [existingConfirmationNo, setExistingConfirmationNo] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [mealPlans, setMealPlans] = useState<any[]>([])
  const [allocations, setAllocations] = useState<AllocationOption[]>([])
  const [specialRequestOptions, setSpecialRequestOptions] = useState<{ code: string; value: string }[]>([])

  const [form, setForm] = useState({
    primaryGuestId: "",
    checkInDate: "",
    checkOutDate: "",
    adults: 1,
    children: 0,
    infants: 0,
    remarks: "",
    mealPlan: "NONE",
    travelAgentId: "none",
    accompanyingGuestIds: [] as string[],
    manualAllocationIds: [] as string[],
    specialRequestCodes: [] as string[],
    // Explicit staff acknowledgement required whenever occupancy exceeds a selected
    // room type's max occupancy — see capacityIssues below. Reset whenever adults/
    // children/room types change, so an old acknowledgement can't silently cover a
    // new, different overage.
    acknowledgeOverCapacity: false,
    assignments: [
      { roomTypeId: "", roomId: "", ratePlanId: "", overrideRate: "", startDate: "", endDate: "" }
    ]
  })

  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [guestPickerOpen, setGuestPickerOpen] = useState<null | "primary" | "accompanying">(null)
  const [gridData, setGridData] = useState<{
    nights: number
    roomTypes: { id: string; code: string; name: string; isPseudo: boolean; baseOccupancy: number; maxOccupancy: number; minAvailable: number | null; soldOutNights: string[] }[]
    ratePlans: { id: string; code: string; name: string; isNegotiated: boolean; negotiatedForProfileIds: string[]; parentRatePlanId: string | null }[]
    grid: Record<string, Record<string, { total: number; avgNightly: number; pricedNights: number; unpricedNights: number; extraOccupancyTotal: number } | null>>
  } | null>(null)
  const [gridLoading, setGridLoading] = useState(false)

  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  // ── Lookup data + (edit mode) the reservation itself ──────────────────────
  useEffect(() => {
    if (!currentProperty) return
    Promise.all([
      fetch(`/api/profiles?enterpriseId=${enterpriseId}`).then(r => r.json()),
      fetch(`/api/room-types?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/rate-plans?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/rooms?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/meal-plans?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/allocations?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=SPECIAL_REQUEST`).then(r => r.json()),
    ]).then(([profData, rtData, rpData, rmData, mpData, alData, srData]) => {
      if (Array.isArray(profData)) setProfiles(profData)
      if (Array.isArray(rtData)) setRoomTypes(rtData)
      if (Array.isArray(rpData)) setRatePlans(rpData)
      if (Array.isArray(rmData)) setRooms(rmData)
      if (Array.isArray(mpData)) setMealPlans(mpData)
      if (Array.isArray(alData)) setAllocations(alData)
      if (Array.isArray(srData)) setSpecialRequestOptions(srData.filter((c: any) => c.isActive))
    }).catch(console.error)
  }, [currentProperty, propertyId, enterpriseId])

  useEffect(() => {
    if (!reservationId) return
    setLoading(true)
    fetch(`/api/reservations/${reservationId}`)
      .then(r => r.json())
      .then((res: ReservationDetail) => {
        setExistingStatus(res.status)
        setExistingConfirmationNo(res.confirmationNo)
        setForm({
          primaryGuestId: res.primaryGuestId,
          checkInDate: res.checkInDate ? new Date(res.checkInDate).toISOString().split('T')[0] : "",
          checkOutDate: res.checkOutDate ? new Date(res.checkOutDate).toISOString().split('T')[0] : "",
          adults: res.adults,
          children: res.children,
          infants: res.infants || 0,
          remarks: res.remarks || "",
          mealPlan: res.mealPlan || "NONE",
          travelAgentId: res.travelAgentId || "none",
          accompanyingGuestIds: res.accompanyingGuests?.map(ag => ag.profile.upid) || [],
          manualAllocationIds: res.allocations?.filter(a => a.source === "MANUAL").map(a => a.allocationId) || [],
          specialRequestCodes: res.specialRequests?.map(sr => sr.code) || [],
          acknowledgeOverCapacity: false,
          assignments: res.assignments && res.assignments.length > 0 ? res.assignments.map(a => ({
            roomTypeId: a.roomTypeId,
            roomId: a.roomId || "none",
            ratePlanId: a.ratePlanId,
            overrideRate: a.overrideRate?.toString() || "",
            startDate: a.startDate ? new Date(a.startDate).toISOString().split('T')[0] : "",
            endDate: a.endDate ? new Date(a.endDate).toISOString().split('T')[0] : "",
          })) : [{ roomTypeId: "", roomId: "", ratePlanId: "", overrideRate: "", startDate: "", endDate: "" }],
        })
        setActiveSegmentIndex(0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [reservationId])

  // ── Look-to-Book grid: quotes the ACTIVE segment's date range ─────────────
  const activeSegment = form.assignments[activeSegmentIndex] ?? form.assignments[0]
  const gridStart = activeSegment?.startDate || form.checkInDate
  const gridEnd = activeSegment?.endDate || form.checkOutDate

  useEffect(() => {
    if (!propertyId || !gridStart || !gridEnd || new Date(gridEnd) <= new Date(gridStart)) {
      setGridData(null)
      return
    }
    let cancelled = false
    setGridLoading(true)
    const excludeParam = reservationId ? `&excludeReservationId=${reservationId}` : ""
    fetch(`/api/reservations/rate-availability?propertyId=${propertyId}&startDate=${gridStart}&endDate=${gridEnd}&adults=${form.adults}&children=${form.children}${excludeParam}`)
      .then(r => r.json())
      .then(data => { if (!cancelled && data?.grid) setGridData(data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setGridLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, gridStart, gridEnd, form.adults, form.children, reservationId])

  // ── Server-side quote: authoritative total + full tax breakdown ──────────
  useEffect(() => {
    const complete = form.assignments.every(a => a.roomTypeId && a.ratePlanId && a.startDate && a.endDate && new Date(a.endDate) > new Date(a.startDate))
    if (!propertyId || !complete) {
      setQuote(null)
      return
    }
    let cancelled = false
    setQuoteLoading(true)
    fetch(`/api/reservations/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        assignments: form.assignments,
        adults: form.adults,
        children: form.children,
        mealPlanCode: form.mealPlan,
        manualAllocationIds: form.manualAllocationIds,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setQuote(data) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setQuoteLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, JSON.stringify(form.assignments), form.adults, form.children, form.mealPlan, JSON.stringify(form.manualAllocationIds)])

  // ── Allocation preview (mirrors src/lib/allocations-server.ts) ────────────
  const selectedRatePlanForAlloc = ratePlans.find(rp => rp.id === form.assignments[0]?.ratePlanId)
  const parentPlanForAlloc = selectedRatePlanForAlloc?.parentRatePlanId
    ? ratePlans.find(rp => rp.id === selectedRatePlanForAlloc.parentRatePlanId)
    : null
  const ratePlanAllocLinks: Array<{ allocation: { id: string } }> =
    (selectedRatePlanForAlloc?.allocationLinks?.length
      ? selectedRatePlanForAlloc.allocationLinks
      : parentPlanForAlloc?.allocationLinks) ?? []
  const mealPlanAllocLinks: Array<{ allocation: { id: string } }> =
    mealPlans.find(mp => mp.code === form.mealPlan)?.allocationLinks ?? []
  const linksForMode = currentProperty?.allocationCalculationMode === "MEAL_PLAN" ? mealPlanAllocLinks : ratePlanAllocLinks
  const autoAllocationIds = [
    ...new Set(linksForMode.map(l => l.allocation.id)),
  ].filter(id => allocations.some(a => a.id === id && a.isActive))

  const stayDatesForAlloc = (() => {
    const dates = form.assignments
      .flatMap(a => [a.startDate, a.endDate])
      .filter(Boolean)
      .map(d => new Date(d).getTime())
    if (dates.length < 2) return null
    return { checkIn: new Date(Math.min(...dates)), checkOut: new Date(Math.max(...dates)) }
  })()

  const allocationPreviewTotal = (a: AllocationOption): number | null => {
    if (!stayDatesForAlloc) return null
    const like: AllocationLike = {
      id: a.id, code: a.code, name: a.name, mode: a.mode, postingRhythm: a.postingRhythm,
      rates: a.rates.map(r => ({
        adultPrice: r.adultPrice, childPrice: r.childPrice,
        effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
      })),
    }
    return allocationStayTotal({
      allocation: like, adults: form.adults, children: form.children,
      checkInDate: stayDatesForAlloc.checkIn, checkOutDate: stayDatesForAlloc.checkOut,
    })
  }

  const nightsBetween = (start: string, end: string) =>
    Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000))

  // Hard rule: a departure/segment-end can never be on or before its own arrival/
  // segment-start. The date pickers already refuse to let you TAP an invalid day
  // (see minDate below), but changing an already-picked Arrival to fall on or after
  // the current Departure would otherwise leave a stale, now-invalid Departure sitting
  // in state — so that side is cleared here and has to be re-picked.
  const dayAfter = (d: string) => format(addDays(parseISO(d), 1), "yyyy-MM-dd")

  const setStayDate = (which: "in" | "out", v: string) => {
    setForm(p => {
      const assignments = [...p.assignments]
      if (which === "in" && assignments.length > 0) {
        assignments[0] = { ...assignments[0], startDate: v }
        const stillValid = p.checkOutDate && v < p.checkOutDate
        if (!stillValid) {
          const last = assignments.length - 1
          assignments[last] = { ...assignments[last], endDate: "" }
        }
        return { ...p, checkInDate: v, checkOutDate: stillValid ? p.checkOutDate : "", assignments }
      }
      if (which === "out" && assignments.length > 0) {
        const last = assignments.length - 1
        assignments[last] = { ...assignments[last], endDate: v }
        return { ...p, checkOutDate: v, assignments }
      }
      return p
    })
  }

  const selectGridCell = (roomTypeId: string, ratePlanId: string) => {
    setForm(p => {
      const assignments = [...p.assignments]
      const i = Math.min(activeSegmentIndex, assignments.length - 1)
      assignments[i] = { ...assignments[i], roomTypeId, ratePlanId, roomId: "none" }
      return { ...p, assignments }
    })
  }

  const visibleGridRatePlans = (gridData?.ratePlans ?? []).filter(rp =>
    !rp.isNegotiated ||
    (form.travelAgentId !== "none" && rp.negotiatedForProfileIds.includes(form.travelAgentId))
  )

  // Occupancy beyond a room type's baseOccupancy is normal and just incurs an
  // extra-person charge if one is configured (shown as "Extra occupancy" in the
  // summary) — no confirmation needed for that. Exceeding maxOccupancy is different:
  // it's the room's hard physical/legal limit, so booking anyway requires an explicit
  // staff acknowledgement rather than silently allowing it.
  const totalOccupants = form.adults + form.children
  const capacityIssues = form.assignments
    .map(a => {
      const rt = roomTypes.find(r => r.id === a.roomTypeId)
      if (!rt || totalOccupants <= rt.maxOccupancy) return null
      return { roomTypeName: rt.name as string, maxOccupancy: rt.maxOccupancy as number }
    })
    .filter((x): x is { roomTypeName: string; maxOccupancy: number } => x !== null)
  // Dedupe by room type name (a split stay can reuse the same room type across segments).
  const uniqueCapacityIssues = [...new Map(capacityIssues.map(c => [c.roomTypeName, c])).values()]

  // Hard cap: accompanying guests can't exceed the pax not already occupied by the
  // primary guest — adults + children, minus the primary guest's own slot.
  const maxAccompanying = Math.max(0, form.adults + form.children - 1)

  useEffect(() => {
    setForm(p => p.acknowledgeOverCapacity ? { ...p, acknowledgeOverCapacity: false } : p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalOccupants, JSON.stringify(form.assignments.map(a => a.roomTypeId))])

  // Hard rule: split-stay segments must run back-to-back with no gaps — segment N's
  // arrival is locked to segment N-1's departure (see the disabled "From" picker
  // below) rather than left independently editable. This cascades forward whenever an
  // earlier segment's departure changes (edit, add, or remove a segment), and keeps
  // the top-level Arrival/Departure fields mirroring the chain's two endpoints.
  useEffect(() => {
    setForm(p => {
      let changed = false
      const next = p.assignments.map((a, i) => {
        if (i === 0) return a
        const prevEnd = p.assignments[i - 1].endDate
        if (prevEnd && a.startDate !== prevEnd) {
          changed = true
          const keepEnd = a.endDate && a.endDate > prevEnd
          return { ...a, startDate: prevEnd, ...(keepEnd ? {} : { endDate: "" }) }
        }
        return a
      })
      const newCheckIn = next[0]?.startDate || ""
      const newCheckOut = next[next.length - 1]?.endDate || ""
      if (!changed && newCheckIn === p.checkInDate && newCheckOut === p.checkOutDate) return p
      return { ...p, assignments: next, checkInDate: newCheckIn, checkOutDate: newCheckOut }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(form.assignments.map(a => [a.startDate, a.endDate])), form.assignments.length])

  // Flags when two date-adjacent segments assign different physical rooms — a
  // scheduled mid-stay room move the reservation will be tagged with (see
  // hasScheduledRoomMove on Reservation / the Front Office "Room Moves Due Today"
  // worklist). Purely a preview here — the server recomputes it authoritatively.
  const scheduledRoomMoveAt = (index: number) => {
    if (index === 0) return false
    const prev = form.assignments[index - 1]
    const curr = form.assignments[index]
    return !!prev.roomId && prev.roomId !== "none" && !!curr.roomId && curr.roomId !== "none" && prev.roomId !== curr.roomId
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (!form.primaryGuestId) {
        setNotification({ title: "Validation Error", message: "Select a primary guest." })
        setSubmitting(false)
        return
      }
      if (form.assignments.some(a => !a.roomTypeId || !a.ratePlanId || !a.startDate || !a.endDate)) {
        setNotification({ title: "Validation Error", message: "All segments must have dates, room type, and rate plan." })
        setSubmitting(false)
        return
      }
      // Defense in depth — the date pickers already refuse to select an invalid range,
      // but guard again here in case of stale/edit-mode state.
      if (form.assignments.some(a => a.endDate <= a.startDate)) {
        setNotification({ title: "Validation Error", message: "Each segment's departure date must be after its arrival date." })
        setSubmitting(false)
        return
      }
      // Defense in depth — the "From" picker is already locked/disabled for every
      // segment after the first, but guard again here in case of stale/edit-mode state.
      if (form.assignments.some((a, i) => i > 0 && a.startDate !== form.assignments[i - 1].endDate)) {
        setNotification({ title: "Validation Error", message: "Segments must run back-to-back with no gaps between stays." })
        setSubmitting(false)
        return
      }
      if (form.accompanyingGuestIds.length > maxAccompanying) {
        setNotification({ title: "Validation Error", message: `Only ${maxAccompanying} accompanying guest(s) can be attached for ${form.adults} adult(s) and ${form.children} child(ren).` })
        setSubmitting(false)
        return
      }
      if (capacityIssues.length > 0 && !form.acknowledgeOverCapacity) {
        setNotification({ title: "Occupancy Exceeds Maximum", message: "Check the override box in Room & Rate to confirm this booking anyway." })
        setSubmitting(false)
        return
      }

      const dates = form.assignments.flatMap(a => [new Date(a.startDate).getTime(), new Date(a.endDate).getTime()])
      const minDate = new Date(Math.min(...dates))
      const maxDate = new Date(Math.max(...dates))

      const payload = {
        ...form,
        propertyId,
        checkInDate: minDate.toISOString(),
        checkOutDate: maxDate.toISOString(),
        travelAgentId: form.travelAgentId === "none" ? null : form.travelAgentId,
        assignments: form.assignments.map(a => ({
          roomTypeId: a.roomTypeId,
          roomId: a.roomId === "none" ? null : a.roomId,
          ratePlanId: a.ratePlanId,
          overrideRate: a.overrideRate ? parseFloat(a.overrideRate) : null,
          startDate: new Date(a.startDate).toISOString(),
          endDate: new Date(a.endDate).toISOString(),
        })),
      }

      const url = isEditMode ? `/api/reservations/${reservationId}` : `/api/reservations`
      const method = isEditMode ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        router.push(`/e/${slug}/dashboard/reservations`)
        router.refresh()
      } else {
        const err = await res.json()
        setNotification({ title: "Error", message: `Failed to save: ${JSON.stringify(err)}` })
        setSubmitting(false)
      }
    } catch (err) {
      setNotification({ title: "Error", message: "An unexpected error occurred." })
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 max-w-6xl mx-auto p-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-7xl mx-auto p-4 pb-16">
      <div className="flex items-center gap-4">
        <Button type="button" variant="outline" size="icon" onClick={() => router.push(`/e/${slug}/dashboard/reservations`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            {isEditMode ? "Edit Booking" : "New Booking"}
            {isEditMode && existingStatus && <StatusBadge label={existingStatus.replace('_', ' ')} status={existingStatus} />}
          </h2>
          <p className="text-muted-foreground">
            {isEditMode
              ? `Modify details for ${existingConfirmationNo ?? "this reservation"}. Status changes go through the Check-In / Check-Out / Cancel actions.`
              : "Pick the stay dates, choose a room and rate from the grid, then attach the guest."}
          </p>
        </div>
        {notification && (
          <span className="text-sm text-destructive font-medium">{notification.title}: {notification.message}</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* ── 1 · Stay ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle className="text-lg">1 · Stay</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="grid gap-2">
                  <Label>Arrival <span className="text-destructive">*</span></Label>
                  <DatePicker value={form.checkInDate} onChange={v => setStayDate("in", v)} />
                </div>
                <div className="grid gap-2">
                  <Label className="flex items-center gap-2">
                    Departure <span className="text-destructive">*</span>
                    {form.checkInDate && form.checkOutDate && (
                      <span className="text-[10px] font-semibold bg-muted text-foreground px-2 py-0.5 rounded-none">
                        {nightsBetween(form.checkInDate, form.checkOutDate)} Nights
                      </span>
                    )}
                  </Label>
                  <DatePicker value={form.checkOutDate} onChange={v => setStayDate("out", v)} minDate={form.checkInDate ? dayAfter(form.checkInDate) : undefined} />
                </div>
                <div className="grid gap-2">
                  <Label>Adults</Label>
                  <Input type="number" min="1" value={form.adults} onChange={e => setForm(p => ({ ...p, adults: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="grid gap-2">
                  <Label>Children</Label>
                  <Input type="number" min="0" value={form.children} onChange={e => setForm(p => ({ ...p, children: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="grid gap-2">
                  <Label>Infants</Label>
                  <Input type="number" min="0" value={form.infants} onChange={e => setForm(p => ({ ...p, infants: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Guests beyond a room type&apos;s base occupancy (shown in Room &amp; Rate below) incur an
                extra-person charge if one is configured — free otherwise. Exceeding the room&apos;s max
                occupancy needs an explicit override.
              </p>
              <div className="grid gap-2">
                <Label className="flex items-center gap-2">
                  Booking Source / Travel Agent (Optional)
                  {ratePlans.some(rp => rp.isNegotiated && form.travelAgentId !== "none" && rp.negotiatedForProfileIds?.includes(form.travelAgentId)) && (
                    <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30 text-[10px]">unlocks negotiated rates</Badge>
                  )}
                </Label>
                <SearchableSelect
                  value={form.travelAgentId}
                  onChange={(v) => setForm(p => ({ ...p, travelAgentId: v }))}
                  placeholder="Select Travel Agent..."
                  options={[
                    { value: "none", label: "Direct Booking (None)" },
                    ...profiles.filter(p => p.profileType === 'TRAVEL_AGENT' || p.profileType === 'COMPANY').map(prof => ({
                      value: prof.upid,
                      label: prof.companyName || `${prof.firstName} ${prof.lastName}`
                    }))
                  ]}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── 2 · Room & Rate (Look-to-Book grid) ──────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>2 · Room &amp; Rate</span>
                {gridStart && gridEnd && gridData && (
                  <span className="text-xs font-normal text-muted-foreground">
                    Avg / night for {format(new Date(gridStart), "dd MMM")} – {format(new Date(gridEnd), "dd MMM")}
                    {form.assignments.length > 1 && ` (Segment ${Math.min(activeSegmentIndex, form.assignments.length - 1) + 1})`}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!gridStart || !gridEnd ? (
                <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-md bg-muted/40">
                  Pick arrival and departure dates to see rates and availability.
                </p>
              ) : gridLoading && !gridData ? (
                <Skeleton className="h-36 rounded-md" />
              ) : gridData ? (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left font-medium text-muted-foreground px-3 py-2 w-44">Rate Plan</th>
                        {gridData.roomTypes.map(rt => (
                          <th key={rt.id} className="px-3 py-2 text-center font-medium">
                            <div>{rt.name}</div>
                            <div className="text-[10px] font-normal text-muted-foreground">
                              Occ. {rt.baseOccupancy}–{rt.maxOccupancy}
                            </div>
                            <div className="text-[11px] font-normal">
                              {rt.minAvailable === null ? (
                                <span className="text-muted-foreground">unlimited</span>
                              ) : rt.minAvailable <= 0 ? (
                                <span className="text-destructive">Sold out{rt.soldOutNights[0] ? ` ${format(new Date(rt.soldOutNights[0]), "dd MMM")}` : ""}</span>
                              ) : (
                                <span className="text-info">{rt.minAvailable} left</span>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleGridRatePlans.map(rp => (
                        <tr key={rp.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-muted-foreground">
                            <span className="font-mono text-xs">{rp.code}</span>
                            <span className="block text-xs">
                              {rp.name}
                              {rp.isNegotiated && <Badge variant="outline" className="ml-1.5 bg-warning-muted text-warning border-warning/30 text-[10px]">Negotiated</Badge>}
                            </span>
                          </td>
                          {gridData.roomTypes.map(rt => {
                            const cell = gridData.grid[rp.id]?.[rt.id]
                            const soldOut = rt.minAvailable !== null && rt.minAvailable <= 0
                            const active = form.assignments[Math.min(activeSegmentIndex, form.assignments.length - 1)]
                            const selected = active?.roomTypeId === rt.id && active?.ratePlanId === rp.id
                            return (
                              <td key={rt.id} className="px-1.5 py-1.5 text-center">
                                <button
                                  type="button"
                                  disabled={soldOut}
                                  onClick={() => selectGridCell(rt.id, rp.id)}
                                  className={`w-full rounded-md border px-2 py-2 font-medium transition-colors ${
                                    soldOut
                                      ? "border-border text-muted-foreground/50 line-through cursor-not-allowed"
                                      : selected
                                      ? "border-info bg-info-muted text-info"
                                      : "border-border hover:border-foreground/40"
                                  }`}
                                >
                                  {cell ? (
                                    <>
                                      ${cell.avgNightly.toFixed(2)}
                                      {cell.unpricedNights > 0 && <span className="text-warning" title={`${cell.unpricedNights} night(s) have no rate configured`}>*</span>}
                                    </>
                                  ) : (
                                    <span className="font-normal italic text-muted-foreground">No rate</span>
                                  )}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {form.assignments.map((assignment, index) => {
                const rt = roomTypes.find(r => r.id === assignment.roomTypeId)
                const rp = ratePlans.find(r => r.id === assignment.ratePlanId)
                const isActive = index === Math.min(activeSegmentIndex, form.assignments.length - 1)
                return (
                  <div
                    key={index}
                    onClick={() => setActiveSegmentIndex(index)}
                    className={`flex flex-col gap-3 p-3 border rounded-md bg-muted shadow-sm ${form.assignments.length > 1 ? "cursor-pointer" : ""} ${isActive && form.assignments.length > 1 ? "ring-2 ring-info/50" : ""}`}
                  >
                    <div className="text-sm flex justify-between items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground shrink-0">
                        {form.assignments.length > 1 ? `Segment ${index + 1}` : "Selection"}
                      </span>
                      <span className="flex-1 text-muted-foreground">
                        {rt && rp
                          ? <>{rt.name} ({rt.code}) · {rp.name}</>
                          : <span className="italic">Pick a room &amp; rate from the grid above</span>}
                      </span>
                      {form.assignments.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-destructive hover:bg-destructive-muted hover:text-destructive" onClick={(e) => {
                          e.stopPropagation();
                          const newAssignments = [...form.assignments];
                          newAssignments.splice(index, 1);
                          setActiveSegmentIndex(i => Math.min(i, newAssignments.length - 1));
                          setForm(p => ({ ...p, assignments: newAssignments }));
                        }}>
                          <Trash2 className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                    {scheduledRoomMoveAt(index) && (
                      <span className="inline-flex w-max items-center gap-1.5 rounded-md bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning/20">
                        Scheduled Room Move — different room than Segment {index}
                      </span>
                    )}
                    {form.assignments.length > 1 && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>From <span className="text-destructive">*</span></Label>
                          <DatePicker
                            value={assignment.startDate}
                            disabled={index > 0}
                            onChange={v => {
                              if (index > 0) return; // locked — derived from the previous segment's departure
                              const newAssignments = [...form.assignments];
                              // Same hard rule as the top-level Arrival/Departure: moving
                              // this segment's start past its own end clears the now-invalid end.
                              const stillValid = newAssignments[index].endDate && v < newAssignments[index].endDate;
                              newAssignments[index] = { ...newAssignments[index], startDate: v, ...(stillValid ? {} : { endDate: "" }) };
                              setForm(p => ({ ...p, assignments: newAssignments }));
                            }}
                          />
                          {index > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              Locked to Segment {index}&apos;s departure — no gaps allowed between segments.
                            </p>
                          )}
                        </div>
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-2">
                            To <span className="text-destructive">*</span>
                            {assignment.startDate && assignment.endDate && (
                              <span className="text-[10px] font-semibold bg-muted text-foreground px-2 py-0.5 rounded-none">
                                {nightsBetween(assignment.startDate, assignment.endDate)} Nights
                              </span>
                            )}
                          </Label>
                          <DatePicker
                            value={assignment.endDate}
                            minDate={assignment.startDate ? dayAfter(assignment.startDate) : undefined}
                            onChange={v => {
                              const newAssignments = [...form.assignments];
                              newAssignments[index] = { ...newAssignments[index], endDate: v };
                              setForm(p => ({ ...p, assignments: newAssignments, ...(index === form.assignments.length - 1 ? { checkOutDate: v } : {}) }));
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>Room Assignment</Label>
                        <SearchableSelect
                          value={assignment.roomId}
                          onChange={(v) => {
                            const newAssignments = [...form.assignments];
                            newAssignments[index] = { ...newAssignments[index], roomId: v };
                            setForm(p => ({ ...p, assignments: newAssignments }));
                          }}
                          placeholder="Unassigned"
                          options={[
                            { value: "none", label: "Unassigned" },
                            ...rooms.filter(rm => rm.roomTypeId === assignment.roomTypeId).map(rm => ({
                              value: rm.id,
                              label: `Room ${rm.roomNumber}`
                            }))
                          ]}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>Flat Override Rate</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Optional override"
                          value={assignment.overrideRate}
                          onChange={e => {
                            const newAssignments = [...form.assignments];
                            newAssignments[index] = { ...newAssignments[index], overrideRate: e.target.value };
                            setForm(p => ({ ...p, assignments: newAssignments }));
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}

              {uniqueCapacityIssues.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive-muted p-3 flex flex-col gap-2">
                  <p className="text-sm text-destructive font-medium">
                    {totalOccupants} guest{totalOccupants === 1 ? "" : "s"} exceeds the max occupancy for{" "}
                    {uniqueCapacityIssues.map((c, i) => (
                      <span key={c.roomTypeName}>
                        {i > 0 && ", "}
                        {c.roomTypeName} (max {c.maxOccupancy})
                      </span>
                    ))}.
                  </p>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={form.acknowledgeOverCapacity}
                      onCheckedChange={(checked) => setForm(p => ({ ...p, acknowledgeOverCapacity: !!checked }))}
                    />
                    I understand and want to book this anyway.
                  </label>
                </div>
              )}

              <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => {
                const lastAssignment = form.assignments[form.assignments.length - 1];
                setForm(p => ({
                  ...p,
                  assignments: [...p.assignments, {
                    roomTypeId: "", roomId: "none", ratePlanId: "", overrideRate: "",
                    startDate: lastAssignment.endDate || "", endDate: "",
                  }]
                }));
                setActiveSegmentIndex(form.assignments.length);
              }}>
                <Plus className="h-4 w-4 mr-2" /> Add Segment (Split Stay)
              </Button>
            </CardContent>
          </Card>

          {/* ── 3 · Guest & details ──────────────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle className="text-lg">3 · Guest &amp; Details</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Primary Guest <span className="text-destructive">*</span></Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 border rounded-md px-3 h-9 text-sm bg-background flex items-center overflow-hidden">
                      {(() => {
                        const prof = profiles.find(p => p.upid === form.primaryGuestId)
                        return prof ? (
                          <span className="inline-flex items-center gap-1.5 truncate">
                            {prof.firstName} {prof.lastName || ''}
                            {prof.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                          </span>
                        ) : <span className="text-muted-foreground">No guest selected</span>
                      })()}
                    </div>
                    <Button type="button" variant="outline" onClick={() => setGuestPickerOpen("primary")}>
                      {form.primaryGuestId ? "Change" : "Select..."}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Meal Plan</Label>
                  <Select value={form.mealPlan} onValueChange={(v) => setForm(p => ({ ...p, mealPlan: v ?? "NONE" }))}>
                    <SelectTrigger>
                      <SelectValue>
                        {form.mealPlan === "NONE" ? "Room Only" : (mealPlans.find(mp => mp.code === form.mealPlan)?.name || form.mealPlan)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Room Only</SelectItem>
                      {mealPlans.filter(mp => mp.isActive).map(mp => (
                        <SelectItem key={mp.id} value={mp.code}>{mp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2 p-4 bg-muted border rounded-md">
                <Label className="flex items-center justify-between">
                  <span>Accompanying Guests</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {form.accompanyingGuestIds.length} / {maxAccompanying} pax
                  </span>
                </Label>
                {form.accompanyingGuestIds.length >= maxAccompanying ? (
                  <p className="text-xs text-muted-foreground italic">
                    Max reached — {form.adults} adult{form.adults === 1 ? "" : "s"}{form.children > 0 ? ` + ${form.children} child${form.children === 1 ? "" : "ren"}` : ""} allows
                    up to {maxAccompanying} accompanying guest{maxAccompanying === 1 ? "" : "s"} (the primary guest fills one pax). Increase Adults/Children in Section 1 to attach more.
                  </p>
                ) : (
                  <Button type="button" variant="outline" className="border-dashed w-full" onClick={() => setGuestPickerOpen("accompanying")}>
                    <Plus className="h-4 w-4 mr-2" /> Add an accompanying guest...
                  </Button>
                )}
                {form.accompanyingGuestIds.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {form.accompanyingGuestIds.map(gid => {
                      const prof = profiles.find(p => p.upid === gid)
                      if (!prof) return null;
                      const name = prof.profileType === 'COMPANY' || prof.profileType === 'TRAVEL_AGENT'
                        ? prof.companyName
                        : `${prof.firstName} ${prof.lastName || ''}`.trim();
                      return (
                        <div key={gid} className="flex justify-between items-center bg-card px-3 py-2 rounded border text-sm shadow-sm">
                          <span className="inline-flex items-center gap-1.5">
                            {name}
                            {prof.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                          </span>
                          <Button
                            type="button" variant="ghost" size="sm"
                            className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive-muted"
                            onClick={() => setForm(p => ({ ...p, accompanyingGuestIds: p.accompanyingGuestIds.filter(id => id !== gid) }))}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {specialRequestOptions.length > 0 && (
                <div className="grid gap-2">
                  <Label>Special Requests</Label>
                  <div className="flex flex-wrap gap-2">
                    {specialRequestOptions.map(opt => {
                      const selected = form.specialRequestCodes.includes(opt.code)
                      return (
                        <button
                          type="button" key={opt.code}
                          onClick={() => setForm(p => ({
                            ...p,
                            specialRequestCodes: selected
                              ? p.specialRequestCodes.filter(c => c !== opt.code)
                              : [...p.specialRequestCodes, opt.code],
                          }))}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                            selected
                              ? "border-info text-info bg-info-muted font-medium"
                              : "border-border text-muted-foreground hover:border-foreground/40"
                          }`}
                        >
                          {opt.value}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label>Remarks</Label>
                <Textarea
                  value={form.remarks}
                  onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))}
                  placeholder="e.g. Honeymoon — high floor requested"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── 4 · Allocations & Add-ons ─────────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle className="text-lg">4 · Allocations &amp; Add-ons</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              {autoAllocationIds.length > 0 && (
                <div className="rounded-md border p-3 bg-muted/40">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Included via rate plan / meal plan</p>
                  <div className="flex flex-col gap-1.5">
                    {autoAllocationIds.map(id => {
                      const a = allocations.find(al => al.id === id)
                      if (!a) return null
                      const total = allocationPreviewTotal(a)
                      return (
                        <div key={id} className="flex items-center justify-between text-sm">
                          <span>
                            <span className="font-mono font-medium">{a.code}</span> — {a.name}
                            <Badge variant="outline" className="ml-2 text-xs">
                              {a.mode === "INCLUDE_IN_RATE" ? "in rate" : "added to rate"}
                            </Badge>
                          </span>
                          {total != null && <span className="font-mono text-muted-foreground">{money(total)}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const addOnOptions = allocations.filter(a => a.isActive && a.sellSeparate && !autoAllocationIds.includes(a.id))
                if (addOnOptions.length === 0) return (
                  <p className="text-xs text-muted-foreground italic">No sell-separate add-ons available for this property.</p>
                )
                return (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Add-ons (sold separately, posted nightly by Night Audit)</p>
                    <div className="flex flex-col gap-1.5">
                      {addOnOptions.map(a => {
                        const total = allocationPreviewTotal(a)
                        return (
                          <label key={a.id} className="flex items-center justify-between cursor-pointer text-sm">
                            <span className="flex items-center gap-2">
                              <Checkbox
                                checked={form.manualAllocationIds.includes(a.id)}
                                onCheckedChange={(checked) =>
                                  setForm(p => ({
                                    ...p,
                                    manualAllocationIds: checked
                                      ? [...p.manualAllocationIds, a.id]
                                      : p.manualAllocationIds.filter(x => x !== a.id),
                                  }))
                                }
                              />
                              <span><span className="font-mono font-medium">{a.code}</span> — {a.name}</span>
                            </span>
                            {total != null && form.manualAllocationIds.includes(a.id) && (
                              <span className="font-mono text-muted-foreground">{money(total)}</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </div>

        {/* ── Sticky Booking Summary sidebar ──────────────────────────────── */}
        <div className="lg:sticky lg:top-4 flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Booking Summary</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              {form.checkInDate && form.checkOutDate && (
                <div className="text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Stay</span><span>{format(new Date(form.checkInDate), "dd MMM")} – {format(new Date(form.checkOutDate), "dd MMM yyyy")}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Occupancy</span><span>{form.adults} adult{form.adults === 1 ? "" : "s"}{form.children > 0 ? `, ${form.children} child${form.children === 1 ? "" : "ren"}` : ""}{form.infants > 0 ? `, ${form.infants} infant${form.infants === 1 ? "" : "s"}` : ""}</span></div>
                </div>
              )}

              {!quote ? (
                <p className="text-xs text-muted-foreground italic">
                  {quoteLoading ? "Calculating..." : "Pick a room & rate to see the estimated total."}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5 text-sm border-t pt-3">
                    {quote.segments.map((seg, i) => {
                      const rt = roomTypes.find(r => r.id === seg.roomTypeId)
                      const rp = ratePlans.find(r => r.id === seg.ratePlanId)
                      return (
                        <div key={i} className="flex justify-between">
                          <span className="text-muted-foreground">
                            {rt?.code ?? "Room"} · {rp?.code ?? "Rate"} × {seg.nights}n
                            {seg.unpricedNights > 0 && <span className="text-warning" title={`${seg.unpricedNights} night(s) unpriced`}>*</span>}
                          </span>
                          <span className="font-mono">{money(seg.roomBase)}</span>
                        </div>
                      )
                    })}
                    {quote.totals.extraOccupancyBase > 0.005 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Extra occupancy</span>
                        <span className="font-mono">{money(quote.totals.extraOccupancyBase)}</span>
                      </div>
                    )}
                  </div>

                  {quote.allocations.length > 0 && (
                    <div className="flex flex-col gap-2 text-sm border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">Allocations</p>
                      {quote.allocations.map(a => (
                        <div key={a.allocationId} className="flex flex-col gap-0.5">
                          <div className="flex justify-between">
                            <span><span className="font-mono text-xs">{a.code}</span> {a.name}</span>
                            <span className="font-mono">{money(a.base)}</span>
                          </div>
                          {a.breakdown.segments.map((seg, i) => (
                            <p key={i} className="text-[11px] text-muted-foreground pl-1">
                              {form.adults} adult{form.adults === 1 ? "" : "s"} {PIPE} {money(seg.adultPrice)}
                              {form.children > 0 && <> + {form.children} child{form.children === 1 ? "" : "ren"} {PIPE} {money(seg.childPrice)}</>}
                              {" = "}{money(seg.amountPerNight)}/night {PIPE} {seg.nights} night{seg.nights === 1 ? "" : "s"} ({RHYTHM_LABEL[a.breakdown.postingRhythm] ?? a.breakdown.postingRhythm}) = {money(seg.subtotal)}
                            </p>
                          ))}
                          {a.breakdown.unpricedNights > 0 && (
                            <p className="text-[11px] text-warning pl-1">{a.breakdown.unpricedNights} qualifying night(s) had no rate configured — not charged.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-1 text-sm border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Taxes &amp; charges {quote.pricesIncludeTaxes && <span className="italic">(included in prices above)</span>}</p>
                    {quote.taxLines.map(line => (
                      <div key={line.name} className="flex justify-between">
                        <span className="text-muted-foreground">{line.name} ({line.ratePercent}%{line.calculateOn === "COMPOUND" ? ", compound" : ""})</span>
                        <span className="font-mono">{money(line.amount)}</span>
                      </div>
                    ))}
                    {quote.greenTax.enabled && quote.greenTax.total > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Green Tax ({quote.greenTax.adults}×{money(quote.greenTax.perAdultAmount)}{quote.greenTax.children > 0 ? ` + ${quote.greenTax.children}×${money(quote.greenTax.perChildAmount)}` : ""} × {quote.greenTax.nights}n)
                        </span>
                        <span className="font-mono">{money(quote.greenTax.total)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-baseline border-t pt-3">
                    <span className="font-semibold">Grand Total</span>
                    <span className="font-mono font-bold text-lg">{money(quote.totals.grandTotal)}</span>
                  </div>

                  {quote.warnings.length > 0 && (
                    <div className="text-[11px] text-warning flex flex-col gap-0.5 border-t pt-2">
                      {quote.warnings.map((w, i) => <p key={i}>{w}</p>)}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => router.push(`/e/${slug}/dashboard/reservations`)}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {submitting ? "Saving..." : isEditMode ? "Save Changes" : "Book Now"}
            </Button>
          </div>
        </div>
      </div>

      <GuestPickerModal
        isOpen={guestPickerOpen !== null}
        onClose={() => setGuestPickerOpen(null)}
        enterpriseId={enterpriseId}
        title={guestPickerOpen === "primary" ? "Select Primary Guest" : "Add Accompanying Guest"}
        excludeIds={guestPickerOpen === "primary" ? [] : [form.primaryGuestId, ...form.accompanyingGuestIds].filter(Boolean)}
        onSelect={(profile: GuestProfile) => {
          setProfiles(prev => prev.some(p => p.upid === profile.upid) ? prev : [profile, ...prev])
          if (guestPickerOpen === "primary") {
            setForm(p => ({ ...p, primaryGuestId: profile.upid }))
          } else if (guestPickerOpen === "accompanying") {
            setForm(p => (!p.accompanyingGuestIds.includes(profile.upid) && p.accompanyingGuestIds.length < maxAccompanying)
              ? { ...p, accompanyingGuestIds: [...p.accompanyingGuestIds, profile.upid] }
              : p)
          }
        }}
      />
    </form>
  )
}
