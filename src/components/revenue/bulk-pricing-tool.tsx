"use client"

import { useState, useEffect } from "react"
import { CalendarDays, Save, CheckSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"

export function BulkPricingTool({ propertyId }: { propertyId: string }) {
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Form State
  const [ratePlanId, setRatePlanId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [price, setPrice] = useState("")
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
    
    if (selectedRoomTypes.length === 0) {
      alert("Please select at least one Room Type.")
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
          startDate,
          endDate,
          price
        })
      })

      const data = await res.json()
      if (res.ok) {
        alert(data.message)
        // Reset form
        setStartDate("")
        setEndDate("")
        setPrice("")
        setSelectedRoomTypes([])
      } else {
        alert(data.error || "Failed to push prices")
      }
    } catch (e) {
      console.error(e)
      alert("An error occurred")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-slate-500">Loading Configuration Tools...</div>
  }

  return (
    <Card className="premium-card max-w-3xl">
      <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
        <div className="flex items-center space-x-2">
          <CalendarDays className="h-5 w-5 text-indigo-600" />
          <CardTitle className="text-lg">Bulk Seasonal Pricing Tool</CardTitle>
        </div>
        <CardDescription>
          Push new pricing to the calendar across a specific date range (Season) and multiple room types.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-900 border-b pb-2">1. Select Target Rate Plan</h3>
            <div className="max-w-md">
              <Select required value={ratePlanId} onValueChange={(val) => setRatePlanId(val ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a Rate Plan..." />
                </SelectTrigger>
                <SelectContent>
                  {ratePlans.map(rp => (
                    <SelectItem key={rp.id} value={rp.id}>
                      {rp.name} {rp.isNegotiated ? "(Negotiated)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-900 border-b pb-2">2. Define Season (Date Range) & Price</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>Start Date *</Label>
                <Input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date *</Label>
                <Input type="date" required value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Daily Price *</Label>
                <Input type="number" step="0.01" min="0" required placeholder="150.00" value={price} onChange={e => setPrice(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-slate-900 border-b pb-2">3. Apply to Room Types</h3>
            <div className="bg-slate-50 p-4 rounded-md border space-y-3">
              <div className="flex items-center space-x-2 pb-2 border-b border-slate-200">
                <Checkbox 
                  id="selectAll" 
                  checked={selectedRoomTypes.length === roomTypes.length && roomTypes.length > 0} 
                  onCheckedChange={(checked) => handleSelectAllRooms(!!checked)}
                />
                <Label htmlFor="selectAll" className="font-semibold cursor-pointer">Select All Room Types</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {roomTypes.map(rt => (
                  <div key={rt.id} className="flex items-center space-x-2">
                    <Checkbox 
                      id={`rt-${rt.id}`} 
                      checked={selectedRoomTypes.includes(rt.id)}
                      onCheckedChange={(checked) => handleRoomTypeToggle(rt.id, !!checked)}
                    />
                    <Label htmlFor={`rt-${rt.id}`} className="cursor-pointer font-normal">
                      {rt.name} <span className="text-slate-400 text-xs ml-1">({rt.code})</span>
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button 
              type="submit" 
              className="bg-indigo-600 hover:bg-indigo-700 shadow-md transition-all active:scale-95" 
              disabled={submitting || !ratePlanId || selectedRoomTypes.length === 0}
            >
              <Save className="w-4 h-4 mr-2" />
              {submitting ? "Pushing Prices..." : "Push Prices to Calendar"}
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  )
}
