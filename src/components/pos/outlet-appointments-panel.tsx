"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { CalendarClock, Plus, CheckCircle2, XCircle, UserX } from "@/components/icons"

type ChargeCodeOption = { id: string; code: string; description: string }

// A simple appointment log for one Outlet — no resource/room-capacity model, just a
// schedule staff can see and act on. The optional Outlet.appointmentCapPerSlot only
// ever produces a non-blocking warning on create, shown as a toast here; it never
// prevents booking (full resource-capacity booking is a future higher-tier feature).
export function OutletAppointmentsPanel({
  outletId,
  outletName,
  chargeCodes,
  propertyId,
}: {
  outletId: string
  outletName: string
  chargeCodes: ChargeCodeOption[]
  propertyId: string
}) {
  const [appointments, setAppointments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [guestMode, setGuestMode] = useState<"walkin" | "reservation">("walkin")
  const [reservations, setReservations] = useState<any[]>([])
  const [form, setForm] = useState({
    chargeCodeId: "",
    date: "",
    time: "",
    durationMinutes: "60",
    reservationId: "",
    walkInGuestName: "",
    walkInGuestContact: "",
    notes: "",
  })

  const fetchAppointments = useCallback(() => {
    setLoading(true)
    fetch(`/api/outlets/${outletId}/appointments?from=${new Date().toISOString()}`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setAppointments(data) })
      .finally(() => setLoading(false))
  }, [outletId])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  useEffect(() => {
    if (guestMode === "reservation" && propertyId) {
      fetch(`/api/reservations?propertyId=${propertyId}`)
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data)) setReservations(data) })
        .catch(console.error)
    }
  }, [guestMode, propertyId])

  const resetForm = () => setForm({
    chargeCodeId: "", date: "", time: "", durationMinutes: "60",
    reservationId: "", walkInGuestName: "", walkInGuestContact: "", notes: "",
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.date || !form.time) return
    setSubmitting(true)
    setError(null)
    setWarning(null)
    try {
      const startTime = new Date(`${form.date}T${form.time}`)
      const endTime = form.durationMinutes ? new Date(startTime.getTime() + parseInt(form.durationMinutes) * 60000) : null

      const res = await fetch(`/api/outlets/${outletId}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeCodeId: form.chargeCodeId || undefined,
          startTime: startTime.toISOString(),
          endTime: endTime ? endTime.toISOString() : undefined,
          reservationId: guestMode === "reservation" ? form.reservationId : undefined,
          walkInGuestName: guestMode === "walkin" ? form.walkInGuestName : undefined,
          walkInGuestContact: guestMode === "walkin" ? form.walkInGuestContact : undefined,
          notes: form.notes || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.capWarning) {
          setWarning(`This exceeds ${outletName}'s capacity for this time slot (${data.capWarning.overlappingCount} of ${data.capWarning.cap} booked) — booked anyway.`)
        }
        resetForm()
        fetchAppointments()
      } else {
        const err = await res.json()
        setError(err.error || "Failed to book appointment")
      }
    } catch (err) {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (appointmentId: string, status: string) => {
    await fetch(`/api/outlets/${outletId}/appointments/${appointmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    fetchAppointments()
  }

  const guestLabel = (a: any) => a.reservation
    ? `${a.reservation.primaryGuest.firstName} ${a.reservation.primaryGuest.lastName || ""}`.trim()
    : (a.walkInGuestName || "Walk-in")

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="bg-card rounded-xl shadow-sm border border-border p-6 space-y-4">
        <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Plus className="w-5 h-5 text-primary" /> New Appointment
        </h3>

        <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium w-fit">
          <button type="button" className={`px-3 py-1.5 ${guestMode === "walkin" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setGuestMode("walkin")}>Walk-in</button>
          <button type="button" className={`px-3 py-1.5 ${guestMode === "reservation" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setGuestMode("reservation")}>In-house Guest</button>
        </div>

        {guestMode === "walkin" ? (
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Guest name" required={guestMode === "walkin"} value={form.walkInGuestName} onChange={(e) => setForm((p) => ({ ...p, walkInGuestName: e.target.value }))} />
            <Input placeholder="Phone / email (optional)" value={form.walkInGuestContact} onChange={(e) => setForm((p) => ({ ...p, walkInGuestContact: e.target.value }))} />
          </div>
        ) : (
          <Select value={form.reservationId} onValueChange={(v) => setForm((p) => ({ ...p, reservationId: v ?? "" }))}>
            <SelectTrigger>
              <SelectValue placeholder="Select reservation...">
                {(() => {
                  const r = reservations.find((x) => x.id === form.reservationId)
                  return r ? `${r.primaryGuest?.firstName} ${r.primaryGuest?.lastName || ""} (${r.confirmationNo})` : undefined
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {reservations.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.primaryGuest?.firstName} {r.primaryGuest?.lastName || ""} ({r.confirmationNo})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Select value={form.chargeCodeId} onValueChange={(v) => setForm((p) => ({ ...p, chargeCodeId: v ?? "" }))}>
            <SelectTrigger>
              <SelectValue placeholder="Service (optional)">
                {chargeCodes.find((c) => c.id === form.chargeCodeId)?.description}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {chargeCodes.map((c) => <SelectItem key={c.id} value={c.id}>{c.description} ({c.code})</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" min="0" placeholder="Duration (min)" value={form.durationMinutes} onChange={(e) => setForm((p) => ({ ...p, durationMinutes: e.target.value }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input type="date" required value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} />
          <Input type="time" required value={form.time} onChange={(e) => setForm((p) => ({ ...p, time: e.target.value }))} />
        </div>

        <Input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />

        {warning && <div className="p-3 rounded-lg text-sm font-medium bg-warning-muted text-warning">{warning}</div>}
        {error && <div className="p-3 rounded-lg text-sm font-medium bg-destructive-muted text-destructive">{error}</div>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Booking..." : "Book Appointment"}
        </Button>
      </form>

      <div>
        <h3 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" /> Upcoming Appointments
        </h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : appointments.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No upcoming appointments for this outlet" />
        ) : (
          <div className="space-y-3">
            {appointments.map((a) => (
              <div key={a.id} className="bg-card p-4 rounded-lg shadow-sm border border-border flex justify-between items-center">
                <div>
                  <p className="font-bold text-foreground">{guestLabel(a)}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(a.startTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    {a.chargeCode && ` — ${a.chargeCode.description}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={a.status} status={a.status} />
                  {a.status === "SCHEDULED" && (
                    <>
                      <Button size="sm" variant="ghost" className="text-success" onClick={() => updateStatus(a.id, "COMPLETED")}>
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => updateStatus(a.id, "NO_SHOW")}>
                        <UserX className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => updateStatus(a.id, "CANCELLED")}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
