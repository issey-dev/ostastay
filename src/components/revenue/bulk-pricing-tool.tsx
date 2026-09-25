"use client"

import { useState, useEffect, useMemo } from "react"
import { AlertTriangle, CalendarDays, Save } from "@/components/icons"
import { differenceInCalendarDays, format } from "date-fns"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { MAX_PRICE_CALENDAR_RANGE_DAYS, MAX_PRICE_CALENDAR_RANGE_YEARS } from "@/lib/price-calendar"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

const currency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)

/** One line of the review panel — label left, value right, "Not set" while it is still blank. */
function SummaryRow({ label, value, hint }: { label: string; value?: string | null; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right", value ? "font-medium text-foreground" : "text-muted-foreground/70")}>
        {value ?? "Not set"}
        {value && hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}

export function BulkPricingTool({ propertyId }: { propertyId: string }) {
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Form State
  const [ratePlanId, setRatePlanId] = useState("")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [price, setPrice] = useState("")
  const [extraAdultPrice, setExtraAdultPrice] = useState("")
  const [extraChildPrice, setExtraChildPrice] = useState("")
  const [selectedRoomTypes, setSelectedRoomTypes] = useState<string[]>([])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [rpRes, rtRes] = await Promise.all([
          fetch(`/api/rate-plans?propertyId=${propertyId}`),
          fetch(`/api/room-types?propertyId=${propertyId}`)
        ])
        if (rpRes.ok) setRatePlans(await rpRes.json())
        if (rtRes.ok) setRoomTypes(await rtRes.json())
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [propertyId])

  // Derived plans are priced from their parent, and /api/price-calendar/bulk rejects them —
  // so they are not offered here either.
  const pushablePlans = useMemo(() => ratePlans.filter(rp => !rp.parentRatePlanId), [ratePlans])
  const selectedPlan = pushablePlans.find(rp => rp.id === ratePlanId)

  // The API writes one row per room type per day and counts the last day in (see the
  // inclusive loop in /api/price-calendar/bulk), so the season length is the difference + 1.
  const days =
    dateRange?.from && dateRange?.to ? differenceInCalendarDays(dateRange.to, dateRange.from) + 1 : 0
  const rangeTooLong = days > MAX_PRICE_CALENDAR_RANGE_DAYS
  const rowCount = days * selectedRoomTypes.length
  const parsedPrice = price === "" ? NaN : Number(price)

  const allSelected = roomTypes.length > 0 && selectedRoomTypes.length === roomTypes.length
  const someSelected = selectedRoomTypes.length > 0 && !allSelected

  // Whatever is still missing, in the order the form asks for it. Drives both the disabled
  // submit button and the line under it, so the button is never dead without saying why.
  const blocker =
    !ratePlanId ? "Choose a rate plan."
    : days < 1 ? "Pick the season's start and end dates."
    : rangeTooLong ? `A season can't be longer than ${MAX_PRICE_CALENDAR_RANGE_YEARS} years.`
    : !(parsedPrice >= 0) ? "Enter a daily price."
    : selectedRoomTypes.length === 0 ? "Select at least one room type."
    : null

  const handleSelectAllRooms = (checked: boolean) => {
    if (checked) {
      setSelectedRoomTypes(roomTypes.map(rt => rt.id))
    } else {
      setSelectedRoomTypes([])
    }
  }

  const handleRoomTypeToggle = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedRoomTypes(prev => [...prev, id])
    } else {
      setSelectedRoomTypes(prev => prev.filter(rtId => rtId !== id))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (blocker) {
      toast.error(blocker)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/price-calendar/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratePlanId,
          roomTypeIds: selectedRoomTypes,
          startDate: format(dateRange!.from!, "yyyy-MM-dd"),
          endDate: format(dateRange!.to!, "yyyy-MM-dd"),
          price,
          extraAdultPrice: extraAdultPrice === "" ? null : extraAdultPrice,
          extraChildPrice: extraChildPrice === "" ? null : extraChildPrice,
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.message)
        // Reset the season, keep the rate plan — pushing several seasons to the same plan
        // one after another is the common case.
        setDateRange(undefined)
        setPrice("")
        setExtraAdultPrice("")
        setExtraChildPrice("")
        setSelectedRoomTypes([])
      } else {
        toast.error(data.error || "Failed to push prices")
      }
    } catch (e) {
      console.error(e)
      toast.error("An error occurred")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading Configuration Tools...</div>
  }

  return (
    // The form itself is the grid: the fields fill the available width and the review panel
    // rides alongside them from xl up, instead of a narrow column stranded on a wide screen.
    // Below xl the panel drops underneath, which is still read-then-submit order.
    <>
    {/* Phones: a push overwrites days x room types of prices — desktop only. Each plan's
        price calendar (Rate Plans -> Price calendar) stays readable on a phone. */}
    <DesktopOnlyNotice
      feature="Rate seasons"
      description="Pushing a season's prices overwrites many days at once. Open this page on a computer to do it; each rate plan's price calendar is readable here."
    />
    <form onSubmit={handleSubmit} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] max-md:hidden">
      <Card>
        <CardHeader className="bg-muted/50 border-b border-border pb-4">
          <div className="flex items-center space-x-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Define a Rate Season</CardTitle>
          </div>
          <CardDescription>
            Push one nightly price across a date range and the room types you choose. Prices
            already set for those dates are overwritten.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-8">

            <section className="space-y-4">
              <h3 className="text-sm font-medium text-foreground border-b pb-2">1. Select Target Rate Plan</h3>
              <div className="max-w-md">
                <Select required value={ratePlanId} onValueChange={(val) => setRatePlanId(val ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a Rate Plan...">
                      {selectedPlan ? `${selectedPlan.name}${selectedPlan.isNegotiated ? " (Negotiated)" : ""}` : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {pushablePlans.map(rp => (
                      <SelectItem key={rp.id} value={rp.id}>
                        {rp.name} {rp.isNegotiated ? "(Negotiated)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-2">Derived rate plans aren&apos;t listed — their price is computed from their parent plan, not pushed directly. Edit the adjustment on the Rate Plans tab instead.</p>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-medium text-foreground border-b pb-2">2. Define Season (Date Range) &amp; Price</h3>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Season *</Label>
                  {/* One control rather than two date fields: the range can't be entered
                      backwards, and its length is visible while picking it. */}
                  <DateRangePicker
                    value={dateRange}
                    onChange={setDateRange}
                    placeholder="Pick the season's dates"
                  />
                  <p className={cn("text-xs", rangeTooLong ? "text-destructive" : "text-muted-foreground")}>
                    {rangeTooLong
                      ? `Too long — a season can span at most ${MAX_PRICE_CALENDAR_RANGE_YEARS} years.`
                      : days > 0
                        ? `${days} day${days === 1 ? "" : "s"} — ${format(dateRange!.from!, "MMM d, yyyy")} through ${format(dateRange!.to!, "MMM d, yyyy")}, both included.`
                        : "Both the first and the last day get the new price."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Daily Price *</Label>
                  <Input type="number" step="0.01" min="0" required placeholder="150.00" value={price} onChange={e => setPrice(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Per night, per room, at each room type&apos;s Base Occupancy.</p>
                </div>
                <div className="space-y-2">
                  <Label>Extra Adult Price <span className="text-muted-foreground font-normal">Optional</span></Label>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={extraAdultPrice} onChange={e => setExtraAdultPrice(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Per night, per adult beyond each room type&apos;s Base Occupancy.</p>
                </div>
                <div className="space-y-2">
                  <Label>Extra Child Price <span className="text-muted-foreground font-normal">Optional</span></Label>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" value={extraChildPrice} onChange={e => setExtraChildPrice(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Per night, per child.</p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b pb-2">
                <h3 className="text-sm font-medium text-foreground">3. Apply to Room Types</h3>
                {roomTypes.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {selectedRoomTypes.length} of {roomTypes.length} selected
                  </span>
                )}
              </div>
              {roomTypes.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  This property has no room types yet — add one under Inventory before pushing prices.
                </p>
              ) : (
                <div className="rounded-md border">
                  <label className="flex cursor-pointer items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm font-semibold">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onCheckedChange={() => handleSelectAllRooms(!allSelected)}
                    />
                    Select All Room Types
                  </label>
                  {/* auto-fill, not sm:/lg: column counts — those track the viewport, and this
                      grid sits in a column the review panel has already narrowed, which is how
                      room type names ended up truncated. Tiles fit themselves to the real width. */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2 p-3">
                    {roomTypes.map(rt => {
                      const checked = selectedRoomTypes.includes(rt.id)
                      return (
                        <label
                          key={rt.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-accent/40",
                            checked ? "border-primary/50 bg-primary/5" : "border-border"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => handleRoomTypeToggle(rt.id, !!c)}
                          />
                          {/* Wraps rather than truncates: a room type the user can't read in
                              full is not a room type they can safely tick. */}
                          <span className="min-w-0 flex-1">{rt.name}</span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">{rt.code}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>

          </div>
        </CardContent>
      </Card>

      {/* Review panel. The push is an overwrite across every day × room type in the season,
          so what it is about to write is stated before the button, not discovered after. */}
      <Card className="xl:sticky xl:top-6">
        <CardHeader className="bg-muted/50 border-b border-border pb-4">
          <CardTitle className="text-base">Review</CardTitle>
          <CardDescription>What this push will write.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <dl className="space-y-3 text-sm">
            <SummaryRow
              label="Rate plan"
              value={selectedPlan ? `${selectedPlan.name}${selectedPlan.isNegotiated ? " (Negotiated)" : ""}` : null}
            />
            <SummaryRow
              label="Season"
              value={days > 0 ? `${format(dateRange!.from!, "MMM d, yyyy")} – ${format(dateRange!.to!, "MMM d, yyyy")}` : null}
              hint={days > 0 ? `${days} day${days === 1 ? "" : "s"}` : undefined}
            />
            <SummaryRow
              label="Room types"
              value={selectedRoomTypes.length > 0 ? `${selectedRoomTypes.length} of ${roomTypes.length}` : null}
              hint={roomTypes.filter(rt => selectedRoomTypes.includes(rt.id)).map(rt => rt.code).join(", ")}
            />
            <SummaryRow label="Daily price" value={parsedPrice >= 0 ? currency(parsedPrice) : null} />
            <SummaryRow label="Extra adult" value={extraAdultPrice === "" ? "—" : currency(Number(extraAdultPrice))} />
            <SummaryRow label="Extra child" value={extraChildPrice === "" ? "—" : currency(Number(extraChildPrice))} />
          </dl>

          <Separator />

          {rowCount > 0 && !rangeTooLong && (
            <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
              <span>
                Overwrites <strong className="font-medium text-foreground">{rowCount.toLocaleString()}</strong>{" "}
                daily price {rowCount === 1 ? "row" : "rows"} — {days} day{days === 1 ? "" : "s"} ×{" "}
                {selectedRoomTypes.length} room type{selectedRoomTypes.length === 1 ? "" : "s"}.
              </span>
            </p>
          )}

          <Button
            type="submit"
            className="w-full shadow-md transition-all active:scale-95"
            disabled={submitting || !!blocker}
          >
            <Save className="w-4 h-4 mr-2" />
            {submitting ? "Pushing Prices..." : "Push Prices to Calendar"}
          </Button>
          {blocker && <p className="text-center text-xs text-muted-foreground">{blocker}</p>}
        </CardContent>
      </Card>
    </form>
    </>
  )
}
