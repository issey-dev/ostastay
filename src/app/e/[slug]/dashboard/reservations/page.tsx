"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { CalendarDays, Plus, Pencil, Trash2, Wand2, Key, LogOut, ReceiptText, Building2, Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProperty } from "@/components/providers/property-provider"
import { FolioPanel } from "@/components/front-office/folio-panel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { format } from "date-fns"
import { statusMutedClasses } from "@/lib/status-tone"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"

type Reservation = {
  id: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  adults: number
  children: number
  mealPlan: string
  primaryGuestId: string
  primaryGuest: { firstName: string, lastName: string, companyName: string, profileType: string }
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
}

const getActiveTasks = (res: Reservation) => {
  return res.assignments?.flatMap(a => a.room?.housekeepingTasks || []).filter(t => t.status !== 'COMPLETED') || []
}

export default function ReservationsDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id || "00000000-0000-0000-0000-000000000000"
  const enterpriseId = currentProperty?.enterpriseId || "00000000-0000-0000-0000-000000000000"
  
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Modals state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false)
  const [selectedRes, setSelectedRes] = useState<Reservation | null>(null)
  const [requestCategory, setRequestCategory] = useState("")
  const [requestText, setRequestText] = useState("")
  const [requestingRoomId, setRequestingRoomId] = useState("")

  // Lookup data states
  const [profiles, setProfiles] = useState<any[]>([])
  const [roomTypes, setRoomTypes] = useState<any[]>([])
  const [rooms, setRooms] = useState<any[]>([])
  const [ratePlans, setRatePlans] = useState<any[]>([])
  const [availableRooms, setAvailableRooms] = useState<any[]>([])
  const [housekeepingCodes, setHousekeepingCodes] = useState<any[]>([])
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [folioPanelResId, setFolioPanelResId] = useState<string | null>(null)
  const [isFolioPanelOpen, setIsFolioPanelOpen] = useState(false)
  
  // Custom Notification State
  const [notification, setNotification] = useState<{ title: string, message: string, isError?: boolean } | null>(null)

  // Form State
  const [form, setForm] = useState({
    primaryGuestId: "",
    checkInDate: "",
    checkOutDate: "",
    adults: 1,
    children: 0,
    mealPlan: "NONE",
    travelAgentId: "none",
    status: "RESERVED",
    accompanyingGuestIds: [] as string[],
    assignments: [
      {
        roomTypeId: "",
        roomId: "",
        ratePlanId: "",
        overrideRate: "",
        startDate: "",
        endDate: ""
      }
    ]
  })

  const fetchData = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const [resReq, profReq, rtReq, rpReq, rmReq, hkReq] = await Promise.all([
        fetch(`/api/reservations?propertyId=${propertyId}`),
        fetch(`/api/profiles?enterpriseId=${enterpriseId}`),
        fetch(`/api/room-types?propertyId=${propertyId}`),
        fetch(`/api/rate-plans?propertyId=${propertyId}`),
        fetch(`/api/rooms?propertyId=${propertyId}`),
        fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=HOUSEKEEPING_REQUEST`)
      ])
      
      const resData = await resReq.json()
      if (Array.isArray(resData)) setReservations(resData)

      const profData = await profReq.json()
      if (Array.isArray(profData)) setProfiles(profData)

      const rtData = await rtReq.json()
      if (Array.isArray(rtData)) setRoomTypes(rtData)

      const rpData = await rpReq.json()
      if (Array.isArray(rpData)) setRatePlans(rpData)

      const rmData = await rmReq.json()
      if (Array.isArray(rmData)) setRooms(rmData)

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

  useEffect(() => {
    const primaryRoomTypeId = form.assignments[0]?.roomTypeId
    if (form.checkInDate && form.checkOutDate && primaryRoomTypeId) {
      const excludeParam = selectedRes?.id ? `&excludeReservationId=${selectedRes.id}` : ""
      fetch(`/api/rooms/available?propertyId=${propertyId}&roomTypeId=${primaryRoomTypeId}&checkInDate=${form.checkInDate}&checkOutDate=${form.checkOutDate}${excludeParam}`)
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) setAvailableRooms(data)
        })
        .catch(console.error)
    } else {
      setAvailableRooms([])
    }
  }, [form.checkInDate, form.checkOutDate, form.assignments, selectedRes?.id])

  const resetForm = () => {
    setForm({
      primaryGuestId: "",
      checkInDate: "",
      checkOutDate: "",
      adults: 1,
      children: 0,
      mealPlan: "NONE",
      travelAgentId: "none",
      status: "RESERVED",
      accompanyingGuestIds: [],
      assignments: [
        {
          roomTypeId: "",
          roomId: "",
          ratePlanId: "",
          overrideRate: "",
          startDate: "",
          endDate: ""
        }
      ]
    })
    setSelectedRes(null)
  }

  const handleEdit = (res: Reservation) => {
    setSelectedRes(res)
    setForm({
      primaryGuestId: res.primaryGuestId,
      checkInDate: res.checkInDate ? new Date(res.checkInDate).toISOString().split('T')[0] : "",
      checkOutDate: res.checkOutDate ? new Date(res.checkOutDate).toISOString().split('T')[0] : "",
      adults: res.adults,
      children: res.children,
      mealPlan: res.mealPlan || "NONE",
      travelAgentId: res.travelAgentId || "none",
      status: res.status,
      accompanyingGuestIds: res.accompanyingGuests?.map(ag => ag.profile.upid) || [],
      assignments: res.assignments && res.assignments.length > 0 ? res.assignments.map(a => ({
        roomTypeId: a.roomTypeId,
        roomId: a.roomId || "none",
        ratePlanId: a.ratePlanId,
        overrideRate: a.overrideRate?.toString() || "",
        startDate: a.startDate ? new Date(a.startDate).toISOString().split('T')[0] : "",
        endDate: a.endDate ? new Date(a.endDate).toISOString().split('T')[0] : ""
      })) : [
        {
          roomTypeId: "",
          roomId: "",
          ratePlanId: "",
          overrideRate: "",
          startDate: "",
          endDate: ""
        }
      ]
    })
    setIsDialogOpen(true)
  }

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

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      // Validate assignments
      if (form.assignments.some(a => !a.roomTypeId || !a.ratePlanId || !a.startDate || !a.endDate)) {
        setNotification({ title: "Validation Error", message: "All segments must have dates, room type, and rate plan.", isError: true })
        setSubmitting(false)
        return
      }

      // Compute min start and max end date for the overall reservation
      const dates = form.assignments.flatMap(a => [new Date(a.startDate).getTime(), new Date(a.endDate).getTime()]);
      const minDate = new Date(Math.min(...dates));
      const maxDate = new Date(Math.max(...dates));

      const payload = {
        ...form,
        propertyId,
        checkInDate: minDate.toISOString(),
        checkOutDate: maxDate.toISOString(),
        travelAgentId: form.travelAgentId === "none" ? null : form.travelAgentId,
        assignments: form.assignments.map(a => ({
          roomTypeId: a.roomTypeId,
          roomId: a.roomId === "none" ? null : a.roomId,
          ratePlanId: a.ratePlanId,
          overrideRate: a.overrideRate ? parseFloat(a.overrideRate) : null,
          startDate: new Date(a.startDate).toISOString(),
          endDate: new Date(a.endDate).toISOString()
        }))
      }
      
      const url = selectedRes ? `/api/reservations/${selectedRes.id}` : `/api/reservations`
      const method = selectedRes ? "PUT" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setIsDialogOpen(false)
        resetForm()
        fetchData()
        setNotification({ title: "Success", message: "Reservation saved successfully." })
      } else {
        const err = await res.json()
        setNotification({ title: "Error", message: `Failed to save: ${JSON.stringify(err)}`, isError: true })
      }
    } catch (err) {
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
        setNotification({ title: "Check-out Complete", message: "Guest has been successfully checked out and room marked as dirty." })
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

  const isEditMode = !!selectedRes

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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
            </span>
          )}
        </Button>
      )}
      <Button variant="outline" size="icon" onClick={() => handleEdit(res)} title="Edit">
        <Pencil className="h-4 w-4" />
      </Button>
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
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) resetForm()
          }}>
            <DialogTrigger asChild>
              <Button onClick={() => setIsDialogOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Booking</Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleCreateOrUpdate}>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Booking" : "Create New Booking"}</DialogTitle>
                <DialogDescription>
                  {isEditMode ? "Modify details for this reservation." : "Enter booking details below."}
                </DialogDescription>
              </DialogHeader>
              
              <div className="grid gap-6 py-4">
                <div className="grid gap-2">
                  <Label>Primary Guest <span className="text-destructive">*</span></Label>
                  <SearchableSelect
                    required
                    value={form.primaryGuestId}
                    onChange={(v) => setForm(p => ({ ...p, primaryGuestId: v }))}
                    placeholder="Select Guest..."
                    options={profiles.filter(p => p.profileType === 'GUEST').map(prof => {
                      const name = `${prof.firstName} ${prof.lastName || ''}`.trim();
                      return {
                        value: prof.upid,
                        label: name
                      };
                    })}
                  />
                </div>

                <div className="grid gap-2 p-4 bg-muted border rounded-md">
                  <Label>Accompanying Guests</Label>
                  <div className="flex gap-2">
                    <SearchableSelect
                      value=""
                      onChange={(v) => {
                        if (v && !form.accompanyingGuestIds.includes(v) && v !== form.primaryGuestId) {
                          setForm(p => ({ ...p, accompanyingGuestIds: [...p.accompanyingGuestIds, v] }))
                        }
                      }}
                      placeholder="Add an accompanying guest..."
                      options={profiles.filter(p => p.profileType === 'GUEST' && p.upid !== form.primaryGuestId && !form.accompanyingGuestIds.includes(p.upid)).map(prof => {
                        const name = `${prof.firstName} ${prof.lastName || ''}`.trim();
                        return {
                          value: prof.upid,
                          label: name
                        };
                      })}
                    />
                  </div>
                  {form.accompanyingGuestIds.length > 0 && (
                    <div className="mt-2 flex flex-col gap-2">
                      {form.accompanyingGuestIds.map(gid => {
                        const prof = profiles.find(p => p.upid === gid)
                        if (!prof) return null;
                        const name = prof.profileType === 'COMPANY' || prof.profileType === 'TRAVEL_AGENT' 
                          ? prof.companyName 
                          : `${prof.firstName} ${prof.lastName || ''}`.trim();
                        return (
                          <div key={gid} className="flex justify-between items-center bg-card px-3 py-2 rounded border text-sm shadow-sm">
                            <span>{name}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-destructive hover:text-destructive hover:bg-destructive-muted"
                              onClick={() => setForm(p => ({ ...p, accompanyingGuestIds: p.accompanyingGuestIds.filter(id => id !== gid) }))}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Remove
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-2 p-4 bg-muted border rounded-md">
                  <Label>Booking Source / Travel Agent (Optional)</Label>
                  <SearchableSelect
                    value={form.travelAgentId}
                    onChange={(v) => setForm(p => ({ ...p, travelAgentId: v }))}
                    placeholder="Select Travel Agent..."
                    options={[
                      { value: "none", label: "Direct Booking (None)" },
                      ...profiles.filter(p => p.profileType === 'TRAVEL_AGENT' || p.profileType === 'COMPANY').map(prof => ({
                        value: prof.upid,
                        label: prof.companyName || `${prof.firstName} ${prof.lastName}`
                      }))
                    ]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v ?? "" }))}>
                      <SelectTrigger>
                        <SelectValue>
                          {(() => {
                            const labels: Record<string, string> = {
                              RESERVED: "Reserved",
                              IN_HOUSE: "In House",
                              CHECKED_OUT: "Checked Out",
                              NO_SHOW: "No Show",
                              CANCELLED: "Cancelled"
                            }
                            return labels[form.status] || form.status
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RESERVED">Reserved</SelectItem>
                        <SelectItem value="IN_HOUSE">In House</SelectItem>
                        <SelectItem value="CHECKED_OUT">Checked Out</SelectItem>
                        <SelectItem value="NO_SHOW">No Show</SelectItem>
                        <SelectItem value="CANCELLED">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Meal Plan</Label>
                    <Select value={form.mealPlan} onValueChange={(v) => setForm(p => ({ ...p, mealPlan: v ?? "" }))}>
                      <SelectTrigger>
                        <SelectValue>
                          {(() => {
                            const labels: Record<string, string> = {
                              NONE: "Room Only",
                              BB: "Bed & Breakfast",
                              HB: "Half Board",
                              FB: "Full Board",
                              AI: "All Inclusive"
                            }
                            return labels[form.mealPlan] || form.mealPlan
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Room Only</SelectItem>
                        <SelectItem value="BB">Bed & Breakfast</SelectItem>
                        <SelectItem value="HB">Half Board</SelectItem>
                        <SelectItem value="FB">Full Board</SelectItem>
                        <SelectItem value="AI">All Inclusive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Adults</Label>
                    <Input type="number" min="1" value={form.adults} onChange={e => setForm(p => ({ ...p, adults: parseInt(e.target.value) || 1 }))} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Children</Label>
                    <Input type="number" min="0" value={form.children} onChange={e => setForm(p => ({ ...p, children: parseInt(e.target.value) || 0 }))} />
                  </div>
                </div>

                <div className="flex flex-col gap-4 mt-2">
                  <h3 className="font-semibold text-lg border-b pb-2">Room Segments</h3>
                  {form.assignments.map((assignment, index) => (
                    <div key={index} className="flex flex-col gap-4 p-4 border rounded-md relative bg-muted shadow-sm">
                      <div className="font-semibold text-sm text-foreground flex justify-between items-center">
                        <span>Segment {index + 1}</span>
                        {form.assignments.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-destructive hover:bg-destructive-muted hover:text-destructive" onClick={() => {
                            const newAssignments = [...form.assignments];
                            newAssignments.splice(index, 1);
                            setForm(p => ({ ...p, assignments: newAssignments }));
                          }}>
                            <Trash2 className="h-3 w-3 mr-1" /> Remove
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Check-In Date <span className="text-destructive">*</span></Label>
                          <DatePicker 
                            value={assignment.startDate} 
                            onChange={v => {
                              const newAssignments = [...form.assignments];
                              newAssignments[index].startDate = v;
                              if (index === 0) setForm(p => ({ ...p, checkInDate: v }));
                              setForm(p => ({ ...p, assignments: newAssignments }));
                            }} 
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-2">
                            Check-Out Date <span className="text-destructive">*</span>
                            {assignment.startDate && assignment.endDate && (
                              <span className="text-[10px] font-semibold bg-muted text-foreground px-2 py-0.5 rounded-full">
                                {Math.max(0, Math.round((new Date(assignment.endDate).getTime() - new Date(assignment.startDate).getTime()) / (1000 * 3600 * 24)))} Nights
                              </span>
                            )}
                          </Label>
                          <DatePicker 
                            value={assignment.endDate} 
                            onChange={v => {
                              const newAssignments = [...form.assignments];
                              newAssignments[index].endDate = v;
                              if (index === form.assignments.length - 1) setForm(p => ({ ...p, checkOutDate: v }));
                              setForm(p => ({ ...p, assignments: newAssignments }));
                            }} 
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Room Type <span className="text-destructive">*</span></Label>
                          <Select required value={assignment.roomTypeId} onValueChange={(v) => {
                            const newAssignments = [...form.assignments];
                            newAssignments[index].roomTypeId = v ?? "";
                            newAssignments[index].roomId = "none";
                            setForm(p => ({ ...p, assignments: newAssignments }));
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Room Type">
                                {(() => {
                                  const rt = roomTypes.find(r => r.id === assignment.roomTypeId)
                                  return rt ? `${rt.name} (${rt.code})` : undefined
                                })()}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {roomTypes.map(rt => (
                                <SelectItem key={rt.id} value={rt.id}>
                                  {rt.name} ({rt.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Rate Plan <span className="text-destructive">*</span></Label>
                          <Select required value={assignment.ratePlanId} onValueChange={(v) => {
                            const selectedPlan = ratePlans.find(rp => rp.id === v);
                            const newAssignments = [...form.assignments];
                            newAssignments[index].ratePlanId = v ?? "";
                            if (index === 0 && selectedPlan?.mealPlan) {
                               setForm(p => ({ ...p, mealPlan: selectedPlan.mealPlan }));
                            }
                            setForm(p => ({ ...p, assignments: newAssignments }));
                          }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select Rate Plan">
                                {(() => {
                                  const rp = ratePlans.find(r => r.id === assignment.ratePlanId)
                                  return rp ? rp.name : undefined
                                })()}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {ratePlans.map(rp => (
                                <SelectItem key={rp.id} value={rp.id}>
                                  {rp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label>Room Assignment</Label>
                          <SearchableSelect
                            value={assignment.roomId}
                            onChange={(v) => {
                              const newAssignments = [...form.assignments];
                              newAssignments[index].roomId = v;
                              setForm(p => ({ ...p, assignments: newAssignments }));
                            }}
                            placeholder="Unassigned"
                            options={[
                              { value: "none", label: "Unassigned" },
                              ...rooms.filter(rm => rm.roomTypeId === assignment.roomTypeId).map(rm => ({
                                value: rm.id,
                                label: `Room ${rm.roomNumber}`
                              }))
                            ]}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>Flat Override Rate</Label>
                          <Input 
                            type="number" 
                            placeholder="Optional override" 
                            value={assignment.overrideRate} 
                            onChange={e => {
                              const newAssignments = [...form.assignments];
                              newAssignments[index].overrideRate = e.target.value;
                              setForm(p => ({ ...p, assignments: newAssignments }));
                            }} 
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => {
                    const lastAssignment = form.assignments[form.assignments.length - 1];
                    setForm(p => ({
                      ...p,
                      assignments: [...p.assignments, {
                        roomTypeId: lastAssignment.roomTypeId || "",
                        roomId: "none",
                        ratePlanId: lastAssignment.ratePlanId || "",
                        overrideRate: lastAssignment.overrideRate || "",
                        startDate: lastAssignment.endDate || "",
                        endDate: ""
                      }]
                    }));
                  }}>
                    <Plus className="h-4 w-4 mr-2" /> Add Segment (Split Stay)
                  </Button>
                </div>

              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Booking"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
                        <div className="font-medium text-foreground">{guestName}</div>
                        <div className="text-xs font-mono text-muted-foreground mt-0.5">{res.confirmationNo}</div>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold border shrink-0 ${statusMutedClasses(res.status)} ${res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}>
                        {res.status.replace('_', ' ')}
                      </span>
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
                <TableRow><TableCell colSpan={8} className="text-center py-10">Loading reservations...</TableCell></TableRow>
              ) : reservations.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10">
                  <div className="flex flex-col items-center justify-center">
                    <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-4" />
                    No active reservations found.
                  </div>
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
                        <div className="font-medium">{guestName}</div>
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
                        </div>
                      </TableCell>
                      <TableCell>{format(new Date(res.checkInDate), "dd-MMM-yy")}</TableCell>
                      <TableCell>{format(new Date(res.checkOutDate), "dd-MMM-yy")}</TableCell>
                      <TableCell>{nights}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold border ${statusMutedClasses(res.status)} ${res.status === 'CANCELLED' ? 'line-through opacity-70' : ''}`}>
                          {res.status.replace('_', ' ')}
                        </span>
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
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${statusMutedClasses(task.status)}`}>
                      {task.status.replace('_', ' ')}
                    </span>
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
