"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { ChevronDown, Search } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { OptionSelect } from "@/components/ui/option-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { SubmitButton } from "@/components/ui/submit-button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { INPUT_INTEGER } from "@/lib/input-presets"
import { toast } from "@/lib/toast"
import { HHMM } from "@/lib/transport/constants"
import { cn } from "@/lib/utils"
import { api, GroupTag, money, type BookingView, type Staff, type TransportConfig } from "@/components/transport/shared"

// Create or edit a transport booking (APP STANDARD 001: Zod + React Hook Form, errors as
// you type). Progressive: the guest and the trip first; the flight only when the route or
// transport type needs one; provider/driver/seat notes behind "More details". The price
// comes from the route's rate (live quote, tax included) and can be set by hand only with
// the billing permission and a reason.

type ReservationHit = {
  id: string
  confirmationNo: string
  guestName: string | null
  checkInDate: string
  checkOutDate: string
  status: string
  adults: number
  children: number
  infants: number
  groupBlock: { id: string; code: string; name: string } | null
  roomNumber: string | null
}

type Quote = {
  amount: number | null
  billable: boolean
  priceOverridden: boolean
  rate: { id: string; name: string | null; pricingBasis: string; childMinAge: number; childMaxAge: number } | null
  preview: { grandTotal: number; tax: number; serviceCharge: number } | null
}

const count = z.string().refine((v) => /^\d+$/.test(v) && Number(v) <= 200, "0–200")
const time = z.string().refine((v) => v === "" || HHMM.test(v), "HH:MM")

const schema = z
  .object({
    mode: z.enum(["reservation", "standalone"]),
    reservationId: z.string(),
    guestName: z.string().max(120),
    guestContact: z.string().max(80),
    direction: z.enum(["PICKUP", "DROP_OFF"]),
    serviceDate: z.string().min(1, "Choose the date"),
    adults: count,
    children: count,
    infants: count,
    routeId: z.string(),
    transportTypeId: z.string(),
    departureTime: time,
    airline: z.string().max(60),
    flightNo: z.string().max(12),
    flightDate: z.string(),
    flightTime: time,
    terminal: z.string().max(20),
    airportRepUserId: z.string(),
    meetingNotes: z.string().max(500),
    providerId: z.string(),
    vesselId: z.string(),
    driverName: z.string().max(80),
    driverContact: z.string().max(40),
    seatNote: z.string().max(120),
    vehicleCount: z.string().refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 50, "1–50"),
    notes: z.string().max(1000),
    override: z.boolean(),
    overrideAmount: z.string(),
    overrideReason: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "reservation" && !v.reservationId) ctx.addIssue({ code: "custom", path: ["reservationId"], message: "Find the reservation" })
    if (v.mode === "standalone" && v.guestName.trim().length < 2) ctx.addIssue({ code: "custom", path: ["guestName"], message: "Enter the traveller's name" })
    if (Number(v.adults) + Number(v.children) + Number(v.infants) < 1) ctx.addIssue({ code: "custom", path: ["adults"], message: "At least one passenger" })
    if (v.override) {
      if (!/^\d+(\.\d{1,2})?$/.test(v.overrideAmount)) ctx.addIssue({ code: "custom", path: ["overrideAmount"], message: "Enter an amount" })
      if (v.overrideReason.trim().length < 3) ctx.addIssue({ code: "custom", path: ["overrideReason"], message: "Give a reason" })
    }
  })
type Values = z.infer<typeof schema>

const empty = (date: string): Values => ({
  mode: "reservation",
  reservationId: "",
  guestName: "",
  guestContact: "",
  direction: "PICKUP",
  serviceDate: date,
  adults: "1",
  children: "0",
  infants: "0",
  routeId: "",
  transportTypeId: "",
  departureTime: "",
  airline: "",
  flightNo: "",
  flightDate: "",
  flightTime: "",
  terminal: "",
  airportRepUserId: "",
  meetingNotes: "",
  providerId: "",
  vesselId: "",
  driverName: "",
  driverContact: "",
  seatNote: "",
  vehicleCount: "1",
  notes: "",
  override: false,
  overrideAmount: "",
  overrideReason: "",
})

function fromBooking(b: BookingView): Values {
  return {
    mode: b.reservationId ? "reservation" : "standalone",
    reservationId: b.reservationId ?? "",
    guestName: b.guestName,
    guestContact: b.guestContact ?? "",
    direction: b.direction as Values["direction"],
    serviceDate: b.serviceDate,
    adults: String(b.adults),
    children: String(b.children),
    infants: String(b.infants),
    routeId: b.route?.id ?? "",
    transportTypeId: b.transportType?.id ?? "",
    departureTime: b.departureAt ? (b.manifest ? "" : (b.departureLocal?.time ?? "")) : "",
    airline: b.airline ?? "",
    flightNo: b.flightNo ?? "",
    flightDate: b.flightLocal?.dateKey ?? "",
    flightTime: b.flightLocal?.time ?? "",
    terminal: b.terminal ?? "",
    airportRepUserId: b.airportRep?.id ?? "",
    meetingNotes: b.meetingNotes ?? "",
    providerId: "",
    vesselId: "",
    driverName: "",
    driverContact: "",
    seatNote: b.seatNote ?? "",
    vehicleCount: String(b.pricing.vehicleCount),
    notes: b.notes ?? "",
    override: b.pricing.priceOverridden,
    overrideAmount: b.pricing.priceOverridden && b.pricing.amount != null ? String(b.pricing.amount) : "",
    overrideReason: b.pricing.overrideReason ?? "",
  }
}

export type BookingPrefill = {
  reservation?: ReservationHit | { id: string; confirmationNo: string; guestName: string | null; checkInDate: string; checkOutDate: string; adults: number; children: number; infants: number; groupBlock: { id: string; code: string; name: string } | null }
  direction?: "PICKUP" | "DROP_OFF"
  date?: string
}

export function BookingFormDialog({
  open,
  onOpenChange,
  propertyId,
  config,
  staff,
  editing,
  prefill,
  canBill,
  defaultDate,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  config: TransportConfig | null
  staff: Staff[]
  editing: BookingView | null
  prefill?: BookingPrefill | null
  canBill: boolean
  defaultDate: string
  onSaved: (b: BookingView) => void
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: empty(defaultDate) })
  const [picked, setPicked] = useState<BookingPrefill["reservation"] | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ReservationHit[]>([])
  const [more, setMore] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const draftRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setServerError(null)
    setQuery("")
    setHits([])
    if (editing) {
      form.reset(fromBooking(editing))
      setPicked(editing.reservation ? { id: editing.reservation.id, confirmationNo: editing.reservation.confirmationNo, guestName: editing.guestName, checkInDate: editing.reservation.checkInDate, checkOutDate: editing.reservation.checkOutDate, adults: editing.adults, children: editing.children, infants: editing.infants, groupBlock: editing.groupBlock } : null)
      setMore(!!(editing.seatNote || editing.notes))
    } else {
      const base = empty(prefill?.date ?? defaultDate)
      const r = prefill?.reservation
      const direction = prefill?.direction ?? "PICKUP"
      setPicked(r ?? null)
      setMore(false)
      form.reset({
        ...base,
        direction,
        ...(r
          ? {
              reservationId: r.id,
              serviceDate: prefill?.date ?? (direction === "PICKUP" ? r.checkInDate : r.checkOutDate),
              adults: String(r.adults),
              children: String(r.children),
              infants: String(r.infants),
            }
          : {}),
      })
    }
  }, [open, editing, prefill, defaultDate, form])

  // Reservation search (this property's live reservations).
  useEffect(() => {
    if (!open || picked || form.getValues("mode") !== "reservation") return
    const t = setTimeout(() => {
      api<ReservationHit[]>(`/api/transport/reservations?propertyId=${propertyId}&q=${encodeURIComponent(query)}`)
        .then(setHits)
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, picked, propertyId, form])

  const v = form.watch()
  const route = config?.routes.find((r) => r.id === v.routeId) ?? null
  const type = config?.types.find((t) => t.id === (v.transportTypeId || route?.transportTypeId)) ?? null
  const needsFlight = route?.category === "AIRPORT_TRANSFER" || !!type?.requiresFlightDetails
  const vessels = useMemo(
    () => (config?.providers ?? []).flatMap((p) => p.vessels.filter((x) => x.isActive && (!v.providerId || x.providerId === v.providerId)).map((x) => ({ ...x, providerName: p.name }))),
    [config, v.providerId]
  )

  // Live quote: the rate that applies and its folio total (tax included).
  const quoteKey = JSON.stringify([v.routeId, v.direction, v.serviceDate, v.transportTypeId, v.providerId, v.adults, v.children, v.infants, v.vehicleCount, v.override, v.overrideAmount])
  useEffect(() => {
    if (!open || !v.routeId) {
      setQuote(null)
      return
    }
    const t = setTimeout(() => {
      api<Quote>(`/api/transport/quote?propertyId=${propertyId}`, {
        method: "POST",
        json: {
          routeId: v.routeId,
          direction: v.direction,
          serviceDate: v.serviceDate || undefined,
          transportTypeId: v.transportTypeId || null,
          providerId: v.providerId || null,
          adults: Number(v.adults) || 0,
          children: Number(v.children) || 0,
          infants: Number(v.infants) || 0,
          vehicleCount: Number(v.vehicleCount) || 1,
          ...(v.override && /^\d+(\.\d+)?$/.test(v.overrideAmount) ? { priceOverride: { amount: Number(v.overrideAmount), reason: "quote" } } : {}),
        },
      })
        .then(setQuote)
        .catch(() => setQuote(null))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, open, propertyId])

  const pickReservation = (r: ReservationHit) => {
    setPicked(r)
    const direction = form.getValues("direction")
    form.setValue("reservationId", r.id, { shouldValidate: true })
    form.setValue("serviceDate", direction === "PICKUP" ? r.checkInDate : r.checkOutDate)
    form.setValue("adults", String(r.adults))
    form.setValue("children", String(r.children))
    form.setValue("infants", String(r.infants))
  }

  const onSubmit = async (values: Values) => {
    setPending(true)
    setServerError(null)
    const payload: Record<string, unknown> = {
      direction: values.direction,
      serviceDate: values.serviceDate,
      adults: Number(values.adults),
      children: Number(values.children),
      infants: Number(values.infants),
      routeId: values.routeId || null,
      transportTypeId: values.transportTypeId || null,
      departureTime: values.departureTime || null,
      airline: values.airline || null,
      flightNo: values.flightNo || null,
      flightDate: values.flightTime ? values.flightDate || values.serviceDate : null,
      flightTime: values.flightTime || null,
      terminal: values.terminal || null,
      airportRepUserId: values.airportRepUserId || null,
      meetingNotes: values.meetingNotes || null,
      seatNote: values.seatNote || null,
      vehicleCount: Number(values.vehicleCount),
      notes: values.notes || null,
      guestContact: values.guestContact || null,
      ...(values.providerId ? { providerId: values.providerId } : {}),
      ...(values.vesselId ? { vesselId: values.vesselId } : {}),
      ...(values.driverName ? { driverName: values.driverName } : {}),
      ...(values.driverContact ? { driverContact: values.driverContact } : {}),
    }
    if (values.mode === "standalone") payload.guestName = values.guestName.trim()
    if (canBill) {
      if (values.override) payload.priceOverride = { amount: Number(values.overrideAmount), reason: values.overrideReason.trim() }
      else if (editing?.pricing.priceOverridden) payload.priceOverride = null
    }
    try {
      const saved = editing
        ? await api<BookingView>(`/api/transport/bookings/${editing.id}?propertyId=${propertyId}`, { method: "PATCH", json: payload })
        : await api<BookingView>(`/api/transport/bookings?propertyId=${propertyId}`, {
            method: "POST",
            json: { ...payload, reservationId: values.mode === "reservation" ? values.reservationId : null, status: draftRef.current ? "DRAFT" : "CONFIRMED" },
          })
      toast.success(editing ? "Transfer saved" : draftRef.current ? "Draft saved" : "Transfer booked")
      onOpenChange(false)
      onSaved(saved)
    } catch (e) {
      setServerError((e as Error).message)
    } finally {
      setPending(false)
      draftRef.current = false
    }
  }

  const text = (name: keyof Values, labelText: string, props: React.ComponentProps<typeof Input> = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{labelText}</FormLabel>
          <FormControl>
            <Input {...props} {...field} value={String(field.value ?? "")} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  const routeOptions = (config?.routes ?? [])
    .filter((r) => (r.isActive || r.id === v.routeId) && (r.direction === "BOTH" || r.direction === v.direction))
    .map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" mobile="fullscreen">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>{editing ? `Edit transfer ${editing.reference}` : "New transfer"}</DialogTitle>
              <DialogDescription>
                {editing ? "Changes to the route, date or party re-price an unposted transfer." : "One guest party, one direction. Add the return as its own transfer."}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-4">
              {/* Guest */}
              {!editing && (
                <Tabs
                  value={v.mode}
                  onValueChange={(m) => {
                    form.setValue("mode", m as Values["mode"], { shouldValidate: true })
                    if (m === "standalone") {
                      setPicked(null)
                      form.setValue("reservationId", "")
                    }
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="reservation">Reservation</TabsTrigger>
                    <TabsTrigger value="standalone">Traveller without a stay</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              {v.mode === "reservation" ? (
                picked ? (
                  <div className="flex items-center justify-between gap-3 border border-border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        {picked.guestName} <GroupTag group={picked.groupBlock} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {picked.confirmationNo} · {picked.checkInDate} → {picked.checkOutDate}
                      </div>
                    </div>
                    {!editing && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setPicked(null); form.setValue("reservationId", "", { shouldValidate: true }) }}>
                        Change
                      </Button>
                    )}
                  </div>
                ) : (
                  <FormField
                    control={form.control}
                    name="reservationId"
                    render={() => (
                      <FormItem>
                        <FormLabel>Reservation *</FormLabel>
                        <div className="relative">
                          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input className="pl-8" placeholder="Confirmation no., guest or group code" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="max-h-48 divide-y divide-border overflow-y-auto border border-border">
                          {hits.length === 0 ? (
                            <p className="p-3 text-sm text-muted-foreground">No reservations found.</p>
                          ) : (
                            hits.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => pickReservation(r)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                              >
                                <span className="min-w-0">
                                  <span className="font-medium">{r.guestName}</span> <GroupTag group={r.groupBlock} />
                                  <span className="block text-xs text-muted-foreground">
                                    {r.confirmationNo}
                                    {r.roomNumber ? ` · Room ${r.roomNumber}` : ""} · {r.checkInDate} → {r.checkOutDate}
                                  </span>
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">{r.adults + r.children + r.infants} pax</span>
                              </button>
                            ))
                          )}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {text("guestName", "Traveller name *", { placeholder: "Full name", autoComplete: "off" })}
                  {text("guestContact", "Contact", { placeholder: "+960 …", type: "tel" })}
                </div>
              )}

              {/* Trip */}
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="direction"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Direction *</FormLabel>
                      <FormControl>
                        <OptionSelect
                          value={field.value}
                          onChange={(d) => {
                            field.onChange(d)
                            if (picked && !editing) form.setValue("serviceDate", d === "PICKUP" ? picked.checkInDate : picked.checkOutDate)
                          }}
                          options={[
                            { value: "PICKUP", label: "Pickup (arrival)" },
                            { value: "DROP_OFF", label: "Drop-off (departure)" },
                          ]}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="serviceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date *</FormLabel>
                      <FormControl>
                        <DatePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-2">
                  {text("adults", "Adults", { ...INPUT_INTEGER, className: "px-2" })}
                  {text("children", "Children", { ...INPUT_INTEGER, className: "px-2" })}
                  {text("infants", "Infants", { ...INPUT_INTEGER, className: "px-2" })}
                </div>
              </div>
              {quote?.rate && quote.rate.pricingBasis === "PER_PERSON" && (
                <p className="-mt-3 text-xs text-muted-foreground">
                  Children are {quote.rate.childMinAge}–{quote.rate.childMaxAge}; younger are infants.
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="routeId"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Route</FormLabel>
                      <FormControl>
                        <OptionSelect
                          value={field.value}
                          onChange={(id) => {
                            field.onChange(id)
                            const r = config?.routes.find((x) => x.id === id)
                            if (r) form.setValue("transportTypeId", r.transportTypeId)
                          }}
                          options={routeOptions}
                          placeholder={routeOptions.length ? "Select route…" : "No routes — add them in the Hub"}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="departureTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Departure time</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      {route && route.departureSlots.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {route.departureSlots.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => form.setValue("departureTime", s, { shouldValidate: true })}
                              className={cn(
                                "border px-2 py-0.5 font-mono text-xs",
                                field.value === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Airport leg */}
              {needsFlight && (
                <fieldset className="grid gap-4 border border-border p-4 md:grid-cols-3">
                  <legend className="px-1 text-sm font-medium">Flight — {v.direction === "PICKUP" ? "arrival" : "departure"}</legend>
                  {text("flightNo", "Flight no.", { placeholder: "EK652", autoCapitalize: "characters" })}
                  {text("airline", "Airline", { placeholder: "Emirates" })}
                  {text("flightTime", v.direction === "PICKUP" ? "Lands (ETA)" : "Leaves (ETD)", { type: "time" })}
                  <FormField
                    control={form.control}
                    name="flightDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Flight date</FormLabel>
                        <FormControl>
                          <DatePicker value={field.value || v.serviceDate} onChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {text("terminal", "Terminal", { placeholder: "International" })}
                  <FormField
                    control={form.control}
                    name="airportRepUserId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Airport rep</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Not assigned"
                            options={[{ value: "", label: "Not assigned" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="meetingNotes"
                    render={({ field }) => (
                      <FormItem className="md:col-span-3">
                        <FormLabel>Meeting point / luggage</FormLabel>
                        <FormControl>
                          <Input placeholder="Arrivals hall, counter 3 · 4 bags, 1 surfboard" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </fieldset>
              )}

              {/* Onward details */}
              <div>
                <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1" onClick={() => setMore((m) => !m)} aria-expanded={more}>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} /> More details
                </Button>
                {more && (
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="providerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Provider</FormLabel>
                          <FormControl>
                            <OptionSelect
                              value={field.value}
                              onChange={(id) => {
                                field.onChange(id)
                                form.setValue("vesselId", "")
                              }}
                              options={[{ value: "", label: editing?.provider ? `Keep (${editing.provider.name})` : "From the departure" }, ...(config?.providers ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))]}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="vesselId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Vessel / vehicle</FormLabel>
                          <FormControl>
                            <OptionSelect
                              value={field.value}
                              onChange={field.onChange}
                              options={[{ value: "", label: editing?.vessel ? `Keep (${editing.vessel.name})` : "From the departure" }, ...vessels.map((x) => ({ value: x.id, label: `${x.name} (${x.capacity} seats)` }))]}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    {text("vehicleCount", "Vehicles", { ...INPUT_INTEGER })}
                    {text("driverName", "Driver / captain / pilot", { placeholder: editing?.driverName ?? "" })}
                    {text("driverContact", "Their contact", { type: "tel", placeholder: editing?.driverContact ?? "" })}
                    {text("seatNote", "Seat / reference note", { placeholder: "Informational only" })}
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem className="md:col-span-3">
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea rows={2} {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>

              {/* Price */}
              <div className="border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Label className="text-sm font-medium">Price</Label>
                  <span className="text-sm">
                    {!v.routeId ? (
                      <span className="text-muted-foreground">Choose a route to see the price</span>
                    ) : !quote ? (
                      <span className="text-muted-foreground">…</span>
                    ) : quote.amount == null ? (
                      <span className="text-muted-foreground">Complimentary — no rate for this route</span>
                    ) : (
                      <>
                        <span className="font-mono font-semibold">{money(quote.preview?.grandTotal ?? quote.amount)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          {quote.preview ? "incl. tax" : ""}
                          {quote.priceOverridden ? " · set by hand" : quote.rate?.name ? ` · ${quote.rate.name}` : ""}
                          {!quote.billable && quote.amount > 0 ? " · not billed" : ""}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                {editing && ["POSTED", "WAIVED"].includes(editing.billing.status) ? (
                  <p className="mt-2 text-xs text-muted-foreground">The charge is {editing.billing.status === "POSTED" ? "posted" : "waived"} — the price can no longer change here.</p>
                ) : (
                  canBill && (
                    <div className="mt-3 grid gap-3">
                      <FormField
                        control={form.control}
                        name="override"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-3">
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="!mt-0 cursor-pointer font-normal">Set the price by hand</FormLabel>
                          </FormItem>
                        )}
                      />
                      {v.override && (
                        <div className="grid gap-3 md:grid-cols-3">
                          {text("overrideAmount", "Amount $", { inputMode: "decimal" })}
                          <div className="md:col-span-2">{text("overrideReason", "Reason *", { placeholder: "Returning guest, agreed with manager" })}</div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {!editing && (
                <Button type="submit" variant="outline" disabled={pending} onClick={() => (draftRef.current = true)}>
                  Save as draft
                </Button>
              )}
              <SubmitButton pending={pending}>{editing ? "Save" : "Book transfer"}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
