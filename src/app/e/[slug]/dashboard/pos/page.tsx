"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useUrlState } from "@/lib/use-url-state"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { useProperty } from "@/components/providers/property-provider"
import { Search, Send, Clock, Store, Coffee, ReceiptText, UserRound, Receipt, History } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SubmitButton } from "@/components/ui/submit-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { WalkInHistory } from "@/components/pos/walk-in-history"
import { MobileActionBar } from "@/components/ui/mobile"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { useIsMobile } from "@/hooks/use-mobile"
import { INPUT_MONEY } from "@/lib/input-presets"
import { PageHeader } from "@/components/ui/page-header"
import { InfoHint } from "@/components/ui/info-hint"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import {
  emptyPosCharge,
  emptyWalkInGuest,
  posChargeSchema,
  walkInGuestSchema,
  type PosChargeValues,
  type WalkInGuestValues,
} from "@/lib/sales-form-schemas"

// The last outlet picked on this device, per property — a per-desk convenience, so plain
// localStorage (it may be unavailable: private window, blocked storage — then it's ignored).
const outletKey = (propertyId: string) => `pos:lastOutlet:${propertyId}`
function readSavedOutlet(propertyId: string): string | null {
  try { return window.localStorage.getItem(outletKey(propertyId)) } catch { return null }
}
function saveOutlet(propertyId: string, outletId: string) {
  try {
    if (outletId) window.localStorage.setItem(outletKey(propertyId), outletId)
    else window.localStorage.removeItem(outletKey(propertyId))
  } catch { /* storage unavailable */ }
}

function POSDashboard() {
  const { currentProperty } = useProperty()
  // Text-only switch: the full search placeholder is cut off on a phone.
  const isMobile = useIsMobile()
  const [pageTab, setPageTab] = useUrlState<"charges" | "history">("tab", "charges", ["charges", "history"])
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [mode, setMode] = useState<"guest" | "walkin">("guest")
  const [searchQuery, setSearchQuery] = useState("")
  const [guests, setGuests] = useState<any[]>([])
  const [selectedGuest, setSelectedGuest] = useState<any>(null)

  // APP STANDARD 001: the two forms on this screen (start a walk-in bill, post a charge).
  const walkInForm = useForm<WalkInGuestValues>({ resolver: zodResolver(walkInGuestSchema), mode: "onChange", defaultValues: emptyWalkInGuest })
  const walkInName = walkInForm.watch("name")
  const [startingWalkIn, setStartingWalkIn] = useState(false)
  const [walkInFolioId, setWalkInFolioId] = useState<string | null>(null)
  const [isWalkInPanelOpen, setIsWalkInPanelOpen] = useState(false)

  const [outlets, setOutlets] = useState<any[]>([])
  const [selectedOutletId, setSelectedOutletId] = useState<string>("")

  const [chargeCodes, setChargeCodes] = useState<any[]>([])
  // The open outlet sales check for the current session (one outlet + one guest/bill).
  // The first post opens it; subsequent posts reuse its id so they group under one
  // check number (e.g. SPA-00001). Reset when the outlet or guest/bill changes.
  const [activeCheck, setActiveCheck] = useState<{ id: string; number: string } | null>(null)
  const [recentPostings, setRecentPostings] = useState<any[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [posting, setPosting] = useState(false)
  // The query the current `guests` list answers — "no match" only shows once it has run.
  const [searchedQuery, setSearchedQuery] = useState("")
  const searchSeq = useRef(0)

  const form = useForm<PosChargeValues>({ resolver: zodResolver(posChargeSchema), mode: "onChange", defaultValues: emptyPosCharge })
  const { setValue: setChargeValue } = form
  const [amount, chargeCodeId] = form.watch(["amount", "chargeCodeId"])

  // Fetch active outlets for this property — the initial data load that gates the page.
  const fetchOutlets = () => {
    if (!currentProperty) return
    setLoadError(false)
    fetch(`/api/outlets?propertyId=${currentProperty.id}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        if (!Array.isArray(data)) return
        const active = data.filter((o: any) => o.isActive)
        setOutlets(active)
        // Reopen on the outlet this desk last used here — if it still exists and is active.
        const saved = readSavedOutlet(currentProperty.id)
        if (saved && active.some((o: any) => o.id === saved)) setSelectedOutletId(saved)
      })
      .catch(() => setLoadError(true))
  }

  useEffect(() => {
    if (currentProperty) {
      fetchOutlets()
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
      fetch(`/api/charge-codes?propertyId=${currentProperty.id}`)
        .then(res => res.json())
        .then(data => setChargeCodes(data))
        .catch(console.error)
    }
    setChargeValue("chargeCodeId", "")
  }, [selectedOutletId, currentProperty, setChargeValue])

  // A "session" is one outlet + one guest/bill. Changing either ends the current outlet
  // check, so the next post opens (and numbers) a fresh one.
  useEffect(() => { setActiveCheck(null) }, [selectedGuest?.folioId, selectedOutletId])

  const handleStartWalkIn = async (values: WalkInGuestValues) => {
    if (!currentProperty) return
    setStartingWalkIn(true)
    try {
      const res = await fetch(`/api/folios/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, walkInGuestName: values.name, walkInGuestContact: values.contact })
      })
      if (res.ok) {
        const folio = await res.json()
        setWalkInFolioId(folio.id)
        setSelectedGuest({ guestName: values.name, roomNumber: "Walk-in", folioId: folio.id })
      } else {
        toast.error("Failed to start walk-in bill.")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setStartingWalkIn(false)
    }
  }

  const runSearch = async (query: string) => {
    if (!currentProperty || !query) return
    // Only the latest request may write results (typing fires several).
    const seq = ++searchSeq.current
    setLoadingSearch(true)
    try {
      const res = await fetch(`/api/pos/search?propertyId=${currentProperty.id}&query=${encodeURIComponent(query)}`)
      if (res.ok && seq === searchSeq.current) {
        const data = await res.json()
        setGuests(data)
        setSearchedQuery(query)
        setSelectedGuest(null) // Reset selection on new search
      }
    } catch (e) {
      console.error(e)
    } finally {
      if (seq === searchSeq.current) setLoadingSearch(false)
    }
  }

  // Search as you type: 300ms after the last key, from 2 characters. Enter still searches at once.
  useEffect(() => {
    if (mode !== "guest") return
    const q = searchQuery.trim()
    if (q.length < 2) return
    const t = setTimeout(() => { void runSearch(q) }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, mode, currentProperty?.id])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    void runSearch(searchQuery.trim())
  }

  // The guest/bill check runs before field validation, as it always has.
  const handlePostCharge = (e: React.FormEvent<HTMLFormElement>) => {
    if (!selectedGuest || !selectedGuest.folioId) {
      e.preventDefault()
      toast.error("Select a guest with an active folio.")
      return
    }
    void form.handleSubmit(postCharge)(e)
  }

  const postCharge = async (values: PosChargeValues) => {
    if (!selectedGuest || !selectedGuest.folioId) return
    setPosting(true)
    try {
      const payload = {
        folioId: selectedGuest.folioId,
        amount: values.amount,
        chargeCodeId: values.chargeCodeId,
        description: values.description,
        reference: values.reference,
        outletId: selectedOutletId || undefined,
        // Reuse the session's open check so this line groups under the same number.
        outletCheckId: activeCheck?.id || undefined,
      }

      const res = await fetch(`/api/pos/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const lineItem = await res.json()

        // Carry the (possibly newly opened) outlet check into the session so the next
        // post reuses its number.
        const checkNumber: string | undefined = lineItem.outletCheck?.checkNumber
        if (lineItem.outletCheck) {
          setActiveCheck({ id: lineItem.outletCheck.id, number: lineItem.outletCheck.checkNumber })
        }

        // Add to recent postings
        setRecentPostings(prev => [{
          ...lineItem,
          guestName: selectedGuest.guestName,
          roomNumber: selectedGuest.roomNumber
        }, ...prev].slice(0, 10))

        // Reset form
        form.reset({ ...emptyPosCharge, chargeCodeId: values.chargeCodeId })
        toast.success(
          mode === "walkin"
            ? `Charge posted to the walk-in bill.${checkNumber ? ` Check ${checkNumber}.` : ""}`
            : `Charge posted to Room ${selectedGuest.roomNumber}.${checkNumber ? ` Check ${checkNumber}.` : ""}`
        )
      } else {
        toast.error(await apiError(res, "Failed to post charge"))
      }
    } catch (error) {
      console.error(error)
      toast.error("An unexpected error occurred.")
    } finally {
      setPosting(false)
    }
  }

  const recentPostingsBody = (
    <>
      {recentPostings.length === 0 ? (
        <EmptyState size="inline" title="Nothing posted from this terminal yet" />
      ) : (
        <div className="divide-y divide-border">
          {recentPostings.map((item, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Room {item.roomNumber}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.chargeCode?.description || "Charge"}
                  {item.outletCheck?.checkNumber && <span className="font-mono"> · {item.outletCheck.checkNumber}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className="font-mono text-sm font-semibold text-foreground">${parseFloat(item.amount).toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )

  // Phones (the Recent Postings bottom sheet): the same list in the shared MobileCard look.
  const recentPostingsPhone = (
    <MobileCardList empty={<EmptyState icon={Coffee} title="No charges posted from this terminal yet today" className="py-10" />}>
      {recentPostings.map((item, i) => (
        <MobileCard
          key={i}
          title={`Room ${item.roomNumber}`}
          subtitle={item.chargeCode?.description || "Charge"}
          badge={<span className="font-bold text-success tabular-nums">${parseFloat(item.amount).toFixed(2)}</span>}
          meta={[
            { label: "Time", value: new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
            ...(item.outletCheck?.checkNumber
              ? [{ label: "Check #", value: <span className="font-mono text-primary">{item.outletCheck.checkNumber}</span> }]
              : []),
          ]}
        />
      ))}
    </MobileCardList>
  )

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <PageHeader
        title="Fast Post"
        hint="Select an outlet, then post charges to an in-house guest's room or a walk-in bill."
      />

      <Tabs value={pageTab} onValueChange={(v) => setPageTab((v as "charges" | "history") ?? "charges")}>
        <TabsList>
          <TabsTrigger value="charges"><Store className="w-4 h-4 mr-2" /> Post charges</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 mr-2" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="charges" className="m-0">
    {loadError ? (
      <ErrorState title="Couldn't load outlets" onRetry={fetchOutlets} />
    ) : (
    <div className="flex flex-col md:flex-row md:items-start gap-6">

      {/* Left Column: Search & Post */}
      <div className="flex-1 space-y-6">
        {/* 0. Outlet */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            Outlet
            <InfoHint label="Outlet">Selecting an outlet scopes the charge codes below to that outlet&apos;s own list, and attributes the revenue to it.</InfoHint>
          </h2>
          <Select value={selectedOutletId || "none"} onValueChange={(val) => {
            const id = val === "none" ? "" : (val ?? "")
            setSelectedOutletId(id)
            if (currentProperty) saveOutlet(currentProperty.id, id)
          }}>
            <SelectTrigger>
              <SelectValue>{selectedOutletId ? outlets.find(o => o.id === selectedOutletId)?.name : "All charge codes (no outlet)"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All charge codes (no outlet)</SelectItem>
              {outlets.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* 1. Find Guest / Start Walk-in */}
        <div className="bg-card rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              {mode === "guest" ? <Search className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}
              {mode === "guest" ? "Find guest" : "Walk-in guest"}
            </h2>
            <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
              <button type="button" className={`px-3 py-1.5 max-md:min-h-10 max-md:px-4 pointer-coarse:min-h-10 pointer-coarse:px-4 ${mode === "guest" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => { setMode("guest"); setSelectedGuest(null); setWalkInFolioId(null) }}>
                Guest
              </button>
              <button type="button" className={`px-3 py-1.5 max-md:min-h-10 max-md:px-4 pointer-coarse:min-h-10 pointer-coarse:px-4 ${mode === "walkin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => { setMode("walkin"); setSelectedGuest(null) }}>
                Walk-in
              </button>
            </div>
          </div>

          {mode === "guest" ? (
            <>
              {/* Searches as you type; Enter searches at once. Phones keep the button. */}
              <form onSubmit={handleSearch} className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={isMobile ? "Room no. or last name" : "Search by room number or last name"}
                    enterKeyHint="search"
                    aria-label="Search guests"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      if (e.target.value.trim().length < 2) { searchSeq.current++; setGuests([]); setSearchedQuery(""); setLoadingSearch(false) }
                    }}
                    className="pl-9"
                  />
                  {loadingSearch && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">Searching…</span>
                  )}
                </div>
                <Button type="submit" className="md:hidden" disabled={loadingSearch || !searchQuery}>
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
              {searchedQuery && searchedQuery === searchQuery.trim() && guests.length === 0 && !loadingSearch && (
                <EmptyState size="inline" title={`No in-house guests match "${searchedQuery}"`} className="mt-2" />
              )}
            </>
          ) : walkInFolioId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-muted rounded-lg p-4">
              <div className="min-w-0">
                <p className="truncate font-bold text-foreground">{selectedGuest?.guestName}</p>
                <p className="text-sm text-muted-foreground">Walk-in bill open</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setIsWalkInPanelOpen(true)}>
                <Receipt className="w-4 h-4 mr-2" /> View / close bill
              </Button>
            </div>
          ) : (
            <Form {...walkInForm}>
              <form onSubmit={walkInForm.handleSubmit(handleStartWalkIn)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField control={walkInForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormControl><Input placeholder="Guest name" aria-label="Guest name" {...field} /></FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
                <FormField control={walkInForm.control} name="contact" render={({ field }) => (
                  <FormItem>
                    <FormControl><Input placeholder="Phone / email (optional)" aria-label="Phone or email" {...field} /></FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
                <SubmitButton className="md:col-span-2" pending={startingWalkIn} pendingLabel="Starting…" disabled={!walkInName}>
                  Start walk-in bill
                </SubmitButton>
              </form>
            </Form>
          )}
        </div>

        {!selectedGuest && (
          <p className="md:hidden -mt-3 text-sm text-muted-foreground">
            {mode === "walkin" ? "Start a walk-in bill above to post charges." : "Find and tap a guest above to post a charge."}
          </p>
        )}

        {/* 2. Post Charge */}
        <div className={`bg-card rounded-xl shadow-sm border p-6 transition-all ${!selectedGuest ? 'opacity-50 pointer-events-none border-border' : 'border-border shadow-md ring-1 ring-border'}`}>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            {mode === "walkin" ? "Post charge to walk-in bill" : `Route charge to room ${selectedGuest ? selectedGuest.roomNumber : ""}`}
          </h2>

          <Form {...form}>
          <form id="pos-charge-form" onSubmit={handlePostCharge} className="space-y-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField control={form.control} name="chargeCodeId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Charge code{selectedOutletId ? "" : " (Outlet)"}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={(val) => field.onChange(val ?? "")}
                      placeholder="Select outlet..."
                      options={chargeCodeOptions(chargeCodes)}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      {...INPUT_MONEY}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Input placeholder="e.g., Dinner for two" {...field} /></FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />
              <FormField control={form.control} name="reference" render={({ field }) => (
                <FormItem>
                  <FormLabel>Receipt / check # (optional)</FormLabel>
                  <FormControl><Input placeholder="e.g., CHK-4092" {...field} /></FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )} />
            </div>

            <div className="flex justify-end max-md:hidden">
              <SubmitButton pending={posting} pendingLabel="Posting…" disabled={!amount || !chargeCodeId}>
                <Send className="w-4 h-4 mr-2" />
                Post to folio
              </SubmitButton>
            </div>
          </form>
          </Form>
        </div>
      </div>

      {/* Right Column: Recent Activity — desktop/tablet only, side-by-side */}
      <div className="hidden md:block w-full md:w-80 lg:w-96 shrink-0">
        <div className="bg-card rounded-xl border border-border px-4 py-3">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Recent postings
          </h3>
          {recentPostingsBody}
        </div>
      </div>

      {/* Mobile: the Post button is pinned at the bottom with the Recent Postings trigger
          beside it (a bottom sheet) — the post never scrolls away, nothing covers the form. */}
      <Sheet>
        <MobileActionBar>
          <SheetTrigger
            render={
              <Button variant="outline" size="icon-lg" className="relative shrink-0" aria-label={`Recent postings${recentPostings.length > 0 ? ` (${recentPostings.length})` : ""}`}>
                <ReceiptText className="w-4 h-4" />
                {recentPostings.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
                    {recentPostings.length}
                  </span>
                )}
              </Button>
            }
          />
          <Button
            type="submit"
            form="pos-charge-form"
            className="h-11 flex-1 min-w-0 text-base"
            disabled={posting || !selectedGuest || !amount || !chargeCodeId}
          >
            <Send className="w-4 h-4 mr-2 shrink-0" />
            <span className="truncate">
              {posting
                ? "Posting..."
                : !selectedGuest
                  ? "Post"
                  : `Post${amount && Number(amount) > 0 ? ` $${Number(amount).toFixed(2)}` : ""} ${mode === "walkin" ? "to bill" : `to Room ${selectedGuest.roomNumber}`}`}
            </span>
          </Button>
        </MobileActionBar>
        <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent postings
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">{recentPostingsPhone}</div>
        </SheetContent>
      </Sheet>
    </div>
    )}
        </TabsContent>

        <TabsContent value="history" className="m-0">
          <WalkInHistory
            propertyId={currentProperty?.id ?? ""}
            refreshKey={historyRefresh}
            onOpen={(id) => { setWalkInFolioId(id); setIsWalkInPanelOpen(true) }}
          />
        </TabsContent>
      </Tabs>

      <WalkInFolioPanel
        folioId={walkInFolioId}
        isOpen={isWalkInPanelOpen}
        onClose={() => { setIsWalkInPanelOpen(false); setHistoryRefresh((n) => n + 1) }}
        onClosed={() => {
          setIsWalkInPanelOpen(false)
          setWalkInFolioId(null)
          setSelectedGuest(null)
          walkInForm.reset(emptyWalkInGuest)
          setHistoryRefresh((n) => n + 1)
        }}
      />
    </div>
  )
}

// useUrlState reads the query string — the page needs a Suspense boundary.
export default function POSPage() {
  return (
    <Suspense>
      <POSDashboard />
    </Suspense>
  )
}
