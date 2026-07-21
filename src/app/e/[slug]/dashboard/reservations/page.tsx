"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { CalendarDays, Plus, Pencil, Trash2, Wand2, Key, LogOut, ReceiptText, Building2, Bell, FileText, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProperty } from "@/components/providers/property-provider"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { Input } from "@/components/ui/input"
import { format } from "date-fns"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

type Reservation = {
  id: string
  confirmationNo: string
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

export default function ReservationsDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const enterpriseId = currentProperty?.enterpriseId ?? ""

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
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

  // Custom Notification State
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  const fetchData = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const [resReq, hkReq] = await Promise.all([
        fetch(`/api/reservations?propertyId=${propertyId}`),
        fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=HOUSEKEEPING_REQUEST`),
      ])

      const resData = await resReq.json()
      if (Array.isArray(resData)) setReservations(resData)

      const hkData = await hkReq.json()
      if (Array.isArray(hkData)) setHousekeepingCodes(hkData)
    } catch (e) {
      console.error("Failed to load data", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentProperty) {
      fetchData()
    }
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
      setNotification({ title: "Error", message: "Error occurred during auto-assign.", isError: true })
    } finally {
      setAutoAssigning(false)
    }
  }

  const handleCheckIn = async (res: Reservation) => {
    try {
      const resp = await fetch(`/api/reservations/${res.id}/check-in`, { method: "POST" })
      const data = await resp.json()
      if (resp.ok) {
        setNotification({ title: "Check-in Complete", message: "Guest has been successfully checked in." })
        fetchData()
      } else {
        setNotification({ title: "Check-in Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "An error occurred during check-in.", isError: true })
    }
  }

  const handleCheckOut = async (res: Reservation) => {
    try {
      const resp = await fetch(`/api/reservations/${res.id}/check-out`, { method: "POST" })
      const data = await resp.json()
      if (resp.ok) {
        const warning = data.creditLimitWarning
          ? ` Note: this account is now over its credit limit ($${data.creditLimitWarning.balance.toFixed(2)} of $${data.creditLimitWarning.creditLimit.toFixed(2)}).`
          : ""
        setNotification({ title: "Check-out Complete", message: `Guest has been successfully checked out and room marked as dirty.${warning}` })
        fetchData()
      } else {
        setNotification({ title: "Check-out Failed", message: data.error || "Unknown error", isError: true })
      }
    } catch (e) {
      setNotification({ title: "Error", message: "An error occurred during check-out.", isError: true })
    }
  }

  const openFolio = (res: Reservation) => {
    setFolioPanelResId(res.id)
    setIsFolioPanelOpen(true)
  }

  // Shared between the desktop table row and the mobile stacked card — same actions,
  // same conditional logic, just laid out differently by the caller.
  const renderActions = (res: Reservation) => (
    <>
      {res.status === 'RESERVED' && (
        <Button variant="outline" size="icon" className="bg-success-muted text-success hover:bg-success-muted/70 border-success/30" onClick={() => handleCheckIn(res)} title="Check In">
          <Key className="h-4 w-4" />
        </Button>
      )}
      {res.status === 'IN_HOUSE' && (
        <Button variant="outline" size="icon" onClick={() => handleCheckOut(res)} title="Check Out">
          <LogOut className="h-4 w-4" />
        </Button>
      )}
      {(res.status === 'IN_HOUSE' || res.status === 'CHECKED_OUT') && (
        <Button variant="outline" size="icon" onClick={() => openFolio(res)} title="Folio">
          <ReceiptText className="h-4 w-4" />
        </Button>
      )}
      {(res.status === 'RESERVED' || res.status === 'IN_HOUSE') && (
        <Button
          variant="outline"
          size="icon"
          className={`relative ${
            getActiveTasks(res).length > 0
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent"
              : "bg-destructive-muted text-destructive hover:bg-destructive-muted/70 border-destructive/30"
          }`}
          onClick={() => handleRequestPrompt(res)}
          title="Special Request"
        >
          <Bell className="h-4 w-4" />
          {getActiveTasks(res).length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-none bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-none h-3 w-3 bg-destructive" />
            </span>
          )}
        </Button>
      )}
      {(res.status === 'RESERVED' || res.status === 'IN_HOUSE') && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => window.open(`/e/${slug}/dashboard/reservations/${res.id}/confirmation-letter`, '_blank')}
          title="Confirmation Letter"
        >
          <FileText className="h-4 w-4" />
        </Button>
      )}
      <Link href={`/e/${slug}/dashboard/reservations/${res.id}/edit`}>
        <Button variant="outline" size="icon" title="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
      </Link>
      <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeletePrompt(res)} title="Delete">
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reservations & Stays</h2>
          <p className="text-muted-foreground">
            Manage incoming bookings, in-house guests, and room assignments.
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" className="shadow-sm" onClick={handleAutoAssign} disabled={autoAssigning}>
            <Wand2 className="mr-2 h-4 w-4" /> {autoAssigning ? "Assigning..." : "Auto-Assign"}
          </Button>
          <Link href={`/e/${slug}/dashboard/reservations/calendar`}>
            <Button variant="outline" className="shadow-sm">
              <CalendarDays className="mr-2 h-4 w-4" /> Calendar View
            </Button>
          </Link>
          <Link href={`/e/${slug}/dashboard/reservations/new`}>
            <Button><Plus className="mr-2 h-4 w-4" /> New Booking</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Arrivals & In-House</CardTitle>
          <CardDescription>
            Overview of current and upcoming stays at the property.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Mobile: stacked cards instead of an 8-column horizontally-scrolled table */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
            ) : reservations.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No active reservations found" />
            ) : (
              reservations.map((res) => {
                const guestName = res.primaryGuest?.profileType === 'COMPANY' || res.primaryGuest?.profileType === 'TRAVEL_AGENT'
                  ? res.primaryGuest?.companyName
                  : `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName || ''}`.trim()
                const nights = Math.max(1, Math.round((new Date(res.checkOutDate).getTime() - new Date(res.checkInDate).getTime()) / (1000 * 3600 * 24)))
                const primaryRoom = res.assignments?.[0]

                return (
                  <div key={res.id} className="bg-card border border-border rounded-lg p-4 shadow-elevation-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-foreground inline-flex items-center gap-1.5">
                          {guestName}
                          {res.primaryGuest?.vipLevel && <Star className="h-3.5 w-3.5 text-warning fill-none shrink-0" />}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{res.confirmationNo}</div>
                      </div>
                      <StatusBadge
                        label={res.status.replace('_', ' ')}
                        status={res.status}
                        className={`shrink-0 ${res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm mt-3 pt-3 border-t border-border">
                      <span className="text-muted-foreground">
                        {primaryRoom ? `Room ${primaryRoom.room?.roomNumber || 'TBA'} (${primaryRoom.roomType?.code})` : 'No Segments'}
                      </span>
                      <span className="text-muted-foreground">{nights} {nights === 1 ? 'night' : 'nights'}</span>
                    </div>
                    <div className="text-sm text-foreground mt-1">
                      {format(new Date(res.checkInDate), "dd-MMM-yy")} – {format(new Date(res.checkOutDate), "dd-MMM-yy")}
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      {renderActions(res)}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Tablet/desktop: full table */}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>Conf. #</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Room / Type</TableHead>
                <TableHead>Check-In</TableHead>
                <TableHead>Check-Out</TableHead>
                <TableHead>Nights</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : reservations.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-0">
                  <EmptyState icon={CalendarDays} title="No active reservations found" />
                </TableCell></TableRow>
              ) : (
                reservations.map((res) => {
                  const guestName = res.primaryGuest?.profileType === 'COMPANY' || res.primaryGuest?.profileType === 'TRAVEL_AGENT'
                    ? res.primaryGuest?.companyName
                    : `${res.primaryGuest?.firstName} ${res.primaryGuest?.lastName || ''}`.trim()
                  
                  const nights = Math.max(1, Math.round((new Date(res.checkOutDate).getTime() - new Date(res.checkInDate).getTime()) / (1000 * 3600 * 24)))

                  return (
                    <TableRow key={res.id}>
                      <TableCell className="font-mono font-bold">{res.confirmationNo}</TableCell>
                      <TableCell>
                        <div className="font-medium inline-flex items-center gap-1.5">
                          {guestName}
                          {res.primaryGuest?.vipLevel && <Star className="h-4 w-4 text-warning fill-none shrink-0" />}
                        </div>
                        {res.accompanyingGuests && res.accompanyingGuests.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            + {res.accompanyingGuests.length} Accompanying
                          </div>
                        )}
                        {res.travelAgent && (
                          <div className="text-xs font-semibold text-foreground mt-1 flex items-center">
                            <Building2 className="w-3 h-3 mr-1" />
                            {res.travelAgent.companyName || res.travelAgent.firstName}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {res.assignments && res.assignments.length > 0 ? (
                            res.assignments.map((assignment, index) => (
                              <div key={index} className="flex flex-col border-b border-border pb-1 mb-1 last:border-0 last:pb-0 last:mb-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">{assignment.room?.roomNumber || 'TBA'}</span>
                                  <span className="text-xs text-muted-foreground">({assignment.roomType?.code})</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {format(new Date(assignment.startDate), "dd-MMM")} - {format(new Date(assignment.endDate), "dd-MMM")}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-muted-foreground">No Segments</div>
                          )}
                          {res.mealPlan && res.mealPlan !== 'NONE' && (
                            <span className="inline-flex items-center rounded-md bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning/20 w-max mt-1">
                              {res.mealPlan}
                            </span>
                          )}
                          {(res.allocations ?? []).length > 0 && (
                            <span className="inline-flex flex-wrap gap-1 mt-1">
                              {(res.allocations ?? []).map(ra => (
                                <span
                                  key={ra.id}
                                  title={`${ra.allocation.name} (${ra.source === "MANUAL" ? "add-on" : "via " + ra.source.toLowerCase().replace("_", " ")})`}
                                  className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground ring-1 ring-inset ring-border w-max"
                                >
                                  {ra.allocation.code}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{format(new Date(res.checkInDate), "dd-MMM-yy")}</TableCell>
                      <TableCell>{format(new Date(res.checkOutDate), "dd-MMM-yy")}</TableCell>
                      <TableCell>{nights}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge
                            label={res.status.replace('_', ' ')}
                            status={res.status}
                            className={res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}
                          />
                          {res.hasScheduledRoomMove && (
                            <span
                              className="inline-flex items-center rounded-md bg-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-warning ring-1 ring-inset ring-warning/20"
                              title="This stay's segments assign a different physical room partway through — a scheduled room move."
                            >
                              Room Move
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {renderActions(res)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
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
              Manage special requests for {selectedRes?.primaryGuest?.firstName} {selectedRes?.primaryGuest?.lastName}'s room.
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
