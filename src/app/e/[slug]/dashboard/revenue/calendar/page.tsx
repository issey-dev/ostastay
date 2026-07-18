"use client"

import { useEffect, useState, useMemo, Suspense } from "react"
import { useSearchParams, useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay } from "date-fns"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Skeleton } from "@/components/ui/skeleton"
import type { DateRange } from "react-day-picker"

type RatePlan = { id: string; name: string; code: string }
type RoomType = { id: string; name: string; code: string }
type PriceEntry = { date: string; price: number }

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
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  // Bulk update state
  const [bulkDateRange, setBulkDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: endOfMonth(new Date()),
  })
  const [bulkPrice, setBulkPrice] = useState("")

  const propertyId = "00000000-0000-0000-0000-000000000000" // Hardcoded for demo

  useEffect(() => {
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
      }
    })
  }, [initialRatePlanId])

  const fetchPrices = () => {
    if (!selectedRatePlanId || !selectedRoomTypeId) {
      setLoading(false)
      return
    }

    setLoading(true)
    const start = format(currentMonth, "yyyy-MM-dd")
    const end = format(endOfMonth(currentMonth), "yyyy-MM-dd")
    
    fetch(`/api/price-calendar?ratePlanId=${selectedRatePlanId}&roomTypeId=${selectedRoomTypeId}&startDate=${start}&endDate=${end}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setPrices(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchPrices()
  }, [selectedRatePlanId, selectedRoomTypeId, currentMonth])

  const handleBulkUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRatePlanId || !selectedRoomTypeId || !bulkPrice) return

    setBulkSubmitting(true)
    try {
      const res = await fetch("/api/price-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratePlanId: selectedRatePlanId,
          roomTypeId: selectedRoomTypeId,
          startDate: bulkDateRange?.from ? format(bulkDateRange.from, "yyyy-MM-dd") : "",
          endDate: bulkDateRange?.to ? format(bulkDateRange.to, "yyyy-MM-dd") : "",
          price: parseFloat(bulkPrice)
        })
      })

      if (res.ok) {
        alert("Prices updated successfully!")
        setBulkPrice("")
        fetchPrices()
      } else {
        alert("Failed to update prices.")
      }
    } catch (err) {
      alert("An error occurred.")
    } finally {
      setBulkSubmitting(false)
    }
  }

  // Calendar Grid Logic
  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({ start: currentMonth, end: endOfMonth(currentMonth) })
  }, [currentMonth])

  const startingDayIndex = getDay(currentMonth) // 0 = Sunday, 1 = Monday, etc.

  const getPriceForDate = (date: Date) => {
    const entry = prices.find(p => isSameDay(new Date(p.date), date))
    return entry ? entry.price : null
  }

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
                <Select value={selectedRatePlanId} onValueChange={(val) => setSelectedRatePlanId(val ?? "")}>
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
              <div className="space-y-2">
                <Label>Room Type</Label>
                <Select value={selectedRoomTypeId} onValueChange={(val) => setSelectedRoomTypeId(val ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Room Type">
                      {roomTypes.find(r => r.id === selectedRoomTypeId)?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roomTypes.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-info/30 shadow-sm bg-info-muted/50">
            <CardHeader>
              <CardTitle className="text-info">Bulk Update</CardTitle>
              <CardDescription>Apply a price to a date range.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleBulkUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label>Date Range</Label>
                  <DateRangePicker 
                    value={bulkDateRange} 
                    onChange={setBulkDateRange} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Daily Price ($)</Label>
                  <Input type="number" min="0" step="0.01" required value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} placeholder="199.00" />
                </div>
                <Button type="submit" className="w-full" disabled={bulkSubmitting || !selectedRatePlanId || !selectedRoomTypeId}>
                  {bulkSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Apply Prices
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Calendar Grid */}
        <div className="md:col-span-3">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4 mb-4">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>Previous</Button>
                <h3 className="text-xl font-semibold w-48 text-center">{format(currentMonth, "MMMM yyyy")}</h3>
                <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>Next</Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>Today</Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 rounded-none" />
                  ))}
                </div>
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
                    const price = getPriceForDate(day)
                    const isToday = isSameDay(day, new Date())
                    return (
                      <div key={day.toISOString()} className={`bg-card min-h-[100px] p-2 flex flex-col group hover:bg-muted transition-colors ${isToday ? 'bg-info-muted/30' : ''}`}>
                        <div className="flex justify-between items-start">
                          <span className={`text-sm font-medium ${isToday ? 'bg-info text-info-foreground rounded-none w-6 h-6 flex items-center justify-center' : 'text-muted-foreground'}`}>
                            {format(day, "d")}
                          </span>
                        </div>
                        <div className="mt-auto pt-2 flex flex-col gap-1">
                          {price !== null ? (
                            <span className="text-lg font-bold text-success">${price.toFixed(2)}</span>
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
