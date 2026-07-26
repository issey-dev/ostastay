"use client"

import { useEffect, useState, useMemo, Suspense } from "react"
import { useSearchParams, useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save, Loader2 } from "@/components/icons"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import type { DateRange } from "react-day-picker"
import { useProperty } from "@/components/providers/property-provider"
import { toast } from "@/lib/toast"

type RatePlan = { id: string; name: string; code: string; parentRatePlanId: string | null; parentRatePlan?: { id: string; name: string; code: string } | null; derivedAdjustmentType: string | null; derivedAdjustmentValue: number | null }
type RoomType = { id: string; name: string; code: string }
type PriceEntry = { date: string; price: number; extraAdultPrice: number | null; extraChildPrice: number | null }

export default function PriceCalendarPage() {
  return (
    <Suspense fallback={null}>
      <PriceCalendarPageContent />
    </Suspense>
  )
}

function PriceCalendarPageContent() {
  const searchParams = useSearchParams()
  const { slug } = useParams<{ slug: string }>()
  const initialRatePlanId = searchParams.get("ratePlanId")

  const [ratePlans, setRatePlans] = useState<RatePlan[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  
  const [selectedRatePlanId, setSelectedRatePlanId] = useState<string>(initialRatePlanId || "")
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>("")
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  
  const [prices, setPrices] = useState<PriceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  // Bulk update state
  const [bulkDateRange, setBulkDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: endOfMonth(new Date()),
  })
  const [bulkPrice, setBulkPrice] = useState("")
  const [bulkExtraAdultPrice, setBulkExtraAdultPrice] = useState("")
  const [bulkExtraChildPrice, setBulkExtraChildPrice] = useState("")
  // Which room type(s) Apply Prices writes to — independent of the single Room Type
  // selector above (that one only controls which room type's grid is being viewed).
  // Defaults to whichever room type is being viewed, then the admin can check more so
  // one Apply Prices call can price several room types at once instead of repeating
  // the whole flow per room type.
  const [bulkRoomTypeIds, setBulkRoomTypeIds] = useState<string[]>([])

  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  useEffect(() => {
    if (!propertyId) return
    Promise.all([
      fetch(`/api/rate-plans?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/room-types?propertyId=${propertyId}`).then(r => r.json())
    ]).then(([rpData, rtData]) => {
      setRatePlans(rpData)
      setRoomTypes(rtData)

      if (!initialRatePlanId && rpData.length > 0) {
        setSelectedRatePlanId(rpData[0].id)
      }
      if (rtData.length > 0) {
        setSelectedRoomTypeId(rtData[0].id)
        setBulkRoomTypeIds([rtData[0].id])
      }
    })
  }, [initialRatePlanId, propertyId])

  // Clicking a different rate plan's "Calendar" link while already on this page is a
  // client-side navigation to the same route (only the ?ratePlanId= query differs), so
  // Next.js doesn't remount the component — the useState initial value above only ever
  // runs once. Without this, the plan shown stays stuck at whichever was first opened.
  useEffect(() => {
    if (initialRatePlanId) setSelectedRatePlanId(initialRatePlanId)
  }, [initialRatePlanId])

  // Switching which room type the grid is viewing also resets the bulk-apply
  // selection to just that one — an admin who then wants to price several room
  // types the same way checks the extra boxes from there.
  useEffect(() => {
    if (selectedRoomTypeId) setBulkRoomTypeIds([selectedRoomTypeId])
     
  }, [selectedRoomTypeId])

  const toggleBulkRoomType = (id: string, checked: boolean) => {
    setBulkRoomTypeIds(prev => checked ? [...prev, id] : prev.filter(rid => rid !== id))
  }

  const fetchPrices = () => {
    if (!selectedRatePlanId || !selectedRoomTypeId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(false)
    const start = format(currentMonth, "yyyy-MM-dd")
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd")

    fetch(`/api/price-calendar?ratePlanId=${selectedRatePlanId}&roomTypeId=${selectedRoomTypeId}&startDate=${start}&endDate=${end}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) setPrices(data)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchPrices()
  }, [selectedRatePlanId, selectedRoomTypeId, currentMonth])

  const handleBulkUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRatePlanId || !bulkPrice) return

    // Edge cases the server would otherwise reject with a generic 400 — catch them
    // here with a message that actually says what's wrong.
    if (bulkRoomTypeIds.length === 0) {
      toast.error("Check at least one room type to apply this price to.")
      return
    }
    if (!bulkDateRange?.from || !bulkDateRange?.to) {
      toast.error("Pick both a From and a To date.")
      return
    }
    if (bulkDateRange.from > bulkDateRange.to) {
      toast.error("The From date must be on or before the To date.")
      return
    }

    setBulkSubmitting(true)
    try {
      // Same multi-room-type endpoint the Rate Details "Bulk Seasonal Pricing Tool"
      // uses — one Apply Prices call now covers every checked room type instead of
      // requiring the whole flow to be repeated per room type.
      const res = await fetch("/api/price-calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratePlanId: selectedRatePlanId,
          roomTypeIds: bulkRoomTypeIds,
          startDate: format(bulkDateRange.from, "yyyy-MM-dd"),
          endDate: format(bulkDateRange.to, "yyyy-MM-dd"),
          price: parseFloat(bulkPrice),
          extraAdultPrice: bulkExtraAdultPrice === "" ? null : parseFloat(bulkExtraAdultPrice),
          extraChildPrice: bulkExtraChildPrice === "" ? null : parseFloat(bulkExtraChildPrice),
        })
      })

      if (res.ok) {
        const data = await res.json().catch(() => null)
        toast.success(data?.message || "Prices updated successfully!")
        setBulkPrice("")
        setBulkExtraAdultPrice("")
        setBulkExtraChildPrice("")
        // The applied range can fall outside whatever month the grid currently shows
        // (the two independent From/To pickers make that easy to do by accident) —
        // jump the grid to the start of the range just priced so the update is
        // actually visible instead of looking like nothing happened.
        const targetMonth = startOfMonth(bulkDateRange.from)
        if (targetMonth.getTime() !== startOfMonth(currentMonth).getTime()) {
          setCurrentMonth(targetMonth)
        } else {
          fetchPrices()
        }
      } else {
        const data = await res.json().catch(() => null)
        const message = typeof data?.error === "string" ? data.error : Array.isArray(data?.error) ? data.error.map((i: { message: string }) => i.message).join(", ") : "Failed to update prices."
        toast.error(message)
      }
    } catch (err) {
      toast.error("An error occurred.")
    } finally {
      setBulkSubmitting(false)
    }
  }

  // Calendar Grid Logic
  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({ start: currentMonth, end: endOfMonth(currentMonth) })
  }, [currentMonth])

  const startingDayIndex = getDay(currentMonth) // 0 = Sunday, 1 = Monday, etc.

  const getEntryForDate = (date: Date) => {
    return prices.find(p => isSameDay(new Date(p.date), date)) ?? null
  }

  const selectedRatePlan = ratePlans.find(r => r.id === selectedRatePlanId)
  const isDerivedPlan = !!selectedRatePlan?.parentRatePlanId

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link href={`/e/${slug}/dashboard/revenue`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Price Calendar</h2>
          <p className="text-muted-foreground">
            Manage daily rates by room type and rate plan.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Left Sidebar: Filters & Bulk Update */}
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Rate Plan</Label>
                {/* Locked — this page is always entered from a specific plan's
                    "Calendar" link on the Rate Plans list; switching plans here would
                    silently change what Bulk Update writes to. Go back and click
                    Calendar on a different row to view/edit a different plan. */}
                <Select value={selectedRatePlanId} disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Rate Plan">
                      {ratePlans.find(r => r.id === selectedRatePlanId)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ratePlans.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {isDerivedPlan ? (
            <Card className="border-info/30 shadow-sm bg-info-muted/50">
              <CardHeader>
                <CardTitle className="text-info">Derived Rate Plan</CardTitle>
                <CardDescription>
                  This plan&apos;s price is computed live from &quot;{selectedRatePlan?.parentRatePlan?.name}&quot;
                  {selectedRatePlan?.derivedAdjustmentType === "FLAT"
                    ? ` ${(selectedRatePlan?.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}$${selectedRatePlan?.derivedAdjustmentValue} flat`
                    : ` ${(selectedRatePlan?.derivedAdjustmentValue ?? 0) >= 0 ? "+" : ""}${selectedRatePlan?.derivedAdjustmentValue}%`}
                  . It has no calendar of its own to edit here — change the parent plan&apos;s prices, or edit this plan&apos;s adjustment on the Rate Plans tab.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="border-info/30 shadow-sm bg-info-muted/50">
              <CardHeader>
                <CardTitle className="text-info">Bulk Update</CardTitle>
                <CardDescription>Apply a price to a date range.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleBulkUpdate} className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Room Type(s)</Label>
                      <button
                        type="button"
                        className="text-xs text-info hover:underline"
                        onClick={() => setBulkRoomTypeIds(bulkRoomTypeIds.length === roomTypes.length ? [] : roomTypes.map(r => r.id))}
                      >
                        {bulkRoomTypeIds.length === roomTypes.length ? "Clear all" : "Select all"}
                      </button>
                    </div>
                    <div className="border rounded-md p-2 max-h-32 overflow-y-auto space-y-1.5 bg-card">
                      {roomTypes.map(rt => (
                        <div key={rt.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`bulk-rt-${rt.id}`}
                            checked={bulkRoomTypeIds.includes(rt.id)}
                            onCheckedChange={(checked) => toggleBulkRoomType(rt.id, !!checked)}
                          />
                          <Label htmlFor={`bulk-rt-${rt.id}`} className="font-normal cursor-pointer text-sm">
                            {rt.name} <span className="text-muted-foreground text-xs">({rt.code})</span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>From</Label>
                      <DatePicker
                        value={bulkDateRange?.from}
                        onChange={(date) => setBulkDateRange(prev => ({ from: date ? new Date(date) : undefined, to: prev?.to }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>To</Label>
                      <DatePicker
                        value={bulkDateRange?.to}
                        onChange={(date) => setBulkDateRange(prev => ({ from: prev?.from, to: date ? new Date(date) : undefined }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Daily Price ($)</Label>
                    <Input type="number" min="0" step="0.01" required value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} placeholder="199.00" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Extra Adult ($) <span className="text-muted-foreground font-normal">Optional</span></Label>
                      <Input type="number" min="0" step="0.01" value={bulkExtraAdultPrice} onChange={e => setBulkExtraAdultPrice(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Extra Child ($) <span className="text-muted-foreground font-normal">Optional</span></Label>
                      <Input type="number" min="0" step="0.01" value={bulkExtraChildPrice} onChange={e => setBulkExtraChildPrice(e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={bulkSubmitting || !selectedRatePlanId || bulkRoomTypeIds.length === 0}>
                    {bulkSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Apply Prices{bulkRoomTypeIds.length > 1 ? ` (${bulkRoomTypeIds.length} room types)` : ""}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Side: Calendar Grid */}
        <div className="md:col-span-3">
          <Card className="h-full">
            <CardHeader className="flex flex-col gap-4 border-b pb-4 mb-4">
              {/* Room type being previewed — the only place this is chosen now
                  (Configuration's old duplicate dropdown was removed). Independent of
                  Bulk Update's own checkbox list, which controls what gets written. */}
              <div className="flex items-center gap-2 flex-wrap">
                {roomTypes.map(rt => (
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
              <div className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>Previous</Button>
                  <h3 className="text-xl font-semibold w-48 text-center">{format(currentMonth, "MMMM yyyy")}</h3>
                  <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>Next</Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>Today</Button>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-none" />
                  ))}
                </div>
              ) : loadError ? (
                <ErrorState title="Couldn't load prices" onRetry={fetchPrices} />
              ) : !selectedRatePlanId || !selectedRoomTypeId ? (
                <div className="h-96 flex items-center justify-center text-muted-foreground">
                  Select a Rate Plan and Room Type to view calendar.
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
                  {/* Days of week header */}
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                    <div key={day} className="bg-muted py-2 text-center text-sm font-medium text-muted-foreground">
                      {day}
                    </div>
                  ))}
                  
                  {/* Empty padding cells for start of month */}
                  {Array.from({ length: startingDayIndex }).map((_, i) => (
                    <div key={`empty-${i}`} className="bg-card min-h-[100px] p-2" />
                  ))}

                  {/* Calendar Days */}
                  {daysInMonth.map(day => {
                    const entry = getEntryForDate(day)
                    const isToday = isSameDay(day, new Date())
                    return (
                      <div key={day.toISOString()} className={`bg-card min-h-[100px] p-2 flex flex-col group hover:bg-muted transition-colors ${isToday ? 'bg-info-muted/30' : ''}`}>
                        <div className="flex justify-between items-start">
                          <span className={`text-sm font-medium ${isToday ? 'bg-info text-info-foreground rounded-none w-6 h-6 flex items-center justify-center' : 'text-muted-foreground'}`}>
                            {format(day, "d")}
                          </span>
                        </div>
                        <div className="mt-auto pt-2 flex flex-col gap-0.5">
                          {entry !== null ? (
                            <>
                              <span className="text-lg font-bold text-success">${entry.price.toFixed(2)}</span>
                              {(entry.extraAdultPrice != null || entry.extraChildPrice != null) && (
                                <span className="text-[11px] text-muted-foreground leading-tight">
                                  {entry.extraAdultPrice != null && `+$${entry.extraAdultPrice.toFixed(2)} adult`}
                                  {entry.extraAdultPrice != null && entry.extraChildPrice != null && " · "}
                                  {entry.extraChildPrice != null && `+$${entry.extraChildPrice.toFixed(2)} child`}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground italic">No Rate</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  )
}
