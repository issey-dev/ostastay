"use client"

import { useEffect, useState } from "react"
import { MonitorPlay, LogIn, LogOut, CheckCircle, BedDouble, ReceiptText, MessageSquare, BellDot } from "lucide-react"
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

export default function FrontOfficeDashboard() {
  const { currentProperty } = useProperty()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  
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
    try {
      const res = await fetch(`/api/front-office/summary?propertyId=${propertyId}`)
      if (res.ok) {
        setData(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (id: string, newStatus: string) => {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/reservations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        await fetchSummary() // Refresh data
      } else {
        alert("Failed to update status. Does the reservation have a room assigned?")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setActionLoading(null)
    }
  }

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
          <p className="text-muted-foreground">Manage today's arrivals, departures, and in-house guests.</p>
        </div>
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
          </CardContent>
        </Card>
      </div>

      {/* Operations Tabs */}
      <Card className="shadow-elevation-1">
        <Tabs defaultValue="arrivals" className="w-full">
          <CardHeader className="border-b px-6 py-4 bg-muted/50 rounded-t-xl">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="arrivals">Arrivals ({data?.arrivals?.length})</TabsTrigger>
              <TabsTrigger value="departures">Departures ({data?.departures?.length})</TabsTrigger>
              <TabsTrigger value="inhouse">In-House ({data?.inHouse?.length})</TabsTrigger>
            </TabsList>
          </CardHeader>
          
          <CardContent className="p-0">
            {/* Arrivals Tab */}
            <TabsContent value="arrivals" className="m-0 border-none outline-none">
              <Table>
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
                  {data?.arrivals?.map((res: any) => (
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
                          className="w-24"
                          disabled={actionLoading === res.id || !res.assignments?.[0]?.room}
                          onClick={() => updateStatus(res.id, "IN_HOUSE")}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-In"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data?.arrivals?.length === 0 && (
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
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Conf. #</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.departures?.map((res: any) => (
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
                          onClick={() => updateStatus(res.id, "CHECKED_OUT")}
                        >
                          {actionLoading === res.id ? "Processing..." : "Check-Out"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data?.departures?.length === 0 && (
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
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-6">Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Departure Date</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.inHouse?.map((res: any) => (
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
                  {data?.inHouse?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-0">
                        <EmptyState icon={CheckCircle} title="No guests currently in-house" />
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
