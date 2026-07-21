"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import {
  ArrowLeft, Pencil, ReceiptText, MessageSquare, FileText, Star, Key, LogOut,
  Wallet, BedDouble, Users, CalendarDays, Building2, ArrowLeftRight, Package,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { TracePanel } from "@/components/front-office/trace-panel"
import { RoomMoveModal } from "@/components/front-office/room-move-modal"
import { CheckInDialog } from "@/components/front-office/check-in-dialog"
import { DepositDialog } from "@/components/front-office/deposit-dialog"
import { useProperty } from "@/components/providers/property-provider"

// Property business date (UTC midnight ms) vs a reservation date, both date-only.
const dayMs = (d?: string | null) => (d ? Date.UTC(new Date(d).getUTCFullYear(), new Date(d).getUTCMonth(), new Date(d).getUTCDate()) : NaN)

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

// The one place a whole stay is visible at once: status, segments, money,
// packages, traces, and every action — previously scattered across the list
// page's row buttons and the Front Office tabs.
export default function ReservationDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const router = useRouter()
  const { currentProperty } = useProperty()
  const [reservation, setReservation] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [isFolioOpen, setIsFolioOpen] = useState(false)
  const [isTraceOpen, setIsTraceOpen] = useState(false)
  const [isRoomMoveOpen, setIsRoomMoveOpen] = useState(false)
  const [isCheckInOpen, setIsCheckInOpen] = useState(false)
  const [isDepositOpen, setIsDepositOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [notification, setNotification] = useState<{ title: string; message: string; isError?: boolean } | null>(null)

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

  useEffect(() => {
    fetchReservation()
  }, [id])

  const handleCheckOut = async (early = false) => {
    if (early && !window.confirm("This guest isn't due out yet. Check them out early?")) return
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
  const guestName =
    guest?.profileType === "COMPANY" || guest?.profileType === "TRAVEL_AGENT"
      ? guest?.companyName
      : `${guest?.firstName ?? ""} ${guest?.lastName ?? ""}`.trim()
  const nights = Math.max(
    1,
    Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / 86_400_000)
  )
  const activeAssignment = reservation.assignments?.[0]
  const totals = (reservation.folios ?? []).reduce(
    (acc: { charges: number; payments: number; balance: number }, f: any) => {
      const t = folioBalance(f)
      return { charges: acc.charges + t.charges, payments: acc.payments + t.payments, balance: acc.balance + t.balance }
    },
    { charges: 0, payments: 0, balance: 0 }
  )
  const openTraces = (reservation.traces ?? []).filter((t: any) => !t.isResolved)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={`/e/${slug}/dashboard/reservations`}>
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight inline-flex items-center gap-2">
                {guestName}
                {guest?.vipLevel && <Star className="h-5 w-5 text-warning fill-none" />}
              </h1>
              <StatusBadge
                label={reservation.status.replace("_", " ")}
                status={reservation.status}
                className={reservation.status === "CANCELLED" ? "line-through opacity-70" : ""}
              />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{reservation.confirmationNo}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {reservation.status === "RESERVED" && (
            <>
              <Button onClick={() => setIsCheckInOpen(true)}>
                <Key className="w-4 h-4 mr-2" /> Check In
              </Button>
              <Button variant="outline" onClick={() => setIsDepositOpen(true)}>
                <Wallet className="w-4 h-4 mr-2" /> Deposit
              </Button>
            </>
          )}
          {reservation.status === "IN_HOUSE" && (() => {
            // Due out when the property's business date has reached the checkout date.
            // Before that, checkout is an explicit "early check-out" (server-enforced).
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
              </>
            )
          })()}
          {(reservation.folios?.length ?? 0) > 0 && (
            <Button variant="outline" onClick={() => setIsFolioOpen(true)}>
              <ReceiptText className="w-4 h-4 mr-2" /> Folio
            </Button>
          )}
          <Button variant="outline" onClick={() => setIsTraceOpen(true)} className="relative">
            <MessageSquare className="w-4 h-4 mr-2" /> Traces
            {openTraces.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                {openTraces.length}
              </span>
            )}
          </Button>
          {(reservation.status === "RESERVED" || reservation.status === "IN_HOUSE") && (
            <Button
              variant="outline"
              onClick={() => window.open(`/e/${slug}/dashboard/reservations/${id}/confirmation-letter`, "_blank")}
            >
              <FileText className="w-4 h-4 mr-2" /> Letter
            </Button>
          )}
          <Link href={`/e/${slug}/dashboard/reservations/${id}/edit`}>
            <Button variant="outline">
              <Pencil className="w-4 h-4 mr-2" /> Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Stay */}
        <Card className="shadow-elevation-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-muted-foreground" /> Stay
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
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
                <p className="text-muted-foreground text-xs">Occupancy</p>
                <p className="font-semibold">
                  {reservation.adults} adult{reservation.adults === 1 ? "" : "s"}
                  {reservation.children > 0 && `, ${reservation.children} child${reservation.children === 1 ? "" : "ren"}`}
                  {reservation.infants > 0 && `, ${reservation.infants} infant${reservation.infants === 1 ? "" : "s"}`}
                </p>
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

        {/* Guests */}
        <Card className="shadow-elevation-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-muted-foreground" /> Guests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Primary Guest</p>
              <Link href={`/e/${slug}/dashboard/profiles/${guest?.upid}`} className="font-semibold hover:underline">
                {guestName}
              </Link>
            </div>
            {(reservation.accompanyingGuests?.length ?? 0) > 0 && (
              <div>
                <p className="text-muted-foreground text-xs mb-1">Accompanying</p>
                <div className="space-y-1">
                  {reservation.accompanyingGuests.map((ag: any) => (
                    <p key={ag.profile.upid}>{ag.profile.firstName} {ag.profile.lastName}</p>
                  ))}
                </div>
              </div>
            )}
            {reservation.travelAgent && (
              <div>
                <p className="text-muted-foreground text-xs">Travel Agent / Company</p>
                <p className="font-semibold flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {reservation.travelAgent.companyName || `${reservation.travelAgent.firstName} ${reservation.travelAgent.lastName ?? ""}`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Room segments */}
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
                      {a.overrideRate != null ? `$${a.overrideRate.toFixed(2)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Financials */}
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
                          ${t.charges.toFixed(2)} charges · ${t.payments.toFixed(2)} paid
                        </p>
                      </div>
                      <span className={`font-mono font-bold ${Math.abs(t.balance) < 0.005 ? "text-success" : "text-foreground"}`}>
                        ${t.balance.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="font-semibold">Total Balance</span>
                  <span className={`font-mono font-bold text-lg ${Math.abs(totals.balance) < 0.005 ? "text-success" : "text-foreground"}`}>
                    ${totals.balance.toFixed(2)}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setIsFolioOpen(true)}>
                  Open Folio Panel
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Allocations + Traces */}
        <div className="space-y-6">
          <Card className="shadow-elevation-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="w-5 h-5 text-muted-foreground" /> Allocations
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {(reservation.allocations?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">No allocations attached.</p>
              ) : (
                <div className="space-y-1.5">
                  {reservation.allocations.map((ra: any) => (
                    <div key={ra.id} className="flex items-center justify-between">
                      <span className="font-medium">{ra.allocation.code} — {ra.allocation.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ra.source === "MANUAL" ? "Add-on" : `via ${ra.source.toLowerCase().replace("_", " ")}`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-elevation-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-muted-foreground" /> Traces
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {(reservation.traces?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground">No traces logged.</p>
              ) : (
                <div className="space-y-2">
                  {reservation.traces.slice(0, 5).map((t: any) => (
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
                  {(reservation.traces?.length ?? 0) > 5 && (
                    <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={() => setIsTraceOpen(true)}>
                      View all {reservation.traces.length} traces
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
      <CheckInDialog
        reservation={isCheckInOpen ? reservation : null}
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

      <Dialog open={!!notification} onOpenChange={(open) => !open && setNotification(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={notification?.isError ? "text-destructive" : undefined}>{notification?.title}</DialogTitle>
            <DialogDescription>{notification?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setNotification(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
