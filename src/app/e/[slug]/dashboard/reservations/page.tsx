"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { CalendarDays, Plus, Pencil, Trash2, Wand2, Key, LogOut, ReceiptText, Building2, Bell, FileText, Star, Wallet, Search, Loader2, MoreHorizontal, Package, Users, ArrowLeftRight, Utensils } from "@/components/icons"
import type { DateRange } from "react-day-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import { useProperty } from "@/components/providers/property-provider"
import { useConfirm } from "@/components/providers/confirm-provider"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { DepositDialog } from "@/components/front-office/deposit-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { Input } from "@/components/ui/input"
import { format } from "date-fns"
import { StatusBadge } from "@/components/ui/status-badge"
import { deriveReservationState, reservationStateLabel, canCheckIn } from "@/lib/reservation-state"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"

type Reservation = {
  id: string
  confirmationNo: string
  /** The channel's own booking id (Beds24/OTA ref) for channel-sourced reservations. */
  externalRef: string | null
  status: string
  checkInDate: string
  checkOutDate: string
  adults: number
  children: number
  infants: number
  remarks: string | null
  mealPlan: string
  hasScheduledRoomMove: boolean
  primaryGuestId: string
  primaryGuest: { firstName: string, lastName: string, companyName: string, profileType: string, vipLevel: string | null }
  travelAgentId: string | null
  travelAgent: { companyName: string, firstName: string, lastName: string } | null
  accompanyingGuests?: { profile: { upid: string, firstName: string, lastName: string, companyName: string, profileType: string } }[]
  assignments: {
    id: string
    startDate: string
    endDate: string
    roomTypeId: string
    roomType: { code: string, name: string }
    roomId: string | null
    room: { 
      roomNumber: string
      housekeepingTasks?: { id: string, notes: string, status: string, createdAt: string }[]
    } | null
    ratePlanId: string
    ratePlan: { code: string, name: string }
    overrideRate: number | null
  }[]
  specialRequests?: { id: string, code: string }[]
  folios?: { id: string, payments?: { amount: number, isRefund: boolean }[] }[]
  allocations?: {
    id: string
    allocationId: string
    source: string
    overrideAdultPrice: number | null
    overrideChildPrice: number | null
    allocation: {
      id: string
      code: string
      name: string
      mode: string
      postingRhythm: string
      isActive: boolean
      chargeCode?: { code: string }
      rates: { adultPrice: number, childPrice: number, effectiveFrom: string, effectiveTo: string | null }[]
    }
  }[]
}

const getActiveTasks = (res: Reservation) => {
  return res.assignments?.flatMap(a => a.room?.housekeepingTasks || []).filter(t => t.status !== 'COMPLETED') || []
}

// Net payments already collected on a not-yet-arrived booking — by definition,
// money on a RESERVED reservation's folio is deposit money.
const getDepositTotal = (res: Reservation) => {
  return res.folios?.flatMap(f => f.payments || [])
    .reduce((sum, p) => sum + (p.isRefund ? -p.amount : p.amount), 0) ?? 0
}

// Compact "what's on this booking" descriptors, rendered as subtle icon/text
// chips in the list's Includes column. Only what applies shows; full detail
// lives on the reservation view page. Each carries a `title` for hover context.
type FlagTone = "muted" | "success" | "warning" | "info" | "destructive"
type Flag = { key: string; title: string; text?: string; icon?: typeof Package; tone: FlagTone }

const getReservationFlags = (res: Reservation): Flag[] => {
  const flags: Flag[] = []
  if (res.mealPlan && res.mealPlan !== "NONE") {
    flags.push({ key: "meal", text: res.mealPlan, icon: Utensils, title: `Meal plan: ${res.mealPlan}`, tone: "info" })
  }
  const pkgCount = res.allocations?.length ?? 0
  if (pkgCount > 0) {
    const codes = (res.allocations ?? []).map(a => a.allocation.code).join(", ")
    flags.push({ key: "pkg", text: String(pkgCount), icon: Package, title: `${pkgCount} package/allocation${pkgCount > 1 ? "s" : ""}: ${codes}`, tone: "muted" })
  }
  const deposit = getDepositTotal(res)
  if (res.status === "RESERVED" && deposit > 0.005) {
    flags.push({ key: "deposit", icon: Wallet, title: `Deposit $${deposit.toFixed(2)} collected`, tone: "success" })
  }
  const acc = res.accompanyingGuests?.length ?? 0
  if (acc > 0) {
    flags.push({ key: "acc", text: `+${acc}`, icon: Users, title: `${acc} accompanying guest${acc > 1 ? "s" : ""}`, tone: "muted" })
  }
  if (res.travelAgent) {
    flags.push({ key: "ta", icon: Building2, title: `Travel agent: ${res.travelAgent.companyName || res.travelAgent.firstName}`, tone: "muted" })
  }
  if (res.hasScheduledRoomMove) {
    flags.push({ key: "move", icon: ArrowLeftRight, title: "Scheduled room move during the stay", tone: "warning" })
  }
  const tasks = getActiveTasks(res).length
  if (tasks > 0) {
    flags.push({ key: "task", text: String(tasks), icon: Bell, title: `${tasks} active housekeeping request${tasks > 1 ? "s" : ""}`, tone: "destructive" })
  }
  return flags
}

const FLAG_TONE: Record<FlagTone, string> = {
  muted: "bg-muted text-muted-foreground ring-border",
  success: "bg-success-muted text-success ring-success/20",
  warning: "bg-warning-muted text-warning ring-warning/20",
  info: "bg-info-muted text-info ring-info/20",
  destructive: "bg-destructive-muted text-destructive ring-destructive/20",
}

function FlagStrip({ res, className = "" }: { res: Reservation; className?: string }) {
  const flags = getReservationFlags(res)
  if (flags.length === 0) return <span className="text-xs text-muted-foreground/60">—</span>
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {flags.map(f => {
        const Icon = f.icon
        return (
          <span
            key={f.key}
            title={f.title}
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${FLAG_TONE[f.tone]}`}
          >
            {Icon && <Icon className="h-3 w-3 shrink-0" />}
            {f.text}
          </span>
        )
      })}
    </div>
  )
}

export default function ReservationsDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const { currentProperty } = useProperty()
  const confirm = useConfirm()
  const propertyId = currentProperty?.id ?? ""
  const enterpriseId = currentProperty?.enterpriseId ?? ""

  const viewUrl = (id: string) => `/e/${slug}/dashboard/reservations/${id}`

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Modals state — the booking create/edit form itself lives on its own page now
  // (/reservations/new, /reservations/[id]/edit), not a dialog here.
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false)
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null)
  const [requestCategory, setRequestCategory] = useState("")
  const [requestText, setRequestText] = useState("")
  const [requestingRoomId, setRequestingRoomId] = useState("")

  const [housekeepingCodes, setHousekeepingCodes] = useState<any[]>([])
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [folioPanelResId, setFolioPanelResId] = useState<string | null>(null)
  const [isFolioPanelOpen, setIsFolioPanelOpen] = useState(false)
  const [depositRes, setDepositRes] = useState<Reservation | null>(null)

  // Custom Notification State
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  // Server-side filters + load-more pagination
  const PAGE_SIZE = 50
  const [filterSearch, setFilterSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [filterDates, setFilterDates] = useState<DateRange | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const buildQuery = (skip: number) => {
    const params = new URLSearchParams({ propertyId, take: String(PAGE_SIZE), skip: String(skip) })
    if (filterSearch.trim()) params.set("search", filterSearch.trim())
    if (filterStatus) params.set("status", filterStatus)
    if (filterDates?.from) params.set("from", format(filterDates.from, "yyyy-MM-dd"))
    if (filterDates?.to) params.set("to", format(filterDates.to, "yyyy-MM-dd"))
    return params
  }

  const fetchData = async () => {
    if (!currentProperty) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/reservations?${buildQuery(0)}`)
      if (!res.ok) throw new Error()
      const resData = await res.json()
      if (Array.isArray(resData)) {
        setReservations(resData)
        setHasMore(resData.length === PAGE_SIZE)
      }
    } catch (e) {
      console.error("Failed to load data", e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const more = await (await fetch(`/api/reservations?${buildQuery(reservations.length)}`)).json()
      if (Array.isArray(more)) {
        setReservations((prev) => [...prev, ...more])
        setHasMore(more.length === PAGE_SIZE)
      }
    } catch (e) {
      console.error("Failed to load more", e)
    } finally {
      setLoadingMore(false)
    }
  }

  // Refetch when filters change; text search is debounced.
  useEffect(() => {
    if (!currentProperty) return
    const t = setTimeout(fetchData, filterSearch ? 350 : 0)
    return () => clearTimeout(t)
  }, [currentProperty, filterSearch, filterStatus, filterDates])

  useEffect(() => {
    if (!currentProperty) return
    fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=HOUSEKEEPING_REQUEST`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHousekeepingCodes(d) })
      .catch(console.error)
  }, [currentProperty])

  const handleDeletePrompt = (res: Reservation) => {
    setSelectedRes(res)
    setIsDeleteModalOpen(true)
  }

  const handleRequestPrompt = (res: Reservation) => {
    // Only allow if there's an assigned room on the active segment
    const activeAssignment = res.assignments?.find(a => a.roomId)
    if (!activeAssignment?.roomId) {
      setNotification({ title: "No Room Assigned", message: "You must assign a room to this reservation before adding a Housekeeping request.", isError: true })
      return
    }
    setRequestingRoomId(activeAssignment.roomId)
    setRequestCategory("")
    setRequestText("")
    setSelectedRes(res)
    setIsRequestModalOpen(true)
  }

  const handleCreateRequest = async () => {
    // We can use either the category or the text, or both
    const categoryLabel = housekeepingCodes.find(c => c.code === requestCategory)?.value || requestCategory
    const finalNotes = [categoryLabel, requestText].filter(Boolean).join(" - ")
    if (!finalNotes.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/housekeeping/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: requestingRoomId,
          notes: finalNotes,
          priority: "HIGH"
        })
      })
      if (res.ok) {
        setIsRequestModalOpen(false)
        setNotification({ title: "Request Sent", message: "Special request has been sent to Housekeeping." })
        fetchData()
      } else {
        setNotification({ title: "Error", message: "Failed to send request.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An unexpected error occurred.", isError: true })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!selectedRes) return
    try {
      await fetch(`/api/reservations/${selectedRes.id}`, { method: "DELETE" })
      setIsDeleteModalOpen(false)
      fetchData()
      setNotification({ title: "Success", message: "Reservation deleted." })
    } catch {
      setNotification({ title: "Error", message: "Failed to delete reservation.", isError: true })
    }
  }

  const handleAutoAssign = async () => {
    setAutoAssigning(true)
    try {
      const res = await fetch(`/api/reservations/auto-assign?propertyId=${propertyId}`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setNotification({ title: "Rooms Assigned", message: `Successfully assigned ${data.assignedCount} out of ${data.totalUnassigned} unassigned reservations.` })
        fetchData()
      } else {
        setNotification({ title: "Error", message: "Failed to auto-assign rooms.", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "Error occurred during auto-assign.", isError: true })
    } finally {
      setAutoAssigning(false)
    }
  }

  // Check-in runs a procedure (Room → Identification → Registration Card → Confirm) on the
  // reservation screen; the list button opens that wizard rather than a bare POST.
  const handleCheckIn = (res: Reservation) => {
    router.push(`${viewUrl(res.id)}?checkin=1`)
  }

  const handleCheckOut = async (res: Reservation, early = false) => {
    try {
      const resp = await fetch(`/api/reservations/${res.id}/check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ early }),
      })
      const data = await resp.json()
      if (resp.ok) {
        const warning = data.creditLimitWarning
          ? ` Note: this account is now over its credit limit ($${data.creditLimitWarning.balance.toFixed(2)} of $${data.creditLimitWarning.creditLimit.toFixed(2)}).`
          : ""
        setNotification({ title: "Check-out Complete", message: `Guest has been successfully checked out and room marked as dirty.${warning}` })
        fetchData()
      } else if (data.earlyCheckoutRequired && !early) {
        if (await confirm({ title: "Check out early?", description: data.error, confirmLabel: "Check out anyway" })) {
          await handleCheckOut(res, true)
        }
      } else {
        setNotification({ title: "Check-out Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred during check-out.", isError: true })
    }
  }

  const openFolio = (res: Reservation) => {
    setFolioPanelResId(res.id)
    setIsFolioPanelOpen(true)
  }

  // One fixed-width action cluster shared by the table row and the mobile card:
  // a single status-driven primary button plus a "⋯" overflow menu for the rest.
  // Keeping this constant-width (regardless of status) is what stops the table
  // columns from jumping around row to row.
  const renderRowActions = (res: Reservation) => {
    const hasFolio = res.status === "IN_HOUSE" || res.status === "CHECKED_OUT" || (res.folios?.length ?? 0) > 0
    const canRequest = res.status === "RESERVED" || res.status === "IN_HOUSE"
    const canLetter = res.status === "RESERVED" || res.status === "IN_HOUSE"
    return (
      <div className="flex items-center justify-end gap-1.5">
        {canCheckIn(res.status, res.checkInDate, currentProperty?.businessDate) && (
          <Button size="sm" className="h-8 bg-success-muted text-success hover:bg-success-muted/70 border border-success/30" variant="outline" onClick={() => handleCheckIn(res)}>
            <Key className="h-3.5 w-3.5 mr-1.5" /> Check In
          </Button>
        )}
        {res.status === "IN_HOUSE" && (
          <Button size="sm" className="h-8" variant="outline" onClick={() => handleCheckOut(res)}>
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> Check Out
          </Button>
        )}
        {res.status === "CHECKED_OUT" && (
          <Button size="sm" className="h-8" variant="outline" onClick={() => openFolio(res)}>
            <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8 relative" title="More actions" aria-label="More actions" />}>
            <MoreHorizontal className="h-4 w-4" />
            {canRequest && getActiveTasks(res).length > 0 && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-destructive" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
              <FileText className="h-4 w-4 mr-2" /> View details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {res.status === "RESERVED" && (
              <DropdownMenuItem className="cursor-pointer" onClick={() => setDepositRes(res)}>
                <Wallet className="h-4 w-4 mr-2" /> Collect deposit
              </DropdownMenuItem>
            )}
            {hasFolio && res.status !== "CHECKED_OUT" && (
              <DropdownMenuItem className="cursor-pointer" onClick={() => openFolio(res)}>
                <ReceiptText className="h-4 w-4 mr-2" /> Folio
              </DropdownMenuItem>
            )}
            {canRequest && (
              <DropdownMenuItem className="cursor-pointer" onClick={() => handleRequestPrompt(res)}>
                <Bell className="h-4 w-4 mr-2" /> Special request
                {getActiveTasks(res).length > 0 && (
                  <span className="ml-auto text-[10px] font-semibold text-destructive">{getActiveTasks(res).length}</span>
                )}
              </DropdownMenuItem>
            )}
            {canLetter && (
              <DropdownMenuItem className="cursor-pointer" onClick={() => window.open(`/e/${slug}/dashboard/reservations/${res.id}/confirmation-letter`, "_blank")}>
                <FileText className="h-4 w-4 mr-2" /> Confirmation letter
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}/edit`)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-destructive" onClick={() => handleDeletePrompt(res)}>
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            Reservations &amp; Stays
            <InfoHint label="Reservations &amp; Stays">
              Manage incoming bookings, in-house guests, and room assignments.
            </InfoHint>
          </h2>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" className="shadow-sm" onClick={handleAutoAssign} disabled={autoAssigning}>
            <Wand2 className="mr-2 h-4 w-4" /> {autoAssigning ? "Assigning..." : "Auto-Assign"}
          </Button>
          <Link href={`/e/${slug}/dashboard/reservations/tape-chart`}>
            <Button variant="outline" className="shadow-sm">
              <CalendarDays className="mr-2 h-4 w-4" /> Tape Chart
            </Button>
          </Link>
          <Link href={`/e/${slug}/dashboard/reservations/new`}>
            <Button><Plus className="mr-2 h-4 w-4" /> New Booking</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col xl:flex-row xl:items-end gap-4">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                Reservations
                <InfoHint label="Reservations">Search and filter every booking at the property.</InfoHint>
              </CardTitle>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative sm:w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Guest or conf. #..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="sm:w-44">
                <SearchableSelect
                  value={filterStatus}
                  onChange={(v: string) => setFilterStatus(v)}
                  placeholder="All statuses"
                  options={[
                    { label: "All statuses", value: "" },
                    { label: "Reserved", value: "RESERVED" },
                    { label: "In-House", value: "IN_HOUSE" },
                    { label: "Checked Out", value: "CHECKED_OUT" },
                    { label: "No-Show", value: "NO_SHOW" },
                    { label: "Cancelled", value: "CANCELLED" },
                  ]}
                />
              </div>
              <DateRangePicker value={filterDates} onChange={setFilterDates} placeholder="Any dates" className="sm:w-60" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
            ) : loadError ? (
              <ErrorState title="Couldn't load reservations" onRetry={fetchData} />
            ) : reservations.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No reservations match your filters" />
            ) : (
              reservations.map((res) => {
                const guestName = res.primaryGuest?.profileType === 'COMPANY' || res.primaryGuest?.profileType === 'TRAVEL_AGENT'
                  ? res.primaryGuest?.companyName
                  : `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName || ''}`.trim()
                const nights = Math.max(1, Math.round((new Date(res.checkOutDate).getTime() - new Date(res.checkInDate).getTime()) / (1000 * 3600 * 24)))
                const first = res.assignments?.[0]
                const extraRooms = (res.assignments?.length ?? 0) > 1 ? (res.assignments!.length - 1) : 0

                return (
                  <div
                    key={res.id}
                    onClick={() => router.push(viewUrl(res.id))}
                    className="bg-card border border-border rounded-lg p-4 shadow-elevation-1 cursor-pointer active:bg-muted/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`font-medium text-foreground inline-flex items-center gap-1.5 ${res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}>
                          <span className="truncate">{guestName}</span>
                          {res.primaryGuest?.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">
                          {res.confirmationNo}
                          {res.externalRef && <span className="text-muted-foreground/70"> · ch:{res.externalRef}</span>}
                        </div>
                      </div>
                      <StatusBadge
                        label={reservationStateLabel(deriveReservationState(res.status, res.checkInDate, res.checkOutDate, currentProperty?.businessDate))}
                        status={deriveReservationState(res.status, res.checkInDate, res.checkOutDate, currentProperty?.businessDate)}
                        className={`shrink-0 ${res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm mt-3 pt-3 border-t border-border">
                      <span className="text-foreground">
                        {format(new Date(res.checkInDate), "dd MMM")} → {format(new Date(res.checkOutDate), "dd MMM")}
                        <span className="text-muted-foreground"> · {nights}n</span>
                      </span>
                      <span className="text-muted-foreground">
                        {first ? `${first.room?.roomNumber || 'TBA'} (${first.roomType?.code})` : 'No rooms'}
                        {extraRooms > 0 && ` +${extraRooms}`}
                      </span>
                    </div>
                    <div className="mt-2"><FlagStrip res={res} /></div>
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      {renderRowActions(res)}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Tablet/desktop: fixed-layout table — a stable column grid that never
              reflows when a booking has more rooms or more flags. */}
          <div className="hidden md:block">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[26%]">Guest</TableHead>
                  <TableHead className="w-[19%]">Stay</TableHead>
                  <TableHead className="w-[13%]">Room</TableHead>
                  <TableHead className="w-[20%]">Includes</TableHead>
                  <TableHead className="w-[10%]">Status</TableHead>
                  <TableHead className="w-[150px] text-right pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                  ))
                ) : loadError ? (
                  <TableRow><TableCell colSpan={6} className="py-0">
                    <ErrorState title="Couldn't load reservations" onRetry={fetchData} />
                  </TableCell></TableRow>
                ) : reservations.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-0">
                    <EmptyState icon={CalendarDays} title="No reservations match your filters" />
                  </TableCell></TableRow>
                ) : (
                  reservations.map((res) => {
                    const guestName = res.primaryGuest?.profileType === 'COMPANY' || res.primaryGuest?.profileType === 'TRAVEL_AGENT'
                      ? res.primaryGuest?.companyName
                      : `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName || ''}`.trim()
                    const nights = Math.max(1, Math.round((new Date(res.checkOutDate).getTime() - new Date(res.checkInDate).getTime()) / (1000 * 3600 * 24)))
                    const first = res.assignments?.[0]
                    const extraRooms = (res.assignments?.length ?? 0) > 1 ? (res.assignments!.length - 1) : 0
                    const cancelled = res.status === 'CANCELLED'

                    return (
                      <TableRow
                        key={res.id}
                        onClick={() => router.push(viewUrl(res.id))}
                        className="cursor-pointer"
                      >
                        {/* Guest + conf# */}
                        <TableCell className="align-middle">
                          <div className={`font-medium flex items-center gap-1.5 ${cancelled ? 'line-through opacity-70' : ''}`}>
                            <span className="truncate">{guestName}</span>
                            {res.primaryGuest?.vipLevel && <Star className="h-4 w-4 text-warning fill-none shrink-0" />}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground truncate">
                            {res.confirmationNo}
                            {res.externalRef && <span className="text-muted-foreground/70"> · ch:{res.externalRef}</span>}
                          </div>
                        </TableCell>

                        {/* Stay */}
                        <TableCell className="align-middle whitespace-nowrap">
                          <div className="text-sm text-foreground">
                            {format(new Date(res.checkInDate), "dd MMM")} → {format(new Date(res.checkOutDate), "dd MMM yy")}
                          </div>
                          <div className="text-xs text-muted-foreground">{nights} {nights === 1 ? 'night' : 'nights'}</div>
                        </TableCell>

                        {/* Room summary — never stacks per segment */}
                        <TableCell className="align-middle">
                          {first ? (
                            <div className="flex items-baseline gap-1.5 truncate">
                              <span className="text-sm font-semibold">{first.room?.roomNumber || 'TBA'}</span>
                              <span className="text-xs text-muted-foreground">{first.roomType?.code}</span>
                              {extraRooms > 0 && (
                                <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1 ring-1 ring-inset ring-border" title={`${res.assignments!.length} rooms on this booking`}>
                                  +{extraRooms}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">No rooms</span>
                          )}
                        </TableCell>

                        {/* Includes — subtle flag chips */}
                        <TableCell className="align-middle">
                          <FlagStrip res={res} />
                        </TableCell>

                        {/* Status */}
                        <TableCell className="align-middle">
                          <StatusBadge
                            label={reservationStateLabel(deriveReservationState(res.status, res.checkInDate, res.checkOutDate, currentProperty?.businessDate))}
                            status={deriveReservationState(res.status, res.checkInDate, res.checkOutDate, currentProperty?.businessDate)}
                            className={cancelled ? 'line-through opacity-70' : ''}
                          />
                        </TableCell>

                        {/* Actions — fixed width, click-through suppressed */}
                        <TableCell className="align-middle text-right pr-4" onClick={(e) => e.stopPropagation()}>
                          {renderRowActions(res)}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {hasMore && !loading && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Load More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Reservation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this reservation ({selectedRes?.confirmationNo})? This action cannot be undone and will permanently remove all associated folios and charges.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete Reservation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Special Request Modal */}
      <Dialog open={isRequestModalOpen} onOpenChange={setIsRequestModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Housekeeping Request</DialogTitle>
            <DialogDescription>
              Manage special requests for {selectedRes?.primaryGuest?.firstName} {selectedRes?.primaryGuest?.lastName}&apos;s room.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 flex flex-col gap-4">
            
            {selectedRes && getActiveTasks(selectedRes).length > 0 && (
              <div className="flex flex-col gap-2 p-3 bg-warning-muted rounded border border-warning/20">
                <Label className="text-warning font-semibold text-xs uppercase tracking-wider">Active Requests</Label>
                {getActiveTasks(selectedRes).map(task => (
                  <div key={task.id} className="flex justify-between items-center text-sm bg-card p-2 rounded shadow-sm border border-border">
                    <span className="font-medium text-foreground">{task.notes}</span>
                    <StatusBadge label={task.status.replace('_', ' ')} status={task.status} />
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 mt-2">
              <Label>New Request</Label>
              <SystemCodeSelect 
                category="HOUSEKEEPING_REQUEST" 
                value={requestCategory} 
                onValueChange={setRequestCategory} 
                placeholder="Select standard request..." 
              />
            </div>
            <div className="grid gap-2">
              <Label>Additional Notes</Label>
              <Input 
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                placeholder="Type custom details here..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRequestModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateRequest} disabled={submitting || (!requestText.trim() && !requestCategory)}>
              {submitting ? "Sending..." : "Send Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <FolioPanel
        reservationId={folioPanelResId}
        propertyId={propertyId}
        isOpen={isFolioPanelOpen}
        onClose={() => {
          setIsFolioPanelOpen(false)
          fetchData() // Refresh in case balances/statuses changed
        }}
      />

      <DepositDialog
        reservationId={depositRes?.id ?? null}
        confirmationNo={depositRes?.confirmationNo}
        guestName={depositRes ? `${depositRes.primaryGuest?.firstName ?? ""} ${depositRes.primaryGuest?.lastName ?? ""}`.trim() : undefined}
        isOpen={!!depositRes}
        onClose={() => setDepositRes(null)}
        onSaved={(message) => {
          setNotification({ title: "Deposit Collected", message })
          fetchData()
        }}
      />

      {/* Notification Modal */}
      <Dialog open={!!notification} onOpenChange={(open) => { if (!open) setNotification(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : "text-success"}>
              {notification?.title}
            </DialogTitle>
            <DialogDescription className="text-base text-foreground mt-2">
              {notification?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
