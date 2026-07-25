"use client"

import { useEffect, useState } from "react"
import { MonitorPlay, LogIn, LogOut, CheckCircle, BedDouble, ReceiptText, MessageSquare, BellDot, ArrowLeftRight, Search, UserX } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { TracePanel } from "@/components/front-office/trace-panel"
import { RoomMoveModal } from "@/components/front-office/room-move-modal"
import { useProperty } from "@/components/providers/property-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CheckInWizard } from "@/components/front-office/check-in-wizard"
import { WalkInBookingDialog } from "@/components/front-office/walk-in-booking-dialog"

export default function FrontOfficeDashboard() {
  const { currentProperty } = useProperty()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean } | null>(null)
  const [checkInRes, setCheckInRes] = useState<any>(null)
  const [noShowRes, setNoShowRes] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [isWalkInOpen, setIsWalkInOpen] = useState(false)
  
  // Folio Modal State
  const [folioPanelResId, setFolioPanelResId] = useState<string | null>(null)
  const [isFolioPanelOpen, setIsFolioPanelOpen] = useState(false)

  // Trace Modal State
  const [tracePanelResId, setTracePanelResId] = useState<string | null>(null)
  const [traceGuestName, setTraceGuestName] = useState("")
  const [isTracePanelOpen, setIsTracePanelOpen] = useState(false)

  // Room Move Modal State
  const [isRoomMoveModalOpen, setIsRoomMoveModalOpen] = useState(false)
  const [roomMoveData, setRoomMoveData] = useState<{
    reservationId: string;
    currentRoomNumber: string;
    currentRoomType: string;
    checkInDate: string;
    checkOutDate: string;
  } | null>(null)

  const propertyId = currentProperty?.id

  useEffect(() => {
    fetchSummary()
  }, [currentProperty])

  const fetchSummary = async () => {
    if (!propertyId) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/front-office/summary?propertyId=${propertyId}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch (e) {
      console.error(e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  // Check-out goes through its dedicated route — the generic status endpoint is a
  // guarded state machine that rejects CHECKED_OUT directly. Check-in opens the
  // CheckInWizard (Room → Identification → Registration Card → Confirm) instead of a bare POST.
  const handleCheckOut = async (id: string, early = false) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/reservations/${id}/check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ early }),
      })
      const data = await res.json()
      if (res.ok) {
        const warning = data.creditLimitWarning
          ? ` Note: this account is now over its credit limit ($${data.creditLimitWarning.balance.toFixed(2)} of $${data.creditLimitWarning.creditLimit.toFixed(2)}).`
          : ""
        setNotification({ title: "Check-out Complete", message: `Guest has been successfully checked out and room marked as dirty.${warning}` })
        await fetchSummary()
      } else if (data.earlyCheckoutRequired && !early) {
        // Not due out yet — offer an explicit early check-out.
        setActionLoading(null)
        if (window.confirm(`${data.error}\n\nCheck out early anyway?`)) {
          await handleCheckOut(id, true)
        }
        return
      } else {
        setNotification({ title: "Check-out Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "An error occurred during check-out.", isError: true })
    } finally {
      setActionLoading(null)
    }
  }

  const handleNoShow = async () => {
    if (!noShowRes) return
    setActionLoading(noShowRes.id)
    try {
      const res = await fetch(`/api/reservations/${noShowRes.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "NO_SHOW" }),
      })
      const data = await res.json()
      if (res.ok) {
        setNotification({ title: "Marked No-Show", message: `${noShowRes.confirmationNo} has been marked as a no-show. Any deposit stays on the folio for refund or fee handling.` })
        await fetchSummary()
      } else {
        setNotification({ title: "No-Show Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred marking the no-show.", isError: true })
    } finally {
      setActionLoading(null)
      setNoShowRes(null)
    }
  }

  // Client-side quick lookup over today's operational lists — name, room, conf #.
  const matchesSearch = (res: any) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const name = `${res.primaryGuest?.firstName ?? ""} ${res.primaryGuest?.lastName ?? ""}`.toLowerCase()
    const conf = (res.confirmationNo ?? "").toLowerCase()
    const rooms = (res.assignments ?? []).map((a: any) => a.room?.roomNumber ?? "").join(" ").toLowerCase()
    return name.includes(q) || conf.includes(q) || rooms.includes(q)
  }
  const arrivals = (data?.arrivals ?? []).filter(matchesSearch)
  const departures = (data?.departures ?? []).filter(matchesSearch)
  const inHouse = (data?.inHouse ?? []).filter(matchesSearch)

  const openFolio = (reservationId: string) => {
    setFolioPanelResId(reservationId)
    setIsFolioPanelOpen(true)
  }

  const openTraces = (reservationId: string, guestName: string) => {
    setTracePanelResId(reservationId)
    setTraceGuestName(guestName)
    setIsTracePanelOpen(true)
  }

  const openRoomMove = (res: any) => {
    setRoomMoveData({
      reservationId: res.id,
      currentRoomNumber: res.assignments?.[0]?.room?.roomNumber || "Unassigned",
      currentRoomType: res.assignments?.[0]?.roomType?.name || "",
      checkInDate: new Date(res.checkInDate).toISOString().split('T')[0],
      checkOutDate: new Date(res.checkOutDate).toISOString().split('T')[0]
    })
    setIsRoomMoveModalOpen(true)
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-9 w-72 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Front Desk Operations</h2>
          <p className="text-muted-foreground">
            Business date{" "}
            <span className="font-medium text-foreground">
              {data?.businessDate
                ? new Date(data.businessDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
                : "—"}
            </span>{" "}
            · arrivals, departures, and in-house guests.
          </p>
        </div>
        <Button onClick={() => setIsWalkInOpen(true)}>
          <LogIn className="mr-2 h-4 w-4" /> Walk-in Booking
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Arrivals Today</CardTitle>
            <LogIn className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.arrivals?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Departures Today</CardTitle>
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.departures?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In-House Guests</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.inHouse?.length || 0}</div>
          </CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Vacant Rooms</CardTitle>
            <BedDouble className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.vacantRoomsCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{data?.vacantReadyCount ?? 0} clean &amp; ready</p>
          </CardContent>
        </Card>
      </div>

      {/* Operations Tabs */}
      <Card className="shadow-elevation-1">
        <Tabs defaultValue="arrivals" className="w-full">
          <CardHeader className="border-b px-6 py-4 bg-muted/50 rounded-t-xl space-y-3">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <TabsList className="grid w-full max-w-2xl grid-cols-4">
                <TabsTrigger value="arrivals">Arrivals ({arrivals.length})</TabsTrigger>
                <TabsTrigger value="departures">Departures ({departures.length})</TabsTrigger>
                <TabsTrigger value="inhouse">In-House ({inHouse.length})</TabsTrigger>
                <TabsTrigger value="roommoves">Room Moves ({data?.roomMovesToday?.length})</TabsTrigger>
              </TabsList>
              <div className="relative md:ml-auto md:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Guest, room, or conf. #..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0">
            {/* Arrivals Tab */}
            <TabsContent value="arrivals" className="m-0 border-none outline-none">
              {/* Mobile: stacked cards instead of a cramped horizontally-scrolled table */}
              <div className="md:hidden divide-y divide-border">
                {loadError ? (
                  <ErrorState title="Couldn't load arrivals" onRetry={fetchSummary} />
                ) : arrivals.length === 0 ? (
                  <EmptyState icon={LogIn} title="No arrivals scheduled for today" />
                ) : (
                  arrivals.map((res: any) => (
                    <div key={res.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{res.primaryGuest.firstName} {res.primaryGuest.lastName}</span>
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                        <span className="text-muted-foreground font-mono text-xs shrink-0">{res.confirmationNo}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{res.assignments?.[0]?.roomType?.name}</span>
                        {res.assignments?.[0]?.room ? (
                          <Badge variant="outline" className="bg-muted">{res.assignments[0].room.roomNumber}</Badge>
                        ) : (
                          <span className="text-destructive text-xs font-medium">Unassigned</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={actionLoading === res.id}
                          onClick={() => setNoShowRes(res)}
                          title="Mark as No-Show"
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={actionLoading === res.id}
                          onClick={() => setCheckInRes(res)}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-In"}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Conf. #</TableHead>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Assigned Room</TableHead>
                    <TableHead className="text-right pr-6">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadError && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-0">
                        <ErrorState title="Couldn't load arrivals" onRetry={fetchSummary} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadError && arrivals.map((res: any) => (
                    <TableRow key={res.id}>
                      <TableCell className="pl-6 font-medium">
                        <div className="flex items-center gap-2">
                          {res.primaryGuest.firstName} {res.primaryGuest.lastName}
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{res.confirmationNo}</TableCell>
                      <TableCell>{res.assignments?.[0]?.roomType?.name}</TableCell>
                      <TableCell>
                        {res.assignments?.[0]?.room ? (
                          <Badge variant="outline" className="bg-muted">{res.assignments[0].room.roomNumber}</Badge>
                        ) : (
                          <span className="text-destructive text-xs font-medium">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-6 flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={actionLoading === res.id}
                          onClick={() => setNoShowRes(res)}
                          title="Mark as No-Show"
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          className="w-24"
                          disabled={actionLoading === res.id}
                          onClick={() => setCheckInRes(res)}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-In"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loadError && arrivals.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-0">
                        <EmptyState icon={LogIn} title="No arrivals scheduled for today" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            {/* Departures Tab */}
            <TabsContent value="departures" className="m-0 border-none outline-none">
              <div className="md:hidden divide-y divide-border">
                {loadError ? (
                  <ErrorState title="Couldn't load departures" onRetry={fetchSummary} />
                ) : departures.length === 0 ? (
                  <EmptyState icon={LogOut} title="No departures scheduled for today" />
                ) : (
                  departures.map((res: any) => (
                    <div key={res.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{res.primaryGuest.firstName} {res.primaryGuest.lastName}</span>
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                        <span className="text-muted-foreground font-mono text-xs shrink-0">{res.confirmationNo}</span>
                      </div>
                      <div>
                        <Badge variant="outline">{res.assignments?.[0]?.room?.roomNumber}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="w-4 h-4 mr-2" /> Folio
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={actionLoading === res.id}
                          onClick={() => handleCheckOut(res.id)}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-Out"}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Conf. #</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadError && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-0">
                        <ErrorState title="Couldn't load departures" onRetry={fetchSummary} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadError && departures.map((res: any) => (
                    <TableRow key={res.id}>
                      <TableCell className="pl-6 font-medium">
                        <div className="flex items-center gap-2">
                          {res.primaryGuest.firstName} {res.primaryGuest.lastName}
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{res.confirmationNo}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{res.assignments?.[0]?.room?.roomNumber}</Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="w-4 h-4 mr-2" /> Folio
                        </Button>
                        <Button
                          size="sm"
                          className="w-28"
                          disabled={actionLoading === res.id}
                          onClick={() => handleCheckOut(res.id)}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-Out"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loadError && departures.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-0">
                        <EmptyState icon={LogOut} title="No departures scheduled for today" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            {/* In-House Tab */}
            <TabsContent value="inhouse" className="m-0 border-none outline-none">
              <div className="md:hidden divide-y divide-border">
                {loadError ? (
                  <ErrorState title="Couldn't load in-house guests" onRetry={fetchSummary} />
                ) : inHouse.length === 0 ? (
                  <EmptyState icon={CheckCircle} title="No guests currently in-house" />
                ) : (
                  inHouse.map((res: any) => (
                    <div key={res.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{res.primaryGuest.firstName} {res.primaryGuest.lastName}</span>
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0">{res.assignments?.[0]?.room?.roomNumber}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Departs {new Date(res.checkOutDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="w-4 h-4 mr-2" /> Folio
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 text-warning hover:text-warning hover:bg-warning-muted" onClick={() => openRoomMove(res)}>
                          Move Room
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Departure Date</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadError && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-0">
                        <ErrorState title="Couldn't load in-house guests" onRetry={fetchSummary} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadError && inHouse.map((res: any) => (
                    <TableRow key={res.id}>
                      <TableCell className="pl-6 font-medium">
                        <div className="flex items-center gap-2">
                          {res.primaryGuest.firstName} {res.primaryGuest.lastName}
                          {res.traces?.length > 0 && (
                            <div className="relative flex h-3 w-3">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
                              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" title={`${res.traces.length} active messages/tasks`}></span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{res.assignments?.[0]?.room?.roomNumber}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(res.checkOutDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</TableCell>
                      <TableCell className="text-right pr-6 flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openTraces(res.id, `${res.primaryGuest.firstName} ${res.primaryGuest.lastName}`)}>
                          <MessageSquare className="w-4 h-4 mr-2" /> Traces
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="w-4 h-4 mr-2" /> Folio
                        </Button>
                        <Button size="sm" variant="outline" className="text-warning hover:text-warning hover:bg-warning-muted" onClick={() => openRoomMove(res)}>
                          Move Room
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loadError && inHouse.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-0">
                        <EmptyState icon={CheckCircle} title="No guests currently in-house" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            {/* Room Moves Tab — informational: the room already changes automatically
                via the reservation's own segments, this is a heads-up for staff to
                coordinate the physical move (luggage, keys, housekeeping). */}
            <TabsContent value="roommoves" className="m-0 border-none outline-none">
              <div className="md:hidden divide-y divide-border">
                {loadError ? (
                  <ErrorState title="Couldn't load room moves" onRetry={fetchSummary} />
                ) : data?.roomMovesToday?.length === 0 ? (
                  <EmptyState icon={ArrowLeftRight} title="No room moves scheduled for today" />
                ) : (
                  data?.roomMovesToday?.map((mv: any) => (
                    <div key={mv.reservationId} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{mv.primaryGuest.firstName} {mv.primaryGuest.lastName}</span>
                        <span className="text-muted-foreground font-mono text-xs shrink-0">{mv.confirmationNo}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">{mv.fromRoomNumber}</Badge>
                        <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
                        <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">{mv.toRoomNumber}</Badge>
                        <span className="text-muted-foreground text-xs">({mv.toRoomTypeName})</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Conf. #</TableHead>
                    <TableHead>From Room</TableHead>
                    <TableHead>To Room</TableHead>
                    <TableHead className="pr-6">New Room Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadError && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-0">
                        <ErrorState title="Couldn't load room moves" onRetry={fetchSummary} />
                      </TableCell>
                    </TableRow>
                  )}
                  {!loadError && data?.roomMovesToday?.map((mv: any) => (
                    <TableRow key={mv.reservationId}>
                      <TableCell className="pl-6 font-medium">{mv.primaryGuest.firstName} {mv.primaryGuest.lastName}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{mv.confirmationNo}</TableCell>
                      <TableCell><Badge variant="outline">{mv.fromRoomNumber}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">{mv.toRoomNumber}</Badge></TableCell>
                      <TableCell className="pr-6 text-muted-foreground">{mv.toRoomTypeName}</TableCell>
                    </TableRow>
                  ))}
                  {!loadError && data?.roomMovesToday?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-0">
                        <EmptyState icon={ArrowLeftRight} title="No room moves scheduled for today" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Global Folio Panel */}
      <FolioPanel
        reservationId={folioPanelResId}
        propertyId={propertyId ?? ""}
        isOpen={isFolioPanelOpen}
        onClose={() => {
          setIsFolioPanelOpen(false)
          setFolioPanelResId(null)
          fetchSummary() // Refresh in case balances were settled
        }}
      />

      <TracePanel 
        reservationId={tracePanelResId}
        guestName={traceGuestName}
        isOpen={isTracePanelOpen}
        onClose={() => {
          setIsTracePanelOpen(false)
          setTracePanelResId(null)
          fetchSummary() // Refresh to clear badges if traces were resolved
        }}
      />

      {/* No-Show confirmation */}
      <Dialog open={!!noShowRes} onOpenChange={(open) => !open && setNoShowRes(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as No-Show</DialogTitle>
            <DialogDescription>
              Mark {noShowRes?.primaryGuest?.firstName} {noShowRes?.primaryGuest?.lastName}'s reservation
              ({noShowRes?.confirmationNo}) as a no-show? The room goes back on sale; any deposit stays on the folio
              for refund or fee handling.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoShowRes(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleNoShow} disabled={!!actionLoading}>
              Mark No-Show
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CheckInWizard
        reservationId={checkInRes?.id ?? null}
        propertyId={propertyId ?? ""}
        isOpen={!!checkInRes}
        onClose={() => setCheckInRes(null)}
        onDone={(result) => {
          setNotification(result)
          fetchSummary()
        }}
      />

      <WalkInBookingDialog
        propertyId={propertyId ?? ""}
        isOpen={isWalkInOpen}
        onClose={() => setIsWalkInOpen(false)}
        onDone={(result) => {
          setNotification(result)
          fetchSummary()
        }}
      />

      <Dialog open={!!notification} onOpenChange={(open) => !open && setNotification(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : undefined}>
              {notification?.title}
            </DialogTitle>
            <DialogDescription>{notification?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoomMoveModal
        isOpen={isRoomMoveModalOpen}
        onClose={() => {
          setIsRoomMoveModalOpen(false)
          setRoomMoveData(null)
          fetchSummary() // Refresh to show new room
        }}
        propertyId={propertyId ?? ""}
        reservationId={roomMoveData?.reservationId || null}
        currentRoomNumber={roomMoveData?.currentRoomNumber}
        currentRoomType={roomMoveData?.currentRoomType}
        checkInDate={roomMoveData?.checkInDate}
        checkOutDate={roomMoveData?.checkOutDate}
      />
    </div>
  )
}
