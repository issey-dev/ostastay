"use client"

import { useEffect, useState, useRef, use } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useSmartBack } from "@/lib/use-smart-back"
import { format } from "date-fns"
import {
  ArrowLeft, Pencil, ReceiptText, MessageSquare, FileText, Star, Key, LogOut,
  Wallet, BedDouble, Users, CalendarDays, Building2, ArrowLeftRight, XCircle, UserRound, Info, Bell, RotateCcw,
} from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useConfirm } from "@/components/providers/confirm-provider"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { TracePanel } from "@/components/front-office/trace-panel"
import { RoomMoveModal } from "@/components/front-office/room-move-modal"
import { CheckInWizard } from "@/components/front-office/check-in-wizard"
import { DepositDialog } from "@/components/front-office/deposit-dialog"
import { ReservationTransport } from "@/components/front-office/reservation-transport"
import { ERegistrationPanel } from "@/components/front-office/eregistration-panel"
import { CountryLabel } from "@/components/ui/country-flag"
import { useProperty } from "@/components/providers/property-provider"
import {
  deriveReservationState,
  reservationStateLabel,
  canCheckIn,
  canReinstate,
  canReverseCheckOut,
  canEditReservation,
} from "@/lib/reservation-state"

// Property business date (UTC midnight ms) vs a reservation date, both date-only.
const dayMs = (d?: string | null) => (d ? Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth(), new Date(d).getUTCDate()) : NaN)
const money = (n: number) => `$${n.toFixed(2)}`

const DEPOSIT_PURPOSE_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  PRE_ARRIVAL_FEE: "Pre-Arrival Fee",
  CANCELLATION_FEE: "Cancellation Fee",
  NO_SHOW_FEE: "No-Show Fee",
}

const folioBalance = (folio: any) => {
  const charges = (folio.lineItems ?? []).reduce(
    (sum: number, li: any) => (li.isVoid ? sum : sum + li.amount + (li.taxAmount ?? 0) + (li.serviceChargeAmount ?? 0)),
    0
  )
  const payments = (folio.payments ?? []).reduce(
    (sum: number, p: any) => sum + (p.isRefund ? -p.amount : p.amount),
    0
  )
  return { charges, payments, balance: charges - payments }
}

const isEntity = (g: any) => g?.profileType === "COMPANY" || g?.profileType === "TRAVEL_AGENT"
const profileName = (g: any) => (isEntity(g) ? g?.companyName : `${g?.firstName ?? ""} ${g?.lastName ?? ""}`.trim())
const isVip = (g: any) => g?.classification === "VIP" || !!g?.vipLevel

export default function ReservationDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const goBack = useSmartBack(`/e/${slug}/dashboard/reservations`)
  const { currentProperty } = useProperty()
  const [reservation, setReservation] = useState<any>(null)
  const [breakdown, setBreakdown] = useState<any>(null)
  const [nationalityMap, setNationalityMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [isFolioOpen, setIsFolioOpen] = useState(false)
  const [isTraceOpen, setIsTraceOpen] = useState(false)
  const [isRoomMoveOpen, setIsRoomMoveOpen] = useState(false)
  const [isCheckInOpen, setIsCheckInOpen] = useState(false)
  const [isDepositOpen, setIsDepositOpen] = useState(false)
  const [isDailyOpen, setIsDailyOpen] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  // "Alert on open" traces pop once each time the reservation is opened, until resolved.
  const [showAlerts, setShowAlerts] = useState(false)
  const alertShownRef = useRef(false)
  // Arriving from the reservations list "Check In" (?checkin=1) auto-opens the wizard once.
  const searchParams = useSearchParams()
  const checkinAutoOpened = useRef(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [reversing, setReversing] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [advanceBillDialogOpen, setAdvanceBillDialogOpen] = useState(false)
  const [advanceBillNightsInput, setAdvanceBillNightsInput] = useState("")
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean; printHref?: string } | null>(null)

  const fetchReservation = async () => {
    try {
      const res = await fetch(`/api/reservations/${id}`)
      if (res.ok) {
        setReservation(await res.json())
        setNotFound(false)
      } else if (res.status === 404) {
        setNotFound(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchBreakdown = async () => {
    try {
      const res = await fetch(`/api/reservations/${id}/daily-breakdown`)
      if (res.ok) setBreakdown(await res.json())
    } catch (e) {
      console.error(e)
    }
  }

  // Fire the "alert on open" popup once per page open, as soon as the reservation loads
  // with any unresolved alert trace.
  useEffect(() => {
    if (reservation && !alertShownRef.current) {
      const alerts = (reservation.traces ?? []).filter((t: any) => t.alertOnOpen && !t.isResolved)
      if (alerts.length > 0) {
        setShowAlerts(true)
        alertShownRef.current = true
      }
    }
  }, [reservation])

  useEffect(() => {
    if (checkinAutoOpened.current || !reservation) return
    if (searchParams.get("checkin") === "1" && canCheckIn(reservation.status, reservation.checkInDate, currentProperty?.businessDate)) {
      checkinAutoOpened.current = true
      setIsCheckInOpen(true)
    }
  }, [searchParams, reservation, currentProperty])

  useEffect(() => {
    fetchReservation()
    fetchBreakdown()
    // Resolve nationality codes → display names once (for the guest flag + name).
    fetch(`/api/settings/system-codes?category=NATIONALITY`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (Array.isArray(rows)) setNationalityMap(Object.fromEntries(rows.map((c) => [c.code, c.value])))
      })
      .catch(() => {})
  }, [id])

  const confirm = useConfirm()

  const handleCancel = async () => {
    if (!(await confirm({
      title: "Cancel this reservation?",
      description: "If a cancellation-fee rule applies, the fee is retained against any deposit held.",
      confirmLabel: "Cancel reservation",
      destructive: true,
    }))) return
    try {
      const res = await fetch(`/api/reservations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      })
      const data = await res.json()
      if (res.ok) {
        const f = data.cancellationFee
        const feeMsg = f
          ? ` Cancellation fee $${f.fee.toFixed(2)} applied.` +
            (f.refundDue > 0.005 ? ` $${f.refundDue.toFixed(2)} deposit refund is due to the guest.` : "") +
            (f.shortfall > 0.005 ? ` $${f.shortfall.toFixed(2)} shortfall to collect from the guest.` : "")
          : ""
        setNotification({ title: "Reservation Cancelled", message: `The reservation has been cancelled.${feeMsg}` })
        fetchReservation()
      } else {
        setNotification({ title: "Cancel Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred cancelling the reservation.", isError: true })
    }
  }

  const handleCheckOut = async (early = false) => {
    if (early && !(await confirm({
      title: "Check out early?",
      description: "This guest isn't due out yet.",
      confirmLabel: "Check out early",
    }))) return
    setCheckingOut(true)
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
        setNotification({ title: "Check-out Complete", message: `Guest checked out and room marked as dirty.${warning}` })
        fetchReservation()
      } else {
        setNotification({ title: "Check-out Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred during check-out.", isError: true })
    } finally {
      setCheckingOut(false)
    }
  }

  const handleAdvanceBill = async () => {
    const trimmed = advanceBillNightsInput.trim()
    const nights = trimmed === "" ? undefined : parseInt(trimmed, 10)
    if (nights !== undefined && (!Number.isFinite(nights) || nights <= 0)) {
      setNotification({ title: "Invalid", message: "Enter a positive number of nights, or leave blank for all remaining.", isError: true })
      return
    }
    setAdvanceBillDialogOpen(false)
    setAdvancing(true)
    try {
      const res = await fetch(`/api/reservations/${id}/advance-bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nights !== undefined ? { nights } : {}),
      })
      const data = await res.json()
      if (res.ok) {
        const primaryFolioId = reservation.folios?.[0]?.id
        setNotification({
          title: "Advance Bill Posted",
          message: `${data.nights} night(s) posted — $${data.amountPosted.toFixed(2)} now on the folio (billed through ${data.advanceBilledThrough}).`,
          // Advance-billed charges are just posted folio lines — the Interim Bill (already
          // numbered-exempt, email/download enabled) shows exactly what was just posted, so
          // it doubles as the advance bill's own document rather than a new invoice variant.
          printHref: primaryFolioId ? `/e/${slug}/dashboard/folios/${primaryFolioId}/print?type=interim` : undefined,
        })
        fetchReservation()
      } else {
        setNotification({ title: "Advance Bill Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred generating the advance bill.", isError: true })
    } finally {
      setAdvancing(false)
    }
  }

  const handleReverseCheckIn = async () => {
    if (!(await confirm({
      title: "Reverse this check-in?",
      description: "This puts the guest back to Reserved.",
      confirmLabel: "Reverse check-in",
      destructive: true,
    }))) return
    setReversing(true)
    try {
      const res = await fetch(`/api/reservations/${id}/reverse-check-in`, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setNotification({ title: "Check-in Reversed", message: "The reservation is back to Reserved." })
        fetchReservation()
      } else {
        setNotification({ title: "Reverse Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred reversing the check-in.", isError: true })
    } finally {
      setReversing(false)
    }
  }

  // Reinstate a cancelled booking / late-arriving no-show back to Reserved. The server
  // re-checks availability (the rooms may have been resold), so failures are real and
  // must be shown rather than swallowed.
  const handleReinstate = async () => {
    if (!(await confirm({
      title: reservation.status === "NO_SHOW" ? "Reinstate this no-show?" : "Reinstate this reservation?",
      description: "The booking goes back to Reserved and its folios reopen. The rooms must still be available for the stay dates.",
      confirmLabel: "Reinstate",
    }))) return
    setReversing(true)
    try {
      const res = await fetch(`/api/reservations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RESERVED" }),
      })
      const data = await res.json()
      if (res.ok) {
        setNotification({ title: "Reservation Reinstated", message: "The booking is back to Reserved." })
        fetchReservation()
      } else {
        setNotification({ title: "Reinstate Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred reinstating the reservation.", isError: true })
    } finally {
      setReversing(false)
    }
  }

  const handleReverseCheckOut = async () => {
    const reason = window.prompt("Reverse this check-out and return the guest to In-House?\n\nOptional reason (recorded on the reservation):", "")
    if (reason === null) return
    setReversing(true)
    try {
      const res = await fetch(`/api/reservations/${id}/reverse-check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (res.ok) {
        const extra = data.debtorInvoicesReversed > 0
          ? ` ${data.debtorInvoicesReversed} debtor invoice(s) un-finalized${data.voidedCommissions > 0 ? `, ${data.voidedCommissions} commission credit(s) voided` : ""}.`
          : ""
        setNotification({ title: "Check-out Reversed", message: `The guest is back In-House.${extra}` })
        fetchReservation()
      } else {
        setNotification({ title: "Reverse Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch {
      setNotification({ title: "Error", message: "An error occurred reversing the check-out.", isError: true })
    } finally {
      setReversing(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9" />
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (notFound || !reservation) {
    return <EmptyState icon={CalendarDays} title="Reservation not found" className="py-24" />
  }

  const guest = reservation.primaryGuest
  const guestName = profileName(guest)
  // Green Tax registration numbers, assigned per arriving guest at EOD (Night Audit).
  // Keyed by profile so each guest shows their own number; absent until EOD runs.
  const registrations = new Map<string, { registrationNo: number; year: number }>(
    (reservation.guestRegistrations ?? []).map((r: any) => [r.profileId, { registrationNo: r.registrationNo, year: r.year }])
  )
  const regLabel = (profileId?: string) => {
    const r = profileId ? registrations.get(profileId) : undefined
    return r ? String(r.registrationNo).padStart(4, "0") : null
  }
  const nights = Math.max(
    1,
    Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / 86_400_000)
  )
  const activeAssignment = reservation.assignments?.[0]
  // Derived front-desk state (Reserved / Due In / In-House / Due Out / …) drives both the
  // header badge and the action gating below — see src/lib/reservation-state.ts.
  const derivedState = deriveReservationState(
    reservation.status,
    reservation.checkInDate,
    reservation.checkOutDate,
    currentProperty?.businessDate
  )
  const checkInAvailable = canCheckIn(reservation.status, reservation.checkInDate, currentProperty?.businessDate)
  const totals = (reservation.folios ?? []).reduce(
    (acc: { charges: number; payments: number; balance: number }, f: any) => {
      const t = folioBalance(f)
      return { charges: acc.charges + t.charges, payments: acc.payments + t.payments, balance: acc.balance + t.balance }
    },
    { charges: 0, payments: 0, balance: 0 }
  )
  const openTraces = (reservation.traces ?? []).filter((t: any) => !t.isResolved)
  const alertTraces = (reservation.traces ?? []).filter((t: any) => t.alertOnOpen && !t.isResolved)

  // Distinct rate plans across all segments.
  const ratePlans: { code?: string; name?: string }[] = []
  for (const a of reservation.assignments ?? []) {
    if (a.ratePlan && !ratePlans.some((r) => r.code === a.ratePlan.code)) {
      ratePlans.push({ code: a.ratePlan.code, name: a.ratePlan.name })
    }
  }
  // Distinct room types across all segments.
  const roomTypeNames = [...new Set((reservation.assignments ?? []).map((a: any) => a.roomType?.name).filter(Boolean))]

  const paxLabel =
    `${reservation.adults} adult${reservation.adults === 1 ? "" : "s"}` +
    (reservation.children > 0 ? `, ${reservation.children} child${reservation.children === 1 ? "" : "ren"}` : "") +
    (reservation.infants > 0 ? `, ${reservation.infants} infant${reservation.infants === 1 ? "" : "s"}` : "")

  // Collected deposits & fees across every folio (Payment rows carrying a depositPurpose).
  const depositRows: any[] = (reservation.folios ?? []).flatMap((f: any) =>
    (f.payments ?? []).filter((p: any) => p.depositPurpose).map((p: any) => ({ ...p, folioNumber: f.folioNumber }))
  )
  const depositsHeld = depositRows.reduce((s: number, p: any) => s + (p.isRefund ? -p.amount : p.amount), 0)

  const nationalityLabel = guest?.nationality ? nationalityMap[guest.nationality] ?? guest.nationality : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="shrink-0" onClick={goBack} title="Back" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{guestName}</h1>
              <StatusBadge label={reservationStateLabel(derivedState)} status={derivedState} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm flex items-center gap-2 flex-wrap">
              {reservation.confirmationNo}
              {reservation.groupBlock && (
                <Link
                  href={`/e/${slug}/dashboard/groups/${reservation.groupBlock.id}`}
                  title={`Group block: ${reservation.groupBlock.name}`}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground ring-1 ring-inset ring-border no-underline hover:text-foreground"
                >
                  <Users className="h-3 w-3" /> {reservation.groupBlock.code}
                </Link>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {reservation.status === "RESERVED" && (
            <>
              {/* Check-in only on the arrival day (Due In). A future-dated Reserved
                  booking shows Cancel only, per the front-desk lifecycle. */}
              {checkInAvailable && (
                <Button onClick={() => setIsCheckInOpen(true)}>
                  <Key className="w-4 h-4 mr-2" /> Check In
                </Button>
              )}
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive-muted hover:text-destructive"
                onClick={handleCancel}
              >
                <XCircle className="w-4 h-4 mr-2" /> Cancel
              </Button>
            </>
          )}
          {reservation.status === "IN_HOUSE" && (() => {
            const bd = dayMs(currentProperty?.businessDate)
            const co = dayMs(reservation.checkOutDate)
            const dueOut = !Number.isNaN(bd) && !Number.isNaN(co) ? bd >= co : true
            return (
              <>
                {dueOut ? (
                  <Button onClick={() => handleCheckOut(false)} disabled={checkingOut}>
                    <LogOut className="w-4 h-4 mr-2" /> {checkingOut ? "Checking out..." : "Check Out"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="text-warning border-warning/40 hover:bg-warning-muted hover:text-warning"
                    onClick={() => handleCheckOut(true)}
                    disabled={checkingOut}
                  >
                    <LogOut className="w-4 h-4 mr-2" /> {checkingOut ? "Checking out..." : "Early Check-Out"}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsRoomMoveOpen(true)}>
                  <ArrowLeftRight className="w-4 h-4 mr-2" /> Move Room
                </Button>
                <Button variant="outline" onClick={() => setAdvanceBillDialogOpen(true)} disabled={advancing}>
                  <Wallet className="w-4 h-4 mr-2" /> {advancing ? "Posting..." : "Advance Bill"}
                </Button>
                <Button
                  variant="outline"
                  className="text-muted-foreground"
                  onClick={handleReverseCheckIn}
                  disabled={reversing}
                >
                  <RotateCcw className="w-4 h-4 mr-2" /> {reversing ? "Reversing..." : "Reverse Check-in"}
                </Button>
              </>
            )
          })()}
          {/* Reverse check-out is a same-day correction only — after the departure day
              closes, a departed stay is view + folio-reprint only. */}
          {canReverseCheckOut(reservation.status, reservation.checkOutDate, currentProperty?.businessDate, reservation.checkedOutAt) && (
            <Button
              variant="outline"
              className="text-warning border-warning/40 hover:bg-warning-muted hover:text-warning"
              onClick={handleReverseCheckOut}
              disabled={reversing}
            >
              <RotateCcw className="w-4 h-4 mr-2" /> {reversing ? "Reversing..." : "Reverse Check-out"}
            </Button>
          )}
          {/* Cancelled / no-show can come back while the stay dates still allow it. */}
          {canReinstate(reservation.status, reservation.checkInDate, reservation.checkOutDate, currentProperty?.businessDate) && (
            <Button variant="outline" onClick={handleReinstate} disabled={reversing}>
              <RotateCcw className="w-4 h-4 mr-2" /> {reversing ? "Reinstating..." : "Reinstate"}
            </Button>
          )}
          {(reservation.status === "RESERVED" || reservation.status === "IN_HOUSE") && (
            <>
              <Button
                variant="outline"
                onClick={() => window.open(`/e/${slug}/dashboard/reservations/${id}/confirmation-letter`, "_blank")}
              >
                <FileText className="w-4 h-4 mr-2" /> Letter
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(`/e/${slug}/dashboard/reservations/${id}/registration-card`, "_blank")}
              >
                <ReceiptText className="w-4 h-4 mr-2" /> Reg Card
              </Button>
            </>
          )}
          {/* A departed stay is settled — it's viewable, never editable. */}
          {canEditReservation(reservation.status) && (
            <Link href={`/e/${slug}/dashboard/reservations/${id}/edit`}>
              <Button variant="outline">
                <Pencil className="w-4 h-4 mr-2" /> Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* 1. Guest — the first thing shown */}
      <Card className="shadow-elevation-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" /> Guest
            <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
              <UserRound className="w-4 h-4" /> {paxLabel}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {/* Lead guest */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={`/e/${slug}/dashboard/profiles/${guest?.upid}`}
              className="text-lg font-semibold text-foreground hover:underline inline-flex items-center gap-2"
            >
              {guestName}
            </Link>
            {isVip(guest) && (
              <Badge variant="outline" className="bg-warning-muted text-warning border-warning/40 gap-1">
                <Star className="w-3 h-3 fill-current" /> VIP{guest?.vipLevel ? ` · ${guest.vipLevel}` : ""}
              </Badge>
            )}
            {nationalityLabel && (
              <CountryLabel value={guest?.nationality} name={nationalityLabel} className="inline-flex items-center gap-1.5 text-muted-foreground" />
            )}
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Lead</Badge>
            {regLabel(guest?.upid) && (
              <span className="text-[10px] font-mono text-muted-foreground" title="Green Tax registration number (assigned at End of Day)">
                {regLabel(guest?.upid)}
              </span>
            )}
          </div>

          {/* Accompanying guests — smaller */}
          {(reservation.accompanyingGuests?.length ?? 0) > 0 && (
            <div>
              <p className="text-muted-foreground text-xs mb-1.5">
                Accompanying · {reservation.accompanyingGuests.length}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {reservation.accompanyingGuests.map((ag: any) => (
                  <Link
                    key={ag.profile.upid}
                    href={`/e/${slug}/dashboard/profiles/${ag.profile.upid}`}
                    className="text-xs text-foreground/80 hover:underline inline-flex items-center gap-1.5"
                  >
                    <UserRound className="w-3 h-3 text-muted-foreground" />
                    {profileName(ag.profile)}
                    {isVip(ag.profile) && <Star className="w-3 h-3 text-warning fill-current" />}
                    {regLabel(ag.profile?.upid) && (
                      <span className="font-mono text-muted-foreground/80" title="Green Tax registration number (assigned at End of Day)">
                        {regLabel(ag.profile?.upid)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {reservation.travelAgent && (
            <div className="pt-1 border-t border-border/50">
              <p className="text-muted-foreground text-xs mb-0.5">Travel Agent / Company</p>
              <p className="font-medium inline-flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                {profileName(reservation.travelAgent)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 2. Reservation detail */}
        <Card className="shadow-elevation-1 lg:col-span-2">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-muted-foreground" /> Reservation Detail
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setIsDailyOpen(true)}>
              <ReceiptText className="w-4 h-4 mr-2" /> Daily Details
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-muted-foreground text-xs">Check-In</p>
                <p className="font-semibold">{format(new Date(reservation.checkInDate), "EEE, dd-MMM-yy")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Check-Out</p>
                <p className="font-semibold">{format(new Date(reservation.checkOutDate), "EEE, dd-MMM-yy")}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Nights</p>
                <p className="font-semibold">{nights}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Rate Total</p>
                <p className="font-semibold font-mono">
                  {breakdown?.totals ? money(breakdown.totals.grandTotal) : <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Rate Plan{ratePlans.length > 1 ? "s" : ""}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ratePlans.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    ratePlans.map((rp) => (
                      <Badge key={rp.code} variant="outline" className="font-mono">
                        {rp.code}{rp.name ? ` · ${rp.name}` : ""}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1.5">
                  <BedDouble className="w-3.5 h-3.5" /> Room Type{roomTypeNames.length > 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {roomTypeNames.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    roomTypeNames.map((n: any) => (
                      <Badge key={n} variant="outline">{n}</Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
            {reservation.mealPlan && reservation.mealPlan !== "NONE" && (
              <div>
                <p className="text-muted-foreground text-xs">Meal Plan</p>
                <Badge variant="outline" className="mt-0.5">{reservation.mealPlan}</Badge>
              </div>
            )}
            {(reservation.specialRequests?.length ?? 0) > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Special Requests</p>
                <div className="flex flex-wrap gap-1">
                  {reservation.specialRequests.map((sr: any) => (
                    <Badge key={sr.id} variant="outline" className="text-xs">{sr.code}</Badge>
                  ))}
                </div>
              </div>
            )}
            {reservation.remarks && (
              <div>
                <p className="text-muted-foreground text-xs">Remarks</p>
                <p className="mt-0.5 whitespace-pre-wrap">{reservation.remarks}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Room assignments */}
        <Card className="shadow-elevation-1 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BedDouble className="w-5 h-5 text-muted-foreground" /> Room Assignment{(reservation.assignments?.length ?? 0) > 1 ? "s" : ""}
              {reservation.hasScheduledRoomMove && (
                <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30 text-xs">Scheduled Room Move</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Mobile: stacked cards — a 5-column table is unreadable at phone width. */}
            <div className="md:hidden divide-y divide-border">
              {(reservation.assignments ?? []).map((a: any) => (
                <div key={a.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {format(new Date(a.startDate), "dd-MMM")} – {format(new Date(a.endDate), "dd-MMM-yy")}
                    </span>
                    {a.room ? (
                      <Badge variant="outline">{a.room.roomNumber}</Badge>
                    ) : (
                      <span className="text-warning text-xs font-medium">Unassigned</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{a.roomType?.name}</span>
                    <span className="text-right">{a.ratePlan?.code} — {a.ratePlan?.name}</span>
                  </div>
                  {a.overrideRate != null && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                      <span className="text-muted-foreground">Override Rate</span>
                      <span className="font-mono">{money(a.overrideRate)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tablet/desktop: real table. */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Dates</TableHead>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Rate Plan</TableHead>
                    <TableHead className="text-right pr-6">Override Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reservation.assignments ?? []).map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell className="pl-6 text-sm">
                        {format(new Date(a.startDate), "dd-MMM")} – {format(new Date(a.endDate), "dd-MMM-yy")}
                      </TableCell>
                      <TableCell>{a.roomType?.name}</TableCell>
                      <TableCell>
                        {a.room ? (
                          <Badge variant="outline">{a.room.roomNumber}</Badge>
                        ) : (
                          <span className="text-warning text-xs font-medium">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{a.ratePlan?.code} — {a.ratePlan?.name}</TableCell>
                      <TableCell className="text-right pr-6 font-mono text-sm">
                        {a.overrideRate != null ? money(a.overrideRate) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* 3. Transport */}
        <ReservationTransport
          reservationId={id}
          propertyId={reservation.propertyId}
          checkInDate={reservation.checkInDate}
          checkOutDate={reservation.checkOutDate}
          transports={reservation.transports ?? []}
          onChanged={() => {
            fetchReservation()
            fetchBreakdown()
          }}
          onNotify={setNotification}
        />

        <ERegistrationPanel reservationId={id} />

        {/* 4. Billing */}
        <Card className="shadow-elevation-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-muted-foreground" /> Billing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(reservation.folios?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">No folio yet — one is created at deposit or check-in.</p>
            ) : (
              <>
                {(reservation.folios ?? []).map((f: any) => {
                  const t = folioBalance(f)
                  return (
                    <div key={f.id} className="flex items-center justify-between border border-border rounded-md p-2.5">
                      <div>
                        <p className="font-medium">
                          Folio #{f.folioNumber}
                          {f.isClosed && <Badge variant="outline" className="ml-2 text-[10px]">Closed</Badge>}
                          {f.settlementMethod === "CITY_LEDGER" && (
                            <Badge variant="outline" className="ml-2 text-[10px] bg-info-muted text-info border-info/30">City Ledger</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {money(t.charges)} charges · {money(t.payments)} paid
                        </p>
                      </div>
                      <span className={`font-mono font-bold ${Math.abs(t.balance) < 0.005 ? "text-success" : "text-foreground"}`}>
                        {money(t.balance)}
                      </span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="font-semibold">Total Balance</span>
                  <span className={`font-mono font-bold text-lg ${Math.abs(totals.balance) < 0.005 ? "text-success" : "text-foreground"}`}>
                    {money(totals.balance)}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setIsFolioOpen(true)}>
                  Open Folio Panel
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Deposits & Fees + Traces */}
        <div className="space-y-6">
          {/* Deposits & Fees at a glance */}
          <Card className="shadow-elevation-1">
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-muted-foreground" /> Deposits &amp; Fees
              </CardTitle>
              {reservation.status === "RESERVED" && (
                <Button variant="outline" size="sm" onClick={() => setIsDepositOpen(true)}>Add</Button>
              )}
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {depositRows.length === 0 ? (
                <p className="text-muted-foreground">No deposits or fees collected.</p>
              ) : (
                <>
                  {depositRows.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">
                          {DEPOSIT_PURPOSE_LABEL[p.depositPurpose] ?? p.depositPurpose}
                          {p.isRefund && <Badge variant="outline" className="ml-2 text-[10px]">Refund</Badge>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.paymentMethod?.name ?? "—"}
                          {p.referenceNumber ? ` · ${p.referenceNumber}` : ""} · {format(new Date(p.createdAt), "dd-MMM")}
                        </p>
                      </div>
                      <span className={`font-mono font-medium ${p.isRefund ? "text-destructive" : "text-foreground"}`}>
                        {p.isRefund ? "-" : ""}{money(p.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="font-semibold">Held</span>
                    <span className="font-mono font-bold">{money(depositsHeld)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Traces */}
          <Card className="shadow-elevation-1">
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground" /> Traces
                {openTraces.length > 0 && (
                  <Badge variant="outline" className="bg-destructive-muted text-destructive border-destructive/30 text-[10px]">
                    {openTraces.length} open
                  </Badge>
                )}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setIsTraceOpen(true)}>Open</Button>
            </CardHeader>
            <CardContent className="text-sm">
              {(reservation.traces?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">No traces logged.</p>
              ) : (
                <div className="space-y-2">
                  {reservation.traces.slice(0, 4).map((t: any) => (
                    <div key={t.id} className="flex items-start justify-between gap-2">
                      <div>
                        <p className={t.isResolved ? "line-through text-muted-foreground" : ""}>{t.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t.traceType} · {format(new Date(t.createdAt), "dd-MMM h:mm a")}
                        </p>
                      </div>
                      {!t.isResolved && <Badge variant="outline" className="text-[10px] shrink-0">Open</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Daily Details modal */}
      <Dialog open={isDailyOpen} onOpenChange={(o) => { setIsDailyOpen(o); if (!o) setShowSummary(false) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-1.5">
              <DialogTitle>Daily Details</DialogTitle>
              {breakdown?.summary && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${showSummary ? "text-primary" : "text-muted-foreground"}`}
                  title="Charge summary"
                  aria-label="Charge summary"
                  onClick={() => setShowSummary((s) => !s)}
                >
                  <Info className="w-4 h-4" />
                </Button>
              )}
            </div>
            <DialogDescription>
              {showSummary
                ? "Charge summary by category."
                : `Projected day-by-day charges for this stay${breakdown?.pricesIncludeTaxes ? " (rates include taxes)" : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {!breakdown ? (
            <div className="py-8 text-center text-muted-foreground">Loading breakdown…</div>
          ) : showSummary && breakdown.summary ? (
            <div className="max-h-[60vh] overflow-auto space-y-4 text-sm">
              {[
                { key: "room", label: "Room" },
                { key: "allocation", label: "Allocation" },
                { key: "other", label: "Other" },
                { key: "taxes", label: "Taxes" },
              ].map(({ key, label }) => {
                const sec = breakdown.summary[key]
                if (!sec || (sec.lines.length === 0 && Math.abs(sec.total) < 0.005)) return null
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between font-semibold border-b border-border pb-1 mb-1">
                      <span>{label}</span>
                      <span className="font-mono">{money(sec.total)}</span>
                    </div>
                    {sec.lines.length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      sec.lines.map((l: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-muted-foreground py-0.5">
                          <span>{l.name}</span>
                          <span className="font-mono">{money(l.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
              <div className="flex items-center justify-between border-t border-border pt-2 font-bold text-base">
                <span>Grand Total</span>
                <span className="font-mono">{money(breakdown.summary.grandTotal)}</span>
              </div>
            </div>
          ) : (breakdown.days?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No priced nights on this reservation.</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto -mx-6">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="pl-6">Date</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead className="text-center">Pax</TableHead>
                    <TableHead className="text-right">Room</TableHead>
                    <TableHead className="text-right">Allocation</TableHead>
                    <TableHead className="text-right">Other</TableHead>
                    <TableHead className="text-right">Taxes</TableHead>
                    <TableHead className="text-right pr-6">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.days.map((d: any) => (
                    <TableRow key={d.date}>
                      <TableCell className="pl-6 whitespace-nowrap">{format(new Date(d.date + "T00:00:00"), "dd-MMM")}</TableCell>
                      <TableCell className="text-right font-mono">{money(d.rate)}</TableCell>
                      <TableCell className="text-xs">{d.roomTypeName ?? "—"}</TableCell>
                      <TableCell>{d.roomNumber ? <Badge variant="outline">{d.roomNumber}</Badge> : "—"}</TableCell>
                      <TableCell className="text-center text-xs">
                        {d.adults}A{d.children > 0 ? ` ${d.children}C` : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono">{money(d.roomCharge)}</TableCell>
                      <TableCell className="text-right font-mono">{d.allocationCharge > 0 ? money(d.allocationCharge) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{d.otherCharge > 0 ? money(d.otherCharge) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{money(d.taxes)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold pr-6">{money(d.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {breakdown?.totals && !showSummary && (
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">
                Room {money(breakdown.totals.roomBase + breakdown.totals.extraOccupancyBase)} · Allocations {money(breakdown.totals.allocationsBase)}
                {breakdown.totals.otherBase > 0 ? ` · Other ${money(breakdown.totals.otherBase)}` : ""} · Taxes {money(breakdown.totals.taxTotal)}
              </span>
              <span className="font-mono font-bold text-base">Total {money(breakdown.totals.grandTotal)}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDailyOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Panels & dialogs */}
      <FolioPanel
        reservationId={isFolioOpen ? id : null}
        propertyId={reservation.propertyId}
        isOpen={isFolioOpen}
        onClose={() => {
          setIsFolioOpen(false)
          fetchReservation()
        }}
      />
      <TracePanel
        reservationId={isTraceOpen ? id : null}
        guestName={guestName ?? ""}
        isOpen={isTraceOpen}
        onClose={() => {
          setIsTraceOpen(false)
          fetchReservation()
        }}
      />
      <RoomMoveModal
        isOpen={isRoomMoveOpen}
        onClose={() => {
          setIsRoomMoveOpen(false)
          fetchReservation()
        }}
        propertyId={reservation.propertyId}
        reservationId={isRoomMoveOpen ? id : null}
        currentRoomNumber={activeAssignment?.room?.roomNumber || "Unassigned"}
        currentRoomType={activeAssignment?.roomType?.name || ""}
        checkInDate={new Date(reservation.checkInDate).toISOString().split("T")[0]}
        checkOutDate={new Date(reservation.checkOutDate).toISOString().split("T")[0]}
      />
      <CheckInWizard
        reservationId={isCheckInOpen ? id : null}
        propertyId={reservation.propertyId}
        isOpen={isCheckInOpen}
        onClose={() => setIsCheckInOpen(false)}
        onDone={(result) => {
          setNotification(result)
          fetchReservation()
        }}
      />
      <DepositDialog
        reservationId={isDepositOpen ? id : null}
        confirmationNo={reservation.confirmationNo}
        guestName={guestName ?? undefined}
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onSaved={(message) => {
          setNotification({ title: "Deposit Collected", message })
          fetchReservation()
        }}
      />

      {/* Alert-on-open traces — pop each time the reservation is opened until resolved. */}
      <Dialog open={showAlerts && alertTraces.length > 0} onOpenChange={(open) => !open && setShowAlerts(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <Bell className="w-5 h-5" /> Attention
            </DialogTitle>
            <DialogDescription>
              {alertTraces.length === 1 ? "This reservation has a flagged trace:" : `This reservation has ${alertTraces.length} flagged traces:`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {alertTraces.map((t: any) => (
              <div key={t.id} className="rounded-md border border-warning/40 bg-warning-muted/40 p-3">
                <p className="font-medium text-sm">{t.description}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t.traceType}{t.actionDate ? ` · ${format(new Date(t.actionDate), "dd-MMM h:mm a")}` : ""}
                </p>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowAlerts(false); setIsTraceOpen(true) }}>Manage Traces</Button>
            <Button onClick={() => setShowAlerts(false)}>Acknowledge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notification} onOpenChange={(open) => !open && setNotification(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : undefined}>{notification?.title}</DialogTitle>
            <DialogDescription>{notification?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {notification?.printHref && (
              <Button variant="outline" onClick={() => window.open(notification.printHref, "_blank")}>
                Print / Email
              </Button>
            )}
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={advanceBillDialogOpen} onOpenChange={(open) => { setAdvanceBillDialogOpen(open); if (!open) setAdvanceBillNightsInput("") }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Advance Bill</DialogTitle>
            <DialogDescription>
              Charges (rate, allocations, green tax, transport) post today so the guest can settle before checkout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="advance-bill-nights">Nights to bill</Label>
            <Input
              id="advance-bill-nights"
              type="number"
              min={1}
              placeholder="Leave blank to bill all remaining nights"
              value={advanceBillNightsInput}
              onChange={(e) => setAdvanceBillNightsInput(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceBillDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAdvanceBill} disabled={advancing}>
              {advancing ? "Posting..." : "Post Advance Bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
