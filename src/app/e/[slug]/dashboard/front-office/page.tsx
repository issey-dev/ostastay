"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { format } from "date-fns"
import { LogIn, LogOut, CheckCircle, BedDouble, ReceiptText, MessageSquare, ArrowLeftRight, Search, UserX, Users, Star, Utensils, Bell, Key, FileText, AlertTriangle, MoreHorizontal, Send } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { deriveReservationState, reservationStateLabel, canCheckIn } from "@/lib/reservation-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { TracePanel } from "@/components/front-office/trace-panel"
import { RoomMoveModal } from "@/components/front-office/room-move-modal"
import { AssignRoomDialog } from "@/components/front-office/assign-room-dialog"
import { useProperty } from "@/components/providers/property-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CheckInWizard } from "@/components/front-office/check-in-wizard"
import { ERegistrationPanel } from "@/components/front-office/eregistration-panel"

// ── Shared row helpers ───────────────────────────────────────────────────────
const guestDisplayName = (g: any) =>
  g?.profileType === "COMPANY" || g?.profileType === "TRAVEL_AGENT"
    ? g?.companyName ?? ""
    : `${g?.firstName ?? ""} ${g?.lastName ?? ""}`.trim()

const nightsBetween = (ci: string, co: string) =>
  Math.max(1, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86_400_000))

const getActiveTasks = (res: any) =>
  (res.assignments ?? []).flatMap((a: any) => a.room?.housekeepingTasks ?? []).filter((t: any) => t.status !== "COMPLETED")

const FLAG_TONE: Record<string, string> = {
  info: "bg-info-muted text-info ring-info/20",
  warning: "bg-warning-muted text-warning ring-warning/20",
  destructive: "bg-destructive-muted text-destructive ring-destructive/20",
}

// Slim "Includes" chips for the front desk — meal plan, scheduled room move, and
// active housekeeping requests. (Full flag set lives on the Reservations list.)
function FrontDeskFlags({ res }: { res: any }) {
  const flags: { key: string; icon: any; text?: string; title: string; tone: string }[] = []
  if (res.mealPlan && res.mealPlan !== "NONE")
    flags.push({ key: "meal", icon: Utensils, text: res.mealPlan, title: `Meal plan: ${res.mealPlan}`, tone: "info" })
  if (res.hasScheduledRoomMove)
    flags.push({ key: "move", icon: ArrowLeftRight, title: "Scheduled room move during the stay", tone: "warning" })
  const tasks = getActiveTasks(res).length
  if (tasks > 0)
    flags.push({ key: "task", icon: Bell, text: String(tasks), title: `${tasks} active housekeeping request${tasks > 1 ? "s" : ""}`, tone: "destructive" })
  if (flags.length === 0) return <span className="text-xs text-muted-foreground/60">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {flags.map((f) => {
        const Icon = f.icon
        return (
          <span key={f.key} title={f.title} className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${FLAG_TONE[f.tone]}`}>
            <Icon className="h-3 w-3 shrink-0" />
            {f.text}
          </span>
        )
      })}
    </div>
  )
}

const money = (n: number) => `$${(n ?? 0).toFixed(2)}`

export default function FrontOfficeDashboard() {
  const { currentProperty } = useProperty()
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const confirm = useConfirm()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean } | null>(null)
  const [checkInRes, setCheckInRes] = useState<any>(null)
  const [noShowRes, setNoShowRes] = useState<any>(null)
  const [eRegRes, setERegRes] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState("")
  
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

  // Assign Room Dialog State (for TBA arrivals — assign without checking in)
  const [assignData, setAssignData] = useState<{
    reservationId: string;
    assignmentId: string;
    roomTypeId: string;
    roomTypeName: string;
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
        if (await confirm({ title: "Check out early?", description: data.error, confirmLabel: "Check out anyway" })) {
          await handleCheckOut(id, true)
        }
        return
      } else {
        setNotification({ title: "Check-out Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
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

  const viewUrl = (id: string) => `/e/${slug}/dashboard/reservations/${id}`
  const openRegCard = (id: string) => window.open(`/e/${slug}/dashboard/reservations/${id}/registration-card`, "_blank")

  const openAssign = (res: any) => {
    const seg = res.assignments?.[0]
    if (!seg) return
    setAssignData({
      reservationId: res.id,
      assignmentId: seg.id,
      roomTypeId: seg.roomTypeId ?? seg.roomType?.id ?? "",
      roomTypeName: seg.roomType?.name ?? "",
      checkInDate: new Date(res.checkInDate).toISOString().split("T")[0],
      checkOutDate: new Date(res.checkOutDate).toISOString().split("T")[0],
    })
  }

  // Shared row cells so every tab's table reads like the Reservations list.
  const bd = currentProperty?.businessDate
  const renderStatus = (res: any) => {
    const st = deriveReservationState(res.status, res.checkInDate, res.checkOutDate, bd)
    return <StatusBadge label={reservationStateLabel(st)} status={st} />
  }
  const guestCell = (res: any, warn = false) => (
    <>
      <div className="font-medium flex items-center gap-1.5">
        <span className="truncate">{guestDisplayName(res.primaryGuest)}</span>
        {res.primaryGuest?.vipLevel && <span title="VIP"><Star className="h-4 w-4 text-warning shrink-0" /></span>}
        {warn && res.profileIncomplete && (
          <span title="Guest profile incomplete — missing nationality, date of birth, or ID">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          </span>
        )}
        {res.traces?.length > 0 && (
          <span className="relative flex h-2.5 w-2.5" title={`${res.traces.length} active message(s)/task(s)`}>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
          </span>
        )}
      </div>
      <div className="text-xs font-mono text-muted-foreground truncate">{res.confirmationNo}</div>
    </>
  )
  const stayCell = (res: any) => {
    const nights = nightsBetween(res.checkInDate, res.checkOutDate)
    return (
      <>
        <div className="text-sm text-foreground whitespace-nowrap">
          {format(new Date(res.checkInDate), "dd MMM")} → {format(new Date(res.checkOutDate), "dd MMM yy")}
        </div>
        <div className="text-xs text-muted-foreground">{nights} {nights === 1 ? "night" : "nights"}</div>
      </>
    )
  }
  const roomCell = (res: any) => {
    const first = res.assignments?.[0]
    const extra = (res.assignments?.length ?? 0) > 1 ? res.assignments.length - 1 : 0
    if (!first) return <span className="text-sm text-muted-foreground">No rooms</span>
    return (
      <div className="flex items-baseline gap-1.5 truncate">
        <span className="text-sm font-semibold">{first.room?.roomNumber || "TBA"}</span>
        <span className="text-xs text-muted-foreground">{first.roomType?.code}</span>
        {extra > 0 && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1 ring-1 ring-inset ring-border" title={`${res.assignments.length} rooms on this booking`}>
            +{extra}
          </span>
        )}
      </div>
    )
  }

  // Phone rendering for the four operations tabs. The tables are six or seven columns
  // wide — on a 390px screen that is a horizontal scroll per row, so the desk cannot see
  // a guest and their actions at the same time. Each row becomes a card instead: guest
  // and conf. # up top, the stay/room/balance facts as a small grid, then the same
  // actions as the table, full width and thumb-sized.
  //
  // Deliberately shares guestCell/stayCell/roomCell/renderStatus with the table rather
  // than restating them — the two views must never drift into showing different facts.
  const MobileResCard = ({
    res,
    balance,
    children,
  }: {
    res: any
    /** Departures and In-House show it; Arrivals has nothing to settle yet. */
    balance?: number
    /** The tab's own action buttons, laid out by the caller. */
    children: React.ReactNode
  }) => (
    <div
      className="rounded-lg border border-border bg-card p-4 space-y-3 cursor-pointer"
      onClick={() => router.push(viewUrl(res.id))}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{guestCell(res, true)}</div>
        <div className="shrink-0">{renderStatus(res)}</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <div>{stayCell(res)}</div>
        <div>{roomCell(res)}</div>
        {balance !== undefined && (
          <div className={`tabular-nums ${balance > 0.005 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
            {money(balance)}
          </div>
        )}
      </div>

      <FrontDeskFlags res={res} />

      {/* stopPropagation so tapping an action never also opens the reservation. */}
      <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )

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
        <Button onClick={() => router.push(`/e/${slug}/dashboard/reservations/new?walkin=1`)}>
          <LogIn className="mr-2 h-4 w-4" /> Walk-in Booking
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Arrivals — checked in of expected */}
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Arrivals</CardTitle>
            <LogIn className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold">{data?.arrivalsSummary?.checkedIn ?? 0}</span>
              <span className="text-lg font-medium text-muted-foreground">/ {data?.arrivalsSummary?.expected ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              checked in · {Math.max(0, (data?.arrivalsSummary?.expected ?? 0) - (data?.arrivalsSummary?.checkedIn ?? 0))} to arrive
            </p>
          </CardContent>
        </Card>

        {/* Departures — checked out of expected */}
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Departures</CardTitle>
            <LogOut className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold">{data?.departuresSummary?.checkedOut ?? 0}</span>
              <span className="text-lg font-medium text-muted-foreground">/ {data?.departuresSummary?.expected ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              checked out · {Math.max(0, (data?.departuresSummary?.expected ?? 0) - (data?.departuresSummary?.checkedOut ?? 0))} due out
            </p>
          </CardContent>
        </Card>

        {/* In-House — occupied rooms and the people in them */}
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In-House</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold">{data?.inHouseSummary?.rooms ?? 0}</span>
              <span className="text-sm font-medium text-muted-foreground">rooms</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span><span className="font-semibold text-foreground">{data?.inHouseSummary?.adults ?? 0}</span> Adt</span>
              <span><span className="font-semibold text-foreground">{data?.inHouseSummary?.children ?? 0}</span> Chd</span>
              <span><span className="font-semibold text-foreground">{data?.inHouseSummary?.infants ?? 0}</span> Inf</span>
            </div>
          </CardContent>
        </Card>

        {/* Room Status — occupied/vacant split and housekeeping readiness */}
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Room Status</CardTitle>
            <BedDouble className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold">{data?.roomStatusSummary?.occupied ?? 0}</span>
              <span className="text-sm font-medium text-muted-foreground">occ ·</span>
              <span className="text-3xl font-bold">{data?.roomStatusSummary?.vacant ?? 0}</span>
              <span className="text-sm font-medium text-muted-foreground">vac</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> {data?.roomStatusSummary?.clean ?? 0} Clean</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" /> {data?.roomStatusSummary?.inspected ?? 0} Insp</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> {data?.roomStatusSummary?.dirty ?? 0} Dirty</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operations Tabs */}
      <Card className="shadow-elevation-1">
        <Tabs defaultValue="arrivals" className="w-full">
          <CardHeader className="border-b px-6 py-4 bg-muted/50 rounded-t-xl space-y-3">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              {/* 2x2 on a phone, one row from md up. grid-cols-4 at every width gave
                  each trigger ~90px on a 390px screen while the labels are ~110px and
                  whitespace-nowrap, so "In-House" and "Room Moves" overlapped and
                  clipped. Wrapping beats horizontal scrolling here — all four counts
                  stay visible, which is the point of the strip.
                  The h-auto pair overrides the primitive's data-horizontal:h-8, which is
                  an attribute selector and so outranks a plain h-auto. */}
              <TabsList className="grid h-auto w-full max-w-2xl grid-cols-2 gap-1 data-horizontal:h-auto md:h-8 md:grid-cols-4 md:gap-0 md:data-horizontal:h-8">
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
            {/* Arrivals Tab — Check-In, Assign Room (TBA), Reg Card; ⚠ on incomplete profiles */}
            <TabsContent value="arrivals" className="m-0 border-none outline-none">
              {/* Phone view — see MobileResCard. The table below takes over at md. */}
              <div className="md:hidden">
                {loadError ? (
                  <ErrorState title="Couldn't load arrivals" onRetry={fetchSummary} />
                ) : arrivals.length === 0 ? (
                  <EmptyState icon={LogIn} title="No arrivals scheduled for today" />
                ) : (
                  <div className="space-y-3 p-4">
                    {arrivals.map((res: any) => {
                      const unassigned = !res.assignments?.[0]?.room
                      return (
                        <MobileResCard key={res.id} res={res}>
                          {unassigned && (
                            <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => openAssign(res)}>
                              <BedDouble className="h-3.5 w-3.5 mr-1.5" /> Assign
                            </Button>
                          )}
                          {canCheckIn(res.status, res.checkInDate, bd) && (
                            <Button size="sm" variant="outline" className="h-9 flex-1 bg-success-muted text-success hover:bg-success-muted/70 border border-success/30" onClick={() => setCheckInRes(res)}>
                              <Key className="h-3.5 w-3.5 mr-1.5" /> Check In
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => openRegCard(res.id)}>
                            <FileText className="h-3.5 w-3.5 mr-1.5" /> Reg Card
                          </Button>
                          <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => setERegRes(res)}>
                            <Send className="h-3.5 w-3.5 mr-1.5" /> eReg
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-9 w-9" aria-label="More actions" />}>
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-44">
                              <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                                <MessageSquare className="h-4 w-4 mr-2" /> Traces
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="cursor-pointer text-destructive" onClick={() => setNoShowRes(res)}>
                                <UserX className="h-4 w-4 mr-2" /> Mark no-show
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </MobileResCard>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Guest</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Includes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadError ? (
                      <TableRow><TableCell colSpan={6} className="py-0"><ErrorState title="Couldn't load arrivals" onRetry={fetchSummary} /></TableCell></TableRow>
                    ) : arrivals.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="py-0"><EmptyState icon={LogIn} title="No arrivals scheduled for today" /></TableCell></TableRow>
                    ) : arrivals.map((res: any) => {
                      const unassigned = !res.assignments?.[0]?.room
                      return (
                        <TableRow key={res.id} className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                          <TableCell className="pl-6 align-middle">{guestCell(res, true)}</TableCell>
                          <TableCell className="align-middle">{stayCell(res)}</TableCell>
                          <TableCell className="align-middle">{roomCell(res)}</TableCell>
                          <TableCell className="align-middle"><FrontDeskFlags res={res} /></TableCell>
                          <TableCell className="align-middle">{renderStatus(res)}</TableCell>
                          <TableCell className="align-middle text-right pr-6" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {unassigned && (
                                <Button size="sm" variant="outline" className="h-8" onClick={() => openAssign(res)}>
                                  <BedDouble className="h-3.5 w-3.5 mr-1.5" /> Assign
                                </Button>
                              )}
                              <Button size="sm" variant="outline" className="h-8" onClick={() => openRegCard(res.id)} title="Print registration card">
                                <FileText className="h-3.5 w-3.5 mr-1.5" /> Reg Card
                              </Button>
                              <Button size="sm" variant="outline" className="h-8" onClick={() => setERegRes(res)} title="Send the guest a link to fill in their own registration details">
                                <Send className="h-3.5 w-3.5 mr-1.5" /> eReg
                              </Button>
                              {canCheckIn(res.status, res.checkInDate, bd) && (
                                <Button size="sm" variant="outline" className="h-8 bg-success-muted text-success hover:bg-success-muted/70 border border-success/30" onClick={() => setCheckInRes(res)}>
                                  <Key className="h-3.5 w-3.5 mr-1.5" /> Check In
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" title="More actions" aria-label="More actions" />}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="w-44">
                                  <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                                    <FileText className="h-4 w-4 mr-2" /> View details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                                    <MessageSquare className="h-4 w-4 mr-2" /> Traces
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="cursor-pointer text-destructive" onClick={() => setNoShowRes(res)}>
                                    <UserX className="h-4 w-4 mr-2" /> Mark no-show
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Departures Tab — balance shown, Folio + Check-Out */}
            <TabsContent value="departures" className="m-0 border-none outline-none">
              <div className="md:hidden">
                {loadError ? (
                  <ErrorState title="Couldn't load departures" onRetry={fetchSummary} />
                ) : departures.length === 0 ? (
                  <EmptyState icon={LogOut} title="No departures scheduled for today" />
                ) : (
                  <div className="space-y-3 p-4">
                    {departures.map((res: any) => (
                      <MobileResCard key={res.id} res={res} balance={res.balance}>
                        <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
                        </Button>
                        <Button size="sm" variant="outline" className="h-9 flex-1" disabled={actionLoading === res.id} onClick={() => handleCheckOut(res.id)}>
                          <LogOut className="h-3.5 w-3.5 mr-1.5" /> {actionLoading === res.id ? "..." : "Check Out"}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-9 w-9" aria-label="More actions" />}>
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-44">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                              <MessageSquare className="h-4 w-4 mr-2" /> Traces
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </MobileResCard>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Guest</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Includes</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadError ? (
                      <TableRow><TableCell colSpan={7} className="py-0"><ErrorState title="Couldn't load departures" onRetry={fetchSummary} /></TableCell></TableRow>
                    ) : departures.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-0"><EmptyState icon={LogOut} title="No departures scheduled for today" /></TableCell></TableRow>
                    ) : departures.map((res: any) => (
                      <TableRow key={res.id} className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                        <TableCell className="pl-6 align-middle">{guestCell(res)}</TableCell>
                        <TableCell className="align-middle">{stayCell(res)}</TableCell>
                        <TableCell className="align-middle">{roomCell(res)}</TableCell>
                        <TableCell className="align-middle"><FrontDeskFlags res={res} /></TableCell>
                        <TableCell className={`align-middle text-right tabular-nums ${res.balance > 0.005 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{money(res.balance)}</TableCell>
                        <TableCell className="align-middle">{renderStatus(res)}</TableCell>
                        <TableCell className="align-middle text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-8" onClick={() => openFolio(res.id)}>
                              <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
                            </Button>
                            <Button size="sm" variant="outline" className="h-8" disabled={actionLoading === res.id} onClick={() => handleCheckOut(res.id)}>
                              <LogOut className="h-3.5 w-3.5 mr-1.5" /> {actionLoading === res.id ? "..." : "Check Out"}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" title="More actions" aria-label="More actions" />}>
                                <MoreHorizontal className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="w-44">
                                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                                  <FileText className="h-4 w-4 mr-2" /> View details
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                                  <MessageSquare className="h-4 w-4 mr-2" /> Traces
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* In-House Tab — balance shown, Folio + Move Room */}
            <TabsContent value="inhouse" className="m-0 border-none outline-none">
              <div className="md:hidden">
                {loadError ? (
                  <ErrorState title="Couldn't load in-house guests" onRetry={fetchSummary} />
                ) : inHouse.length === 0 ? (
                  <EmptyState icon={CheckCircle} title="No guests currently in-house" />
                ) : (
                  <div className="space-y-3 p-4">
                    {inHouse.map((res: any) => (
                      <MobileResCard key={res.id} res={res} balance={res.balance}>
                        <Button size="sm" variant="outline" className="h-9 flex-1" onClick={() => openFolio(res.id)}>
                          <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
                        </Button>
                        <Button size="sm" variant="outline" className="h-9 flex-1 text-warning hover:text-warning hover:bg-warning-muted" onClick={() => openRoomMove(res)}>
                          <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> Move
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-9 w-9" aria-label="More actions" />}>
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-44">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                              <MessageSquare className="h-4 w-4 mr-2" /> Traces
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </MobileResCard>
                    ))}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Guest</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Includes</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadError ? (
                      <TableRow><TableCell colSpan={7} className="py-0"><ErrorState title="Couldn't load in-house guests" onRetry={fetchSummary} /></TableCell></TableRow>
                    ) : inHouse.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-0"><EmptyState icon={CheckCircle} title="No guests currently in-house" /></TableCell></TableRow>
                    ) : inHouse.map((res: any) => (
                      <TableRow key={res.id} className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                        <TableCell className="pl-6 align-middle">{guestCell(res)}</TableCell>
                        <TableCell className="align-middle">{stayCell(res)}</TableCell>
                        <TableCell className="align-middle">{roomCell(res)}</TableCell>
                        <TableCell className="align-middle"><FrontDeskFlags res={res} /></TableCell>
                        <TableCell className={`align-middle text-right tabular-nums ${res.balance > 0.005 ? "font-semibold" : "text-muted-foreground"}`}>{money(res.balance)}</TableCell>
                        <TableCell className="align-middle">{renderStatus(res)}</TableCell>
                        <TableCell className="align-middle text-right pr-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-8" onClick={() => openFolio(res.id)}>
                              <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-warning hover:text-warning hover:bg-warning-muted" onClick={() => openRoomMove(res)}>
                              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> Move
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" title="More actions" aria-label="More actions" />}>
                                <MoreHorizontal className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="w-44">
                                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                                  <FileText className="h-4 w-4 mr-2" /> View details
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer" onClick={() => openTraces(res.id, guestDisplayName(res.primaryGuest))}>
                                  <MessageSquare className="h-4 w-4 mr-2" /> Traces
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Room Moves Tab — scheduled moves; Move Room opens the move dialog
                (which also assigns the target room when it's still unassigned). */}
            <TabsContent value="roommoves" className="m-0 border-none outline-none">
              {/* Room moves are their own shape (from/to rooms, not a reservation row),
                  so this card is written out rather than reusing MobileResCard. */}
              <div className="md:hidden">
                {loadError ? (
                  <ErrorState title="Couldn't load room moves" onRetry={fetchSummary} />
                ) : (data?.roomMovesToday?.length ?? 0) === 0 ? (
                  <EmptyState icon={ArrowLeftRight} title="No room moves scheduled for today" />
                ) : (
                  <div className="space-y-3 p-4">
                    {data.roomMovesToday.map((mv: any) => {
                      const res = (data?.inHouse ?? []).find((r: any) => r.id === mv.reservationId)
                      const unassigned = !mv.toRoomNumber
                      return (
                        <div
                          key={mv.reservationId}
                          className={`rounded-lg border border-border bg-card p-4 space-y-3 ${res ? "cursor-pointer" : ""}`}
                          onClick={() => res && router.push(viewUrl(mv.reservationId))}
                        >
                          <div>
                            <div className="font-medium truncate">{guestDisplayName(mv.primaryGuest)}</div>
                            <div className="text-xs font-mono text-muted-foreground truncate">{mv.confirmationNo}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="outline">{mv.fromRoomNumber ?? "—"}</Badge>
                            <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                            {unassigned ? (
                              <span className="text-xs font-medium text-destructive">Unassigned</span>
                            ) : (
                              <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">{mv.toRoomNumber}</Badge>
                            )}
                            <span className="text-muted-foreground text-xs">{mv.toRoomTypeName}</span>
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-9 w-full text-warning hover:text-warning hover:bg-warning-muted" disabled={!res} onClick={() => res && openRoomMove(res)}>
                              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> {unassigned ? "Assign / Move" : "Move Room"}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-6">Guest</TableHead>
                      <TableHead>Conf. #</TableHead>
                      <TableHead>From Room</TableHead>
                      <TableHead>To Room</TableHead>
                      <TableHead>New Room Type</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadError ? (
                      <TableRow><TableCell colSpan={6} className="py-0"><ErrorState title="Couldn't load room moves" onRetry={fetchSummary} /></TableCell></TableRow>
                    ) : (data?.roomMovesToday?.length ?? 0) === 0 ? (
                      <TableRow><TableCell colSpan={6} className="py-0"><EmptyState icon={ArrowLeftRight} title="No room moves scheduled for today" /></TableCell></TableRow>
                    ) : data.roomMovesToday.map((mv: any) => {
                      const res = (data?.inHouse ?? []).find((r: any) => r.id === mv.reservationId)
                      const unassigned = !mv.toRoomNumber
                      return (
                        <TableRow key={mv.reservationId} className={res ? "cursor-pointer" : ""} onClick={() => res && router.push(viewUrl(mv.reservationId))}>
                          <TableCell className="pl-6 align-middle font-medium">{guestDisplayName(mv.primaryGuest)}</TableCell>
                          <TableCell className="align-middle text-muted-foreground font-mono text-xs">{mv.confirmationNo}</TableCell>
                          <TableCell className="align-middle"><Badge variant="outline">{mv.fromRoomNumber ?? "—"}</Badge></TableCell>
                          <TableCell className="align-middle">
                            {unassigned
                              ? <span className="text-xs font-medium text-destructive">Unassigned</span>
                              : <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">{mv.toRoomNumber}</Badge>}
                          </TableCell>
                          <TableCell className="align-middle text-muted-foreground">{mv.toRoomTypeName}</TableCell>
                          <TableCell className="align-middle text-right pr-6" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-8 text-warning hover:text-warning hover:bg-warning-muted" disabled={!res} onClick={() => res && openRoomMove(res)}>
                              <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" /> {unassigned ? "Assign / Move" : "Move Room"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
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
              Mark {noShowRes?.primaryGuest?.firstName} {noShowRes?.primaryGuest?.lastName}&apos;s reservation
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

      {/* eRegistration — the same panel as the reservation detail page, in a dialog */}
      <Dialog open={!!eRegRes} onOpenChange={(open) => !open && setERegRes(null)}>
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> eRegistration — {guestDisplayName(eRegRes?.primaryGuest)} ({eRegRes?.confirmationNo})
            </DialogTitle>
            <DialogDescription>A shareable link for the guest to fill in their own registration details.</DialogDescription>
          </DialogHeader>
          {eRegRes && <ERegistrationPanel reservationId={eRegRes.id} embedded />}
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

      <AssignRoomDialog
        isOpen={!!assignData}
        onClose={() => setAssignData(null)}
        propertyId={propertyId ?? ""}
        reservationId={assignData?.reservationId ?? null}
        assignmentId={assignData?.assignmentId ?? null}
        roomTypeId={assignData?.roomTypeId ?? null}
        roomTypeName={assignData?.roomTypeName}
        checkInDate={assignData?.checkInDate}
        checkOutDate={assignData?.checkOutDate}
        onAssigned={(message) => {
          setNotification({ title: "Room Assigned", message })
          fetchSummary()
        }}
      />
    </div>
  )
}
