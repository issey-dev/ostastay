"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Search, Send, Clock, Store, Coffee, ReceiptText, UserRound, Receipt, CalendarClock } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { OutletAppointmentsPanel } from "@/components/pos/outlet-appointments-panel"

export default function POSDashboard() {
  const { currentProperty } = useProperty()
  const [pageTab, setPageTab] = useState<"charges" | "appointments">("charges")
  const [mode, setMode] = useState<"guest" | "walkin">("guest")
  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<any[]>([])
  const [selectedGuest, setSelectedGuest] = useState<any>(null)

  const [walkInForm, setWalkInForm] = useState({ name: "", contact: "" })
  const [startingWalkIn, setStartingWalkIn] = useState(false)
  const [walkInFolioId, setWalkInFolioId] = useState<string | null>(null)
  const [isWalkInPanelOpen, setIsWalkInPanelOpen] = useState(false)

  const [outlets, setOutlets] = useState<any[]>([])
  const [selectedOutletId, setSelectedOutletId] = useState<string>("")

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

  // Fetch active outlets for this property on mount
  useEffect(() => {
    if (currentProperty) {
      fetch(`/api/outlets?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setOutlets(data.filter((o: any) => o.isActive))
        })
        .catch(console.error)
      // POS is a billing screen — opening it auto-opens the cashier's drawer for the
      // current property, even before anything is posted.
      fetch("/api/cashiering/ensure", { method: "POST" }).catch(() => {})
    }
  }, [currentProperty])

  // Charge codes: scoped to the selected Outlet's curated pool if one is chosen,
  // otherwise every charge code in the enterprise (unchanged fallback behavior for
  // charges that aren't tied to any Outlet).
  useEffect(() => {
    if (selectedOutletId) {
      fetch(`/api/outlets/${selectedOutletId}`)
        .then(res => res.json())
        .then(data => {
          setChargeCodes((data.chargeCodes || []).map((oc: any) => oc.chargeCode))
        })
        .catch(console.error)
    } else if (currentProperty) {
      fetch(`/api/charge-codes?enterpriseId=${currentProperty.enterpriseId}`)
        .then(res => res.json())
        .then(data => setChargeCodes(data))
        .catch(console.error)
    }
    setForm(f => ({ ...f, chargeCodeId: "" }))
  }, [selectedOutletId, currentProperty])

  const handleStartWalkIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentProperty || !walkInForm.name) return
    setStartingWalkIn(true)
    try {
      const res = await fetch(`/api/folios/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, walkInGuestName: walkInForm.name, walkInGuestContact: walkInForm.contact })
      })
      if (res.ok) {
        const folio = await res.json()
        setWalkInFolioId(folio.id)
        setSelectedGuest({ guestName: walkInForm.name, roomNumber: "Walk-in", folioId: folio.id })
      } else {
        setFeedback({ message: "Failed to start walk-in bill.", type: "error" })
      }
    } catch (e) {
      console.error(e)
    } finally {
      setStartingWalkIn(false)
    }
  }

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
        reference: form.reference,
        outletId: selectedOutletId || undefined
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
        setFeedback({
          message: mode === "walkin"
            ? "Charge posted to the walk-in bill."
            : "Charge posted successfully to Room " + selectedGuest.roomNumber,
          type: "success"
        })
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
        <EmptyState icon={Coffee} title="No charges posted from this terminal yet today" className="py-10" />
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
    <div className="space-y-6 pb-24 md:pb-0">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Point of Sale Routing</h2>
        <p className="text-muted-foreground">Search for in-house guests and route outlet charges to their room.</p>
      </div>

      <Tabs value={pageTab} onValueChange={(v) => setPageTab((v as "charges" | "appointments") ?? "charges")}>
        <TabsList>
          <TabsTrigger value="charges"><Store className="w-4 h-4 mr-2" /> Post Charges</TabsTrigger>
          <TabsTrigger value="appointments"><CalendarClock className="w-4 h-4 mr-2" /> Appointments</TabsTrigger>
        </TabsList>

        <TabsContent value="charges" className="m-0">
    <div className="flex flex-col md:flex-row gap-8 min-h-[calc(100vh-4rem)]">

      {/* Left Column: Search & Post */}
      <div className="flex-1 space-y-6">
        {/* 0. Outlet */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            Outlet
          </h2>
          <Select value={selectedOutletId || "none"} onValueChange={(val) => setSelectedOutletId(val === "none" ? "" : (val ?? ""))}>
            <SelectTrigger>
              <SelectValue>{selectedOutletId ? outlets.find(o => o.id === selectedOutletId)?.name : "All charge codes (no outlet)"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All charge codes (no outlet)</SelectItem>
              {outlets.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-2">Selecting an outlet scopes the charge codes below to that outlet's own list, and attributes the revenue to it.</p>
        </div>

        {/* 1. Find Guest / Start Walk-in */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              {mode === "guest" ? <Search className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}
              {mode === "guest" ? "Find Guest" : "Walk-in Guest"}
            </h2>
            <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
              <button type="button" className={`px-3 py-1.5 ${mode === "guest" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => { setMode("guest"); setSelectedGuest(null); setWalkInFolioId(null) }}>
                Guest
              </button>
              <button type="button" className={`px-3 py-1.5 ${mode === "walkin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => { setMode("walkin"); setSelectedGuest(null) }}>
                Walk-in
              </button>
            </div>
          </div>

          {mode === "guest" ? (
            <>
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
                        <StatusBadge label={g.status} status={g.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {searchQuery && guests.length === 0 && !loadingSearch && (
                <p className="text-sm text-muted-foreground mt-4 text-center">No active guests found matching "{searchQuery}"</p>
              )}
            </>
          ) : walkInFolioId ? (
            <div className="flex items-center justify-between bg-muted rounded-lg p-4">
              <div>
                <p className="font-bold text-foreground">{selectedGuest?.guestName}</p>
                <p className="text-sm text-muted-foreground">Walk-in bill open</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setIsWalkInPanelOpen(true)}>
                <Receipt className="w-4 h-4 mr-2" /> View / Close Bill
              </Button>
            </div>
          ) : (
            <form onSubmit={handleStartWalkIn} className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Guest name"
                required
                value={walkInForm.name}
                onChange={(e) => setWalkInForm(p => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Phone / email (optional)"
                value={walkInForm.contact}
                onChange={(e) => setWalkInForm(p => ({ ...p, contact: e.target.value }))}
              />
              <Button type="submit" className="col-span-2" disabled={startingWalkIn || !walkInForm.name}>
                {startingWalkIn ? "Starting..." : "Start Walk-in Bill"}
              </Button>
            </form>
          )}
        </div>

        {/* 2. Post Charge */}
        <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!selectedGuest ? 'opacity-50 pointer-events-none border-border' : 'border-border shadow-md ring-1 ring-border'}`}>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            {mode === "walkin" ? "Post Charge to Walk-in Bill" : `Route Charge to Room ${selectedGuest ? selectedGuest.roomNumber : ""}`}
          </h2>

          <form onSubmit={handlePostCharge} className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Charge Code{selectedOutletId ? "" : " (Outlet)"}</Label>
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
        </TabsContent>

        <TabsContent value="appointments" className="m-0">
          {selectedOutletId ? (
            <OutletAppointmentsPanel
              outletId={selectedOutletId}
              outletName={outlets.find(o => o.id === selectedOutletId)?.name || "Outlet"}
              chargeCodes={chargeCodes}
              propertyId={currentProperty?.id ?? ""}
            />
          ) : (
            <EmptyState icon={CalendarClock} title="Select an outlet above to view or book appointments" />
          )}
        </TabsContent>
      </Tabs>

      <WalkInFolioPanel
        folioId={walkInFolioId}
        isOpen={isWalkInPanelOpen}
        onClose={() => setIsWalkInPanelOpen(false)}
        onClosed={() => {
          setIsWalkInPanelOpen(false)
          setWalkInFolioId(null)
          setSelectedGuest(null)
          setWalkInForm({ name: "", contact: "" })
        }}
      />
    </div>
  )
}
