"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Utensils, Search, Send, Clock, Store, Coffee, ReceiptText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

export default function POSDashboard() {
  const { currentProperty } = useProperty()
  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<any[]>([])
  const [selectedGuest, setSelectedGuest] = useState<any>(null)
  
  const [chargeCodes, setChargeCodes] = useState<any[]>([])
  const [recentPostings, setRecentPostings] = useState<any[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [posting, setPosting] = useState(false)
  const [feedback, setFeedback] = useState<{message: string, type: 'success' | 'error'} | null>(null)

  const [form, setForm] = useState({
    amount: "",
    chargeCodeId: "",
    description: "",
    reference: ""
  })

  // Fetch charge codes (filtered to F&B or POS related) on mount
  useEffect(() => {
    if (currentProperty) {
      fetch(`/api/charge-codes?enterpriseId=${currentProperty.enterpriseId}`)
        .then(res => res.json())
        .then(data => {
          // We show all charge codes in this demo.
          setChargeCodes(data)
        })
        .catch(console.error)
    }
  }, [currentProperty])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty || !searchQuery) return
    setLoadingSearch(true)
    try {
      const res = await fetch(`/api/pos/search?propertyId=${currentProperty.id}&query=${encodeURIComponent(searchQuery)}`)
      if (res.ok) {
        const data = await res.json()
        setGuests(data)
        setSelectedGuest(null) // Reset selection on new search
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingSearch(false)
    }
  }

  const handlePostCharge = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGuest || !selectedGuest.folioId) {
      setFeedback({ message: "Please select a guest with an active folio.", type: "error" })
      setTimeout(() => setFeedback(null), 4000)
      return
    }

    setPosting(true)
    try {
      const payload = {
        folioId: selectedGuest.folioId,
        amount: form.amount,
        chargeCodeId: form.chargeCodeId,
        description: form.description,
        reference: form.reference
      }

      const res = await fetch(`/api/pos/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const lineItem = await res.json()
        
        // Add to recent postings
        setRecentPostings(prev => [{
          ...lineItem, 
          guestName: selectedGuest.guestName,
          roomNumber: selectedGuest.roomNumber 
        }, ...prev].slice(0, 10))

        // Reset form
        setForm({ amount: "", chargeCodeId: form.chargeCodeId, description: "", reference: "" })
        setFeedback({ message: "Charge posted successfully to Room " + selectedGuest.roomNumber, type: "success" })
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to post charge", type: "error" })
      }
    } catch (error) {
      console.error(error)
      setFeedback({ message: "An unexpected error occurred.", type: "error" })
    } finally {
      setPosting(false)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  const recentPostingsBody = (
    <>
      {recentPostings.length === 0 ? (
        <div className="text-center py-10">
          <Coffee className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No charges posted from this terminal yet today.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recentPostings.map((item, i) => (
            <div key={i} className="bg-card p-3 rounded-lg shadow-sm border border-border flex justify-between items-center">
              <div>
                <p className="font-bold text-sm text-foreground">Room {item.roomNumber}</p>
                <p className="text-xs text-muted-foreground truncate w-32">{item.chargeCode?.description || "Charge"}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-success">${parseFloat(item.amount).toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto flex flex-col md:flex-row gap-8 min-h-[calc(100vh-4rem)] pb-24 md:pb-0">

      {/* Left Column: Search & Post */}
      <div className="flex-1 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-destructive-muted rounded-lg">
              <Utensils className="w-6 h-6 text-destructive" />
            </div>
            Point of Sale Routing
          </h1>
          <p className="text-muted-foreground mt-2">Search for in-house guests and route outlet charges to their room.</p>
        </div>

        {/* 1. Search Guest */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            Find Guest
          </h2>
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
              {guests.map((g, idx) => (
                <div 
                  key={idx} 
                  className={`p-4 flex justify-between items-center cursor-pointer transition-colors ${selectedGuest?.reservationId === g.reservationId ? 'bg-muted border-l-4 border-primary' : 'hover:bg-muted'}`}
                  onClick={() => setSelectedGuest(g)}
                >
                  <div>
                    <p className="font-bold text-foreground">{g.guestName}</p>
                    <p className="text-sm text-muted-foreground">Room {g.roomNumber}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs px-2 py-1 bg-success-muted text-success rounded-full font-semibold">
                      {g.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {searchQuery && guests.length === 0 && !loadingSearch && (
            <p className="text-sm text-muted-foreground mt-4 text-center">No active guests found matching "{searchQuery}"</p>
          )}
        </div>

        {/* 2. Post Charge */}
        <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!selectedGuest ? 'opacity-50 pointer-events-none border-border' : 'border-border shadow-md ring-1 ring-border'}`}>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            Route Charge to Room {selectedGuest ? selectedGuest.roomNumber : ""}
          </h2>
          
          <form onSubmit={handlePostCharge} className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Charge Code (Outlet)</Label>
                <Select value={form.chargeCodeId} onValueChange={(val) => setForm({ ...form, chargeCodeId: val ?? "" })}>
                  <SelectTrigger>
                    {form.chargeCodeId ? (
                      <span className="flex flex-1 text-left truncate">
                        {(() => {
                          const c = chargeCodes.find(x => x.id === form.chargeCodeId);
                          return c ? `${c.description} (${c.code})` : "Select Outlet...";
                        })()}
                      </span>
                    ) : (
                      <SelectValue placeholder="Select Outlet..." />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {chargeCodes.map(c => (
                      <SelectItem key={c.id} value={c.id}>{`${c.description} (${c.code})`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  min="0.01" 
                  required 
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Description</Label>
                <Input 
                  placeholder="e.g., Dinner for two"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Receipt / Check # (Optional)</Label>
                <Input 
                  placeholder="e.g., CHK-4092"
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                />
              </div>
            </div>

            {feedback && (
              <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === 'success' ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'}`}>
                {feedback.message}
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-lg" disabled={posting || !form.amount || !form.chargeCodeId}>
              <Send className="w-5 h-5 mr-2" />
              {posting ? "Posting..." : "Post to Folio"}
            </Button>
          </form>
        </div>
      </div>

      {/* Right Column: Recent Activity — desktop/tablet only, side-by-side */}
      <div className="hidden md:block w-full md:w-96 space-y-6">
        <div className="bg-muted rounded-xl border border-border p-6 h-full min-h-[500px]">
          <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Recent Postings
          </h3>
          {recentPostingsBody}
        </div>
      </div>

      {/* Mobile: Recent Postings collapses into a bottom sheet instead of stacking
          below the primary search/post workflow — keeps the main task above the fold. */}
      <Sheet>
        <SheetTrigger
          render={
            <Button className="md:hidden fixed bottom-4 left-4 right-4 z-[var(--z-sticky)] h-12 shadow-elevation-3" variant="outline">
              <ReceiptText className="w-4 h-4 mr-2" />
              Recent Postings {recentPostings.length > 0 && `(${recentPostings.length})`}
            </Button>
          }
        />
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Postings
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">{recentPostingsBody}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
