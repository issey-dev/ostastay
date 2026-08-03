"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { CalendarDays, Plus, Pencil, Wand2, Key, LogOut, ReceiptText, Building2, Bell, FileText, Star, Wallet, Search, Loader2, MoreHorizontal, Package, Users, ArrowLeftRight, Utensils, Settings2, LayoutGrid, ListChecks, RotateCcw } from "@/components/icons"
import type { DateRange } from "react-day-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
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
import {
  deriveReservationState,
  reservationStateLabel,
  canCheckIn,
  canReinstate,
  canReverseCheckOut,
  canEditReservation,
  isClosedReservation,
  reservationRowToneClass,
} from "@/lib/reservation-state"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Reservation = {
  id: string
  confirmationNo: string
  /** The channel's own booking id (Beds24/OTA ref) for channel-sourced reservations. */
  externalRef: string | null
  status: string
  checkInDate: string
  checkOutDate: string
  checkedOutAt?: string | null
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
  // Which date the range applies to — the desk thinks in "who arrives", "who is here"
  // and "who leaves", so the range switches between them rather than always meaning
  // "overlapping stay" (app-owner, 2026-08-03).
  const [dateMode, setDateMode] = useState<"stay" | "arrival" | "departure">("stay")
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Desktop can switch between the dense table and the same cards the phone gets.
  // Remembered per browser: it is a workspace preference, not a per-visit choice.
  const [view, setView] = useState<"table" | "card">("table")
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("osta:reservations-view") : null
    if (saved === "card" || saved === "table") setView(saved)
  }, [])
  const chooseView = (v: "table" | "card") => {
    setView(v)
    try { window.localStorage.setItem("osta:reservations-view", v) } catch {}
  }
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const buildQuery = (skip: number) => {
    const params = new URLSearchParams({ propertyId, take: String(PAGE_SIZE), skip: String(skip) })
    if (filterSearch.trim()) params.set("search", filterSearch.trim())
    if (filterStatus) params.set("status", filterStatus)
    if (filterDates?.from) params.set("from", format(filterDates.from, "yyyy-MM-dd"))
    if (filterDates?.to) params.set("to", format(filterDates.to, "yyyy-MM-dd"))
    if (filterDates?.from || filterDates?.to) params.set("dateMode", dateMode)
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
  }, [currentProperty, filterSearch, filterStatus, filterDates, dateMode])

  useEffect(() => {
    if (!currentProperty) return
    fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=HOUSEKEEPING_REQUEST`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setHousekeepingCodes(d) })
      .catch(console.error)
  }, [currentProperty])

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

  // Reinstate: CANCELLED / NO_SHOW → RESERVED. The server re-runs the availability
  // guard (the rooms may have been resold in the meantime), so a clean-looking row can
  // still come back with a conflict — surface it rather than swallowing it.
  const handleReinstate = async (res: Reservation) => {
    if (!(await confirm({
      title: res.status === "NO_SHOW" ? "Reinstate this no-show?" : "Reinstate this reservation?",
      description: "The booking goes back to Reserved and its folios reopen. The rooms must still be available for the stay dates.",
      confirmLabel: "Reinstate",
    }))) return
    try {
      const resp = await fetch(`/api/reservations/${res.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RESERVED" }),
      })
      const data = await resp.json()
      if (resp.ok) {
        setNotification({ title: "Reservation Reinstated", message: `${res.confirmationNo} is back to Reserved.` })
        fetchData()
      } else {
        setNotification({ title: "Reinstate Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred reinstating the reservation.", isError: true })
    }
  }

  // Reverse check-out — same-day only (see canReverseCheckOut). Reopens the folios and
  // puts the guest back In-House.
  const handleReverseCheckOut = async (res: Reservation) => {
    if (!(await confirm({
      title: "Reverse this check-out?",
      description: "The guest goes back to In-House, the folios reopen and the departure clean is cancelled.",
      confirmLabel: "Reverse check-out",
      destructive: true,
    }))) return
    try {
      const resp = await fetch(`/api/reservations/${res.id}/reverse-check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await resp.json()
      if (resp.ok) {
        const extra = data.debtorInvoicesReversed > 0
          ? ` ${data.debtorInvoicesReversed} debtor invoice(s) un-finalized.`
          : ""
        setNotification({ title: "Check-out Reversed", message: `${res.confirmationNo} is back In-House.${extra}` })
        fetchData()
      } else {
        setNotification({ title: "Reverse Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred reversing the check-out.", isError: true })
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
    const businessDate = currentProperty?.businessDate

    // Closed bookings (cancelled / no-show / checked out) are historical records, not
    // operational ones — they get a short, explicit action list instead of the live
    // cluster below. See isClosedReservation() in src/lib/reservation-state.ts for the
    // rules and why each one exists.
    if (isClosedReservation(res.status)) {
      const reinstatable = canReinstate(res.status, res.checkInDate, res.checkOutDate, businessDate)
      const reversible = canReverseCheckOut(res.status, res.checkOutDate, businessDate, res.checkedOutAt)
      const departed = res.status === "CHECKED_OUT"
      return (
        <div className="flex items-center justify-end gap-1.5">
          {/* One verb for the whole column — "bring this booking back" — even though the
              mechanism differs by status (status transition vs. reverse check-out). */}
          {reinstatable && (
            <Button size="sm" className="h-8" variant="outline" title="Put this booking back to Reserved" onClick={() => handleReinstate(res)}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reinstate
            </Button>
          )}
          {reversible && (
            <Button size="sm" className="h-8" variant="outline" title="Reverse the check-out — the guest goes back In-House" onClick={() => handleReverseCheckOut(res)}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reinstate
            </Button>
          )}
          {/* A departed stay keeps its folio for reprinting — read-only, nothing posts. */}
          {departed && !reversible && (
            <Button size="sm" className="h-8" variant="outline" onClick={() => openFolio(res)}>
              <ReceiptText className="h-3.5 w-3.5 mr-1.5" /> Folio
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" title="More actions" aria-label="More actions" />}>
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(viewUrl(res.id))}>
                <FileText className="h-4 w-4 mr-2" /> View details
              </DropdownMenuItem>
              {departed && reversible && (
                <DropdownMenuItem className="cursor-pointer" onClick={() => openFolio(res)}>
                  <ReceiptText className="h-4 w-4 mr-2" /> Folio
                </DropdownMenuItem>
              )}
              {canEditReservation(res.status) && (
                <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}/edit`)}>
                  <Pencil className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )
    }

    const hasFolio = res.status === "IN_HOUSE" || (res.folios?.length ?? 0) > 0
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
            {hasFolio && (
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
            {/* No Delete. A booking is never destroyed from the front desk — Cancel is
                the operation that keeps its history. Hard delete is internal-only
                maintenance; see src/lib/reservations/hard-delete-gate.ts. */}
            <DropdownMenuItem className="cursor-pointer" onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}/edit`)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  const activeFilterCount = [filterSearch.trim(), filterStatus, filterDates?.from ? "d" : ""].filter(Boolean).length
  const clearFilters = () => {
    setFilterSearch("")
    setFilterStatus("")
    setFilterDates(undefined)
    setDateMode("stay")
  }

  // Rendered twice — inline on desktop, inside the mobile drawer — from this single
  // definition, so the two can never offer different filters.
  const filterControls = (
    <>
      <div className="relative md:w-72">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Guest, conf. #, room, phone, email..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="md:w-44">
        <SearchableSelect
          value={filterStatus}
          onChange={(v: string) => setFilterStatus(v)}
          placeholder="Active bookings"
          options={[
            // "" is not "everything" any more — the API hides finished business unless a
            // status is named, so the label says what it actually does.
            { label: "Active bookings", value: "" },
            { label: "Reserved", value: "RESERVED" },
            { label: "In-House", value: "IN_HOUSE" },
            { label: "Checked Out", value: "CHECKED_OUT" },
            { label: "No-Show", value: "NO_SHOW" },
            { label: "Cancelled", value: "CANCELLED" },
          ]}
        />
      </div>
      <div className="md:w-36">
        <SearchableSelect
          value={dateMode}
          onChange={(v: string) => setDateMode((v || "stay") as "stay" | "arrival" | "departure")}
          placeholder="By stay"
          options={[
            { label: "By stay", value: "stay" },
            { label: "By arrival", value: "arrival" },
            { label: "By departure", value: "departure" },
          ]}
        />
      </div>
      <DateRangePicker value={filterDates} onChange={setFilterDates} placeholder="Any dates" className="md:w-60" />
      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" className="hidden text-muted-foreground md:inline-flex" onClick={clearFilters}>
          Clear
        </Button>
      )}
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-Assign and Tape Chart are desk-at-a-desk tools — a room grid and a bulk
          assignment sweep are not phone work, and side by side they pushed the title
          into two lines. Hidden below sm; New Booking stays, since that is the one
          thing you do reach for on a phone. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
          Reservations &amp; Stays
          <InfoHint label="Reservations &amp; Stays">
            Manage incoming bookings, in-house guests, and room assignments.
          </InfoHint>
        </h2>

        <div className="flex items-center gap-2">
          <Button variant="outline" className="hidden shadow-sm sm:inline-flex" onClick={handleAutoAssign} disabled={autoAssigning}>
            <Wand2 className="mr-2 h-4 w-4" /> {autoAssigning ? "Assigning..." : "Auto-Assign"}
          </Button>
          <Link href={`/e/${slug}/dashboard/reservations/tape-chart`} className="hidden sm:block">
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
          {/* One set of controls, rendered inline on desktop and inside a drawer on a
              phone — filters that took three stacked rows there left almost no room for
              the results they filter. `filterControls` is defined once so the two can
              never drift apart. */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                Reservations
                <InfoHint label="Reservations">
                  One search box covers guest name, confirmation number, channel reference, room number, phone and
                  email. Checked-out and no-show bookings are hidden unless you pick that status.
                </InfoHint>
              </CardTitle>

              <div className="flex items-center gap-2">
                {/* Desktop-only: the phone always gets cards. */}
                <div className="hidden items-center rounded-md border border-border p-0.5 md:flex">
                  <button
                    type="button"
                    onClick={() => chooseView("table")}
                    aria-pressed={view === "table"}
                    aria-label="Table view"
                    className={`rounded px-2 py-1 ${view === "table" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <ListChecks className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseView("card")}
                    aria-pressed={view === "card"}
                    aria-label="Card view"
                    className={`rounded px-2 py-1 ${view === "card" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>

                <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <SheetTrigger
                    render={
                      <Button variant="outline" size="sm" className="md:hidden">
                        <Settings2 className="mr-2 h-4 w-4" />
                        Filters
                        {activeFilterCount > 0 && (
                          <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                            {activeFilterCount}
                          </span>
                        )}
                      </Button>
                    }
                  />
                  <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Filter reservations</SheetTitle>
                    </SheetHeader>
                    <div className="flex flex-col gap-4 p-4">
                      {filterControls}
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={clearFilters}>Clear</Button>
                        <Button className="flex-1" onClick={() => setFiltersOpen(false)}>Show results</Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            {/* Inline on desktop only. */}
            <div className="hidden gap-2 md:flex md:flex-wrap md:items-center">{filterControls}</div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile: stacked cards */}
          {/* Cards: always on a phone, and on desktop when card view is chosen. */}
          <div className={`space-y-3 ${view === "card" ? "" : "md:hidden"}`}>
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
                    className={cn(
                      "bg-card border border-border rounded-lg p-4 shadow-elevation-1 cursor-pointer active:bg-muted/50",
                      // Closed bookings read as a tint, not a strikethrough — see
                      // reservationRowToneClass().
                      reservationRowToneClass(res.status)
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground inline-flex items-center gap-1.5">
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
                        className="shrink-0"
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
          <div className={view === "card" ? "hidden" : "hidden md:block"}>
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

                    return (
                      <TableRow
                        key={res.id}
                        onClick={() => router.push(viewUrl(res.id))}
                        // Cancelled / no-show / departed rows carry a subtle tint instead
                        // of a strikethrough — the text stays fully legible.
                        className={cn("cursor-pointer", reservationRowToneClass(res.status))}
                      >
                        {/* Guest + conf# */}
                        <TableCell className="align-middle">
                          <div className="font-medium flex items-center gap-1.5">
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
