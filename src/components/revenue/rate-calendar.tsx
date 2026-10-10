"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameDay,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns"
import { Ban, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InfoHint } from "@/components/ui/info-hint"
import { useProperty } from "@/components/providers/property-provider"
import { StopSaleDialog, type StopSaleInitial } from "@/components/availability/stop-sale-dialog"

type RatePlan = {
  id: string
  name: string
  code: string
  isLocked?: boolean
  parentRatePlanId: string | null
  parentRatePlan?: { id: string; name: string; code: string } | null
  derivedAdjustmentType: string | null
  derivedAdjustmentValue: number | null
}
type RoomType = { id: string; name: string; code: string }
// `source`/`derived` say how the price was resolved — the same way Night Audit posts it
// (src/lib/effective-price-calendar.ts): the plan's own (or, for a derived plan, its
// parent's) calendar, else the Base Rate plan's, plus a derived plan's adjustment.
type PriceEntry = {
  date: string
  price: number
  extraAdultPrice: number | null
  extraChildPrice: number | null
  source?: "OWN" | "BASE_FALLBACK"
  derived?: boolean
}

const money = (n: number) => `$${n.toFixed(2)}`

function sourceNote(entry: PriceEntry): string | null {
  return entry.derived ? "Parent plan's price plus this plan's adjustment." : null
}

/**
 * View-only price calendar. Prices are never edited here: picking days offers "Update prices",
 * which opens Rate seasons with the plan, room type and dates already filled in (and returns
 * here once applied), and "Stop sale", which uses the Availability stop-sale dialog.
 *
 * `lockedRatePlanId` pins the calendar to one plan (the per-plan "Calendar" button on Rate
 * plans); without it the plan is a filter and opens on the property's Base Rate.
 * `returnPath` is where Rate seasons sends the user back to after applying a price.
 */
export function RateCalendar({
  lockedRatePlanId = null,
  returnPath,
}: {
  lockedRatePlanId?: string | null
  returnPath: string
}) {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [ratePlans, setRatePlans] = useState<RatePlan[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [selectedRatePlanId, setSelectedRatePlanId] = useState(lockedRatePlanId ?? "")
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState("")
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))

  const [prices, setPrices] = useState<PriceEntry[]>([])
  const [closedDays, setClosedDays] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Picked days: click a day, then another, to set the range (the first click alone is a
  // one-day range).
  const [rangeAnchor, setRangeAnchor] = useState<Date | null>(null)
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [stopSale, setStopSale] = useState<{ open: boolean; initial?: StopSaleInitial }>({ open: false })

  useEffect(() => {
    if (!propertyId) return
    Promise.all([
      fetch(`/api/rate-plans?propertyId=${propertyId}`).then((r) => r.json()),
      fetch(`/api/room-types?propertyId=${propertyId}`).then((r) => r.json()),
    ])
      .then(([rpData, rtData]) => {
        const plans: RatePlan[] = Array.isArray(rpData) ? rpData : []
        const types: RoomType[] = Array.isArray(rtData) ? rtData : []
        setRatePlans(plans)
        setRoomTypes(types)
        // The Base Rate plan is the property's locked plan, created at onboarding.
        setSelectedRatePlanId((cur) => cur || plans.find((p) => p.isLocked)?.id || plans[0]?.id || "")
        setSelectedRoomTypeId((cur) => cur || types[0]?.id || "")
      })
      .catch(() => setLoadError(true))
  }, [propertyId])

  // A client-side navigation between two ?ratePlanId= links doesn't remount the page.
  useEffect(() => {
    if (lockedRatePlanId) setSelectedRatePlanId(lockedRatePlanId)
  }, [lockedRatePlanId])

  const fetchPrices = useCallback(() => {
    if (!selectedRatePlanId || !selectedRoomTypeId || !propertyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    const start = format(currentMonth, "yyyy-MM-dd")
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd")
    const days = differenceInCalendarDays(endOfMonth(currentMonth), currentMonth) + 1

    fetch(`/api/price-calendar?ratePlanId=${selectedRatePlanId}&roomTypeId=${selectedRoomTypeId}&startDate=${start}&endDate=${end}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((data) => {
        if (Array.isArray(data)) setPrices(data)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))

    // Stop sale lives on Availability. Someone without Availability access just sees no
    // closed marks — the prices above are what this view is for.
    fetch(`/api/availability?propertyId=${propertyId}&startDate=${start}&days=${days}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const row = data?.rows?.find((r: { roomTypeId: string }) => r.roomTypeId === selectedRoomTypeId)
        const closed = new Set<string>()
        if (row && Array.isArray(data.dates)) {
          row.cells.forEach((c: { closed: boolean }, i: number) => {
            if (c.closed) closed.add(String(data.dates[i]).slice(0, 10)) // UTC-midnight ISO → yyyy-MM-dd
          })
        }
        setClosedDays(closed)
      })
      .catch(() => setClosedDays(new Set()))
  }, [selectedRatePlanId, selectedRoomTypeId, currentMonth, propertyId])

  useEffect(() => {
    fetchPrices()
  }, [fetchPrices])

  // A different plan, room type or month is a different selection.
  useEffect(() => {
    setRange(null)
    setRangeAnchor(null)
  }, [selectedRatePlanId, selectedRoomTypeId, currentMonth])

  const daysInMonth = useMemo(
    () => eachDayOfInterval({ start: currentMonth, end: endOfMonth(currentMonth) }),
    [currentMonth]
  )
  const startingDayIndex = getDay(currentMonth)

  const selectedRatePlan = ratePlans.find((r) => r.id === selectedRatePlanId)
  const isDerivedPlan = !!selectedRatePlan?.parentRatePlanId
  const selectedRoomType = roomTypes.find((r) => r.id === selectedRoomTypeId)
  // A night the plan has no price for comes back as a Base Rate fallback (what Night Audit would
  // post); the calendar shows that as NA rather than another plan's price.
  const entryFor = (day: Date) => {
    const e = prices.find((p) => isSameDay(new Date(p.date), day))
    return e && e.source !== "BASE_FALLBACK" ? e : null
  }
  const isClosed = (day: Date) => closedDays.has(format(day, "yyyy-MM-dd"))

  const pickDay = (day: Date) => {
    // Phones read the calendar; changing prices and stop sale are desktop actions.
    if (window.matchMedia("(max-width: 767px)").matches) return
    if (!rangeAnchor) {
      setRangeAnchor(day)
      setRange({ from: day, to: day })
    } else {
      const [from, to] = day < rangeAnchor ? [day, rangeAnchor] : [rangeAnchor, day]
      setRange({ from, to })
      setRangeAnchor(null)
    }
  }
  const inRange = (day: Date) =>
    !!range && day >= startOfDay(range.from) && day <= startOfDay(range.to)

  const clearSelection = () => {
    setRange(null)
    setRangeAnchor(null)
  }

  const updatePrices = () => {
    if (!range || !selectedRatePlanId || !selectedRoomTypeId) return
    const sp = new URLSearchParams({
      tab: "seasonal-pricing",
      ratePlanId: selectedRatePlanId,
      roomTypeId: selectedRoomTypeId,
      from: format(range.from, "yyyy-MM-dd"),
      to: format(range.to, "yyyy-MM-dd"),
      return: returnPath,
    })
    router.push(`/e/${slug}/dashboard/revenue?${sp.toString()}`)
  }

  const openStopSale = () => {
    if (!range || !selectedRoomTypeId) return
    setStopSale({
      open: true,
      initial: {
        roomTypeId: selectedRoomTypeId,
        date: format(range.from, "yyyy-MM-dd"),
        endDate: format(range.to, "yyyy-MM-dd"),
      },
    })
  }

  const nights = range ? differenceInCalendarDays(range.to, range.from) + 1 : 0

  return (
    <div className="space-y-4">
      {isDerivedPlan && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{selectedRatePlan?.name}</span> is priced live from &quot;
          {selectedRatePlan?.parentRatePlan?.name}&quot;
          {selectedRatePlan?.derivedAdjustmentType === "FLAT"
            ? ` ${(selectedRatePlan?.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}$${selectedRatePlan?.derivedAdjustmentValue} flat`
            : ` ${(selectedRatePlan?.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}${selectedRatePlan?.derivedAdjustmentValue}%`}
          . Change the parent plan&apos;s prices, or this plan&apos;s adjustment on Rate plans, to change it.
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {!lockedRatePlanId && ratePlans.length > 0 && (
                <Select value={selectedRatePlanId} onValueChange={(v) => v && setSelectedRatePlanId(String(v))}>
                  <SelectTrigger className="w-64 max-md:w-full" aria-label="Rate plan">
                    <SelectValue placeholder="Rate plan">{selectedRatePlan ? `${selectedRatePlan.name} (${selectedRatePlan.code})` : undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ratePlans.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {roomTypes.map((rt) => (
                <Button
                  key={rt.id}
                  type="button"
                  variant={rt.id === selectedRoomTypeId ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedRoomTypeId(rt.id)}
                >
                  {rt.name}
                </Button>
              ))}
            </div>
            <InfoHint label="Price calendar">
              View only. Pick a day (or a first and last day) to update prices in Rate seasons or to stop sale. Hover a day for the extra adult and child prices.
            </InfoHint>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center justify-center gap-2 sm:gap-4">
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>Previous</Button>
              <h3 className="text-center text-lg font-semibold sm:w-48 sm:text-xl">{format(currentMonth, "MMMM yyyy")}</h3>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>Next</Button>
            </div>
            <Button variant="outline" size="sm" className="w-full md:w-auto" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>Today</Button>
          </div>

          {/* A fixed-height row, so picking a day never shifts the grid under the pointer. */}
          <div className="flex h-12 items-center gap-2 border bg-muted/40 p-2 max-md:hidden" role="status">
            {!range ? (
              <span className="truncate px-1 text-sm text-muted-foreground">Click a day — or a first and last day — to update prices or stop sale.</span>
            ) : (
              <>
              <span className="min-w-0 truncate px-1 text-sm">
                <span className="font-medium">
                  {isSameDay(range.from, range.to)
                    ? format(range.from, "MMM d, yyyy")
                    : `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`}
                </span>
                <span className="text-muted-foreground"> · {nights} night{nights === 1 ? "" : "s"} · {selectedRoomType?.name}</span>
                {rangeAnchor && <span className="text-muted-foreground"> · click another day to extend</span>}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {isDerivedPlan ? (
                  <span className="text-xs text-muted-foreground">Derived plan — update the parent plan&apos;s prices.</span>
                ) : (
                  <Button size="sm" onClick={updatePrices}>Update prices</Button>
                )}
                <Button size="sm" variant="outline" onClick={openStopSale}>
                  <Ban className="mr-1.5 h-3.5 w-3.5" /> Stop sale
                </Button>
                <Button size="icon" variant="ghost" onClick={clearSelection} aria-label="Clear selection">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {loading ? (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
              {Array.from({ length: 35 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-none" />
              ))}
            </div>
          ) : loadError ? (
            <ErrorState title="Couldn't load prices" onRetry={fetchPrices} />
          ) : !selectedRatePlanId || !selectedRoomTypeId ? (
            <div className="flex h-96 items-center justify-center text-muted-foreground">
              Select a rate plan and room type to view the calendar.
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="bg-muted py-2 text-center text-xs font-medium text-muted-foreground sm:text-sm">
                  <span className="sm:hidden">{day.slice(0, 1)}</span>
                  <span className="hidden sm:inline">{day}</span>
                </div>
              ))}

              {Array.from({ length: startingDayIndex }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[64px] bg-card p-1 sm:min-h-[88px] sm:p-2" />
              ))}

              {daysInMonth.map((day) => {
                const entry = entryFor(day)
                const isToday = isSameDay(day, new Date())
                const selected = inRange(day)
                const closed = isClosed(day)
                const note = entry ? sourceNote(entry) : null
                const hasExtras = !!entry && (entry.extraAdultPrice != null || entry.extraChildPrice != null)
                return (
                  <Tooltip key={day.toISOString()}>
                    <TooltipTrigger
                      render={
                        <div
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => pickDay(day)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              pickDay(day)
                            }
                          }}
                        />
                      }
                      className={`flex min-h-[64px] cursor-pointer flex-col bg-card p-1 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[88px] sm:p-2 ${isToday ? "bg-info-muted/30" : ""} ${selected ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/20" : closed ? "bg-destructive/5" : ""} ${rangeAnchor && isSameDay(day, rangeAnchor) ? "ring-2 ring-primary/50" : ""}`}
                    >
                      <div className="flex items-start justify-between">
                        <span className={`text-xs font-medium sm:text-sm ${isToday ? "flex h-5 w-5 items-center justify-center bg-info text-info-foreground sm:h-6 sm:w-6" : "text-muted-foreground"}`}>
                          {format(day, "d")}
                        </span>
                        {closed && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                            <Ban className="h-3 w-3" />
                            <span className="max-sm:hidden">Closed</span>
                          </span>
                        )}
                      </div>
                      <div className="mt-auto flex items-center gap-1.5 pt-1 sm:pt-2">
                        {entry !== null ? (
                          <>
                            <span
                              className={`text-xs font-bold tabular-nums sm:text-lg ${closed ? "text-muted-foreground line-through" : entry.derived ? "text-info" : "text-success"}`}
                            >
                              <span className="sm:hidden">${Math.round(entry.price)}</span>
                              <span className="max-sm:hidden">{money(entry.price)}</span>
                            </span>
                            {note && (
                              <span
                                aria-label="Derived"
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-info"
                              />
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] italic text-muted-foreground sm:text-sm">NA</span>
                        )}
                      </div>
                    </TooltipTrigger>
                    {(hasExtras || note || closed) && (
                      <TooltipContent>
                        <div className="max-w-56 space-y-0.5 text-xs">
                          <div className="font-medium">{format(day, "EEE, MMM d")}</div>
                          {closed && <div>Stop sale — closed for {selectedRoomType?.name}.</div>}
                          {entry?.extraAdultPrice != null && <div>Extra adult {money(entry.extraAdultPrice)}</div>}
                          {entry?.extraChildPrice != null && <div>Extra child {money(entry.extraChildPrice)}</div>}
                          {note && <div className="opacity-80">{note}</div>}
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                )
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-info" /> Derived</span>
            <span className="inline-flex items-center gap-1.5"><Ban className="h-3 w-3 text-destructive" /> Stop sale</span>
          </div>
        </CardContent>
      </Card>

      {stopSale.open && (
        <StopSaleDialog
          open={stopSale.open}
          onClose={() => setStopSale({ open: false })}
          propertyId={propertyId}
          roomTypes={roomTypes}
          initial={stopSale.initial}
          onDone={() => {
            clearSelection()
            fetchPrices()
          }}
        />
      )}
    </div>
  )
}
