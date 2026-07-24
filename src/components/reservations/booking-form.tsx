"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { useForm, type Resolver, type Path, type PathValue } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus, Trash2, Star, ArrowLeft, Save, Loader2 } from "@/components/icons"
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
import { bookingFormSchema, emptyBookingValues, emptySegment, type BookingFormValues, type SegmentValues } from "@/components/reservations/booking-form-schema"
import { LookToBookGrid, type GridData } from "@/components/reservations/look-to-book-grid"
import { BookingSummary, type Quote } from "@/components/reservations/booking-summary"

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

const money = (n: number) => `$${n.toFixed(2)}`

const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="text-xs text-destructive font-medium">{message}</p> : null

// Rebuilt onto Zod + React Hook Form (APP STANDARD 001): the schema in
// booking-form-schema.ts owns every form-shape rule with inline, real-time
// errors; this component keeps the booking machinery (Look-to-Book grid,
// server quote, segment chaining) reading from the watched values.
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

  const formCtl = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema) as Resolver<BookingFormValues>,
    mode: "onChange",
    defaultValues: emptyBookingValues(),
  })
  // Watched values keep the derived machinery (grid, quote, previews) reactive
  // exactly like the old useState did — `form` reads the same in the JSX below.
  const form = formCtl.watch()
  const { errors } = formCtl.formState
  const setField = <K extends Path<BookingFormValues>>(name: K, value: PathValue<BookingFormValues, K>) =>
    formCtl.setValue(name, value, { shouldValidate: true, shouldDirty: true })

  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [guestPickerOpen, setGuestPickerOpen] = useState<null | "primary" | "accompanying">(null)
  const [gridData, setGridData] = useState<GridData | null>(null)
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
        formCtl.reset({
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
          })) : [emptySegment()],
        })
        setActiveSegmentIndex(0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId])

  const setAssignments = (assignments: SegmentValues[]) => setField("assignments", assignments)
  const updateAssignment = (index: number, patch: Partial<SegmentValues>) => {
    const next = [...formCtl.getValues("assignments")]
    next[index] = { ...next[index], ...patch }
    setAssignments(next)
  }

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
    const assignments = [...formCtl.getValues("assignments")]
    const checkOutDate = formCtl.getValues("checkOutDate")
    if (which === "in" && assignments.length > 0) {
      assignments[0] = { ...assignments[0], startDate: v }
      const stillValid = checkOutDate && v < checkOutDate
      if (!stillValid) {
        const last = assignments.length - 1
        assignments[last] = { ...assignments[last], endDate: "" }
      }
      setField("checkInDate", v)
      setField("checkOutDate", stillValid ? checkOutDate : "")
      setAssignments(assignments)
      return
    }
    if (which === "out" && assignments.length > 0) {
      const last = assignments.length - 1
      assignments[last] = { ...assignments[last], endDate: v }
      setField("checkOutDate", v)
      setAssignments(assignments)
    }
  }

  const selectGridCell = (roomTypeId: string, ratePlanId: string) => {
    const i = Math.min(activeSegmentIndex, formCtl.getValues("assignments").length - 1)
    updateAssignment(i, { roomTypeId, ratePlanId, roomId: "none" })
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
    if (formCtl.getValues("acknowledgeOverCapacity")) setField("acknowledgeOverCapacity", false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalOccupants, JSON.stringify(form.assignments.map(a => a.roomTypeId))])

  // Hard rule: split-stay segments must run back-to-back with no gaps — segment N's
  // arrival is locked to segment N-1's departure (see the disabled "From" picker
  // below) rather than left independently editable. This cascades forward whenever an
  // earlier segment's departure changes (edit, add, or remove a segment), and keeps
  // the top-level Arrival/Departure fields mirroring the chain's two endpoints.
  useEffect(() => {
    const current = formCtl.getValues("assignments")
    let changed = false
    const next = current.map((a, i) => {
      if (i === 0) return a
      const prevEnd = current[i - 1].endDate
      if (prevEnd && a.startDate !== prevEnd) {
        changed = true
        const keepEnd = a.endDate && a.endDate > prevEnd
        return { ...a, startDate: prevEnd, ...(keepEnd ? {} : { endDate: "" }) }
      }
      return a
    })
    const newCheckIn = next[0]?.startDate || ""
    const newCheckOut = next[next.length - 1]?.endDate || ""
    if (!changed && newCheckIn === formCtl.getValues("checkInDate") && newCheckOut === formCtl.getValues("checkOutDate")) return
    if (changed) setAssignments(next)
    setField("checkInDate", newCheckIn)
    setField("checkOutDate", newCheckOut)
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

  // Zod owns every form-shape rule; only the max-occupancy acknowledgement (needs
  // room-type lookup data) is checked here before building the payload.
  const onValid = async (values: BookingFormValues) => {
    if (uniqueCapacityIssues.length > 0 && !values.acknowledgeOverCapacity) {
      setNotification({ title: "Occupancy Exceeds Maximum", message: "Check the override box in Room & Rate to confirm this booking anyway." })
      return
    }
    setSubmitting(true)
    try {
      const dates = values.assignments.flatMap(a => [new Date(a.startDate).getTime(), new Date(a.endDate).getTime()])
      const minDate = new Date(Math.min(...dates))
      const maxDate = new Date(Math.max(...dates))

      const payload = {
        ...values,
        propertyId,
        checkInDate: minDate.toISOString(),
        checkOutDate: maxDate.toISOString(),
        travelAgentId: values.travelAgentId === "none" ? null : values.travelAgentId,
        assignments: values.assignments.map(a => ({
          roomTypeId: a.roomTypeId,
          roomId: a.roomId && a.roomId !== "none" ? a.roomId : null,
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
        setNotification({ title: "Error", message: err.error || "Failed to save the booking." })
        setSubmitting(false)
      }
    } catch (err) {
      setNotification({ title: "Error", message: "An unexpected error occurred." })
      setSubmitting(false)
    }
  }

  const onInvalid = () => {
    setNotification({ title: "Validation Error", message: "Fix the highlighted fields before saving." })
  }

  const segmentErrors = errors.assignments as
    | (undefined | { roomTypeId?: { message?: string }; ratePlanId?: { message?: string }; startDate?: { message?: string }; endDate?: { message?: string }; overrideRate?: { message?: string } })[]
    | undefined

  if (loading) {
    return (
      <div className="flex flex-col gap-6 max-w-6xl mx-auto p-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    )
  }

  return (
    <form onSubmit={formCtl.handleSubmit(onValid, onInvalid)} className="flex flex-col gap-6 max-w-7xl mx-auto p-4 pb-16">
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
                  <FieldError message={errors.checkInDate?.message} />
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
                  <FieldError message={errors.checkOutDate?.message} />
                </div>
                <div className="grid gap-2">
                  <Label>Adults</Label>
                  <Input type="number" min="1" value={form.adults} onChange={e => setField("adults", parseInt(e.target.value) || 1)} />
                  <FieldError message={errors.adults?.message} />
                </div>
                <div className="grid gap-2">
                  <Label>Children</Label>
                  <Input type="number" min="0" value={form.children} onChange={e => setField("children", parseInt(e.target.value) || 0)} />
                </div>
                <div className="grid gap-2">
                  <Label>Infants</Label>
                  <Input type="number" min="0" value={form.infants} onChange={e => setField("infants", parseInt(e.target.value) || 0)} />
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
                  onChange={(v) => setField("travelAgentId", v)}
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
                <LookToBookGrid
                  gridData={gridData}
                  visibleRatePlans={visibleGridRatePlans}
                  selectedRoomTypeId={form.assignments[Math.min(activeSegmentIndex, form.assignments.length - 1)]?.roomTypeId}
                  selectedRatePlanId={form.assignments[Math.min(activeSegmentIndex, form.assignments.length - 1)]?.ratePlanId}
                  onSelect={selectGridCell}
                />
              ) : null}

              {form.assignments.map((assignment, index) => {
                const rt = roomTypes.find(r => r.id === assignment.roomTypeId)
                const rp = ratePlans.find(r => r.id === assignment.ratePlanId)
                const isActive = index === Math.min(activeSegmentIndex, form.assignments.length - 1)
                const segErr = segmentErrors?.[index]
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
                          const newAssignments = [...formCtl.getValues("assignments")];
                          newAssignments.splice(index, 1);
                          setActiveSegmentIndex(i => Math.min(i, newAssignments.length - 1));
                          setAssignments(newAssignments);
                        }}>
                          <Trash2 className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                    {(segErr?.roomTypeId?.message || segErr?.ratePlanId?.message) && (
                      <FieldError message={segErr.roomTypeId?.message || segErr.ratePlanId?.message} />
                    )}
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
                              // Same hard rule as the top-level Arrival/Departure: moving
                              // this segment's start past its own end clears the now-invalid end.
                              const current = formCtl.getValues("assignments")[index];
                              const stillValid = current.endDate && v < current.endDate;
                              updateAssignment(index, { startDate: v, ...(stillValid ? {} : { endDate: "" }) });
                            }}
                          />
                          <FieldError message={segErr?.startDate?.message} />
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
                              updateAssignment(index, { endDate: v });
                              if (index === formCtl.getValues("assignments").length - 1) setField("checkOutDate", v);
                            }}
                          />
                          <FieldError message={segErr?.endDate?.message} />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>Room Assignment</Label>
                        <SearchableSelect
                          value={assignment.roomId}
                          onChange={(v) => updateAssignment(index, { roomId: v })}
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
                          onChange={e => updateAssignment(index, { overrideRate: e.target.value })}
                        />
                        <FieldError message={segErr?.overrideRate?.message} />
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
                      onCheckedChange={(checked) => setField("acknowledgeOverCapacity", !!checked)}
                    />
                    I understand and want to book this anyway.
                  </label>
                </div>
              )}

              <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => {
                const current = formCtl.getValues("assignments");
                const lastAssignment = current[current.length - 1];
                setAssignments([...current, { ...emptySegment(), startDate: lastAssignment.endDate || "" }]);
                setActiveSegmentIndex(current.length);
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
                  <FieldError message={errors.primaryGuestId?.message} />
                </div>
                <div className="grid gap-2">
                  <Label>Meal Plan</Label>
                  <Select value={form.mealPlan} onValueChange={(v) => setField("mealPlan", v ?? "NONE")}>
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
                <FieldError message={errors.accompanyingGuestIds?.message} />
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
                            onClick={() => setField("accompanyingGuestIds", formCtl.getValues("accompanyingGuestIds").filter(id => id !== gid))}
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
                          onClick={() => {
                            const current = formCtl.getValues("specialRequestCodes")
                            setField("specialRequestCodes", selected ? current.filter(c => c !== opt.code) : [...current, opt.code])
                          }}
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
                  onChange={e => setField("remarks", e.target.value)}
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
                                onCheckedChange={(checked) => {
                                  const current = formCtl.getValues("manualAllocationIds")
                                  setField("manualAllocationIds", checked ? [...current, a.id] : current.filter(x => x !== a.id))
                                }}
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
          <BookingSummary
            checkInDate={form.checkInDate}
            checkOutDate={form.checkOutDate}
            adults={form.adults}
            children={form.children}
            infants={form.infants}
            quote={quote}
            quoteLoading={quoteLoading}
            roomTypes={roomTypes}
            ratePlans={ratePlans}
          />

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
            setField("primaryGuestId", profile.upid)
          } else if (guestPickerOpen === "accompanying") {
            const current = formCtl.getValues("accompanyingGuestIds")
            if (!current.includes(profile.upid) && current.length < maxAccompanying) {
              setField("accompanyingGuestIds", [...current, profile.upid])
            }
          }
        }}
      />
    </form>
  )
}
