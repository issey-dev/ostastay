"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { DatePicker } from "@/components/ui/date-picker"
import { IdentificationManager } from "@/components/profiles/identification-manager"
import { Key, BedDouble, Contact, ReceiptText, CheckCircle2, AlertTriangle, Printer } from "@/components/icons"

type WizardProps = {
  reservationId: string | null
  propertyId: string
  isOpen: boolean
  onClose: () => void
  onDone: (result: { title: string; message: string; isError?: boolean }) => void
}

type Step = "room" | "identification" | "regcard" | "confirm"

const profName = (p: any) => p?.companyName || [p?.title, p?.firstName, p?.middleName, p?.lastName].filter(Boolean).join(" ")
const isExpired = (d?: string | null) => !!d && new Date(d).getTime() < Date.now()

export function CheckInWizard({ reservationId, propertyId, isOpen, onClose, onDone }: WizardProps) {
  const { slug } = useParams<{ slug: string }>()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [rooms, setRooms] = useState<{ id: string; roomNumber: string; status: string }[]>([])
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])

  const [step, setStep] = useState<Step>("room")
  const [guestIdx, setGuestIdx] = useState(0)
  const [selectedRoomId, setSelectedRoomId] = useState<string>("")
  // Local DOB/nationality edits per guest (upid → {dateOfBirth, nationality}) so the UI
  // reflects saves immediately and the completeness warnings update.
  const [idEdits, setIdEdits] = useState<Record<string, { dateOfBirth: string | null; nationality: string | null; docCount: number; hasExpired: boolean }>>({})
  const [savingId, setSavingId] = useState(false)
  const [regCollected, setRegCollected] = useState<Set<string>>(new Set())
  const [payment, setPayment] = useState({ methodId: "", amount: "", reference: "" })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reservation = data?.reservation
  const settings = data?.settings
  const regCardEnabled = !!settings?.registrationCardEnabled

  const guests = useMemo(() => {
    if (!reservation) return []
    return [
      { profile: reservation.primaryGuest, isLead: true },
      ...(reservation.accompanyingGuests ?? []).map((a: any) => ({ profile: a.profile, isLead: false })),
    ]
  }, [reservation])

  // The arrival segment (earliest) — what a room is assigned to for check-in.
  const activeAssignment = reservation?.assignments?.[0]

  useEffect(() => {
    if (!isOpen || !reservationId) return
    setLoading(true); setError(null); setStep("room"); setGuestIdx(0); setRegCollected(new Set())
    setPayment({ methodId: "", amount: "", reference: "" })
    fetch(`/api/reservations/${reservationId}/registration-card-data`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        const asg = d.reservation?.assignments?.[0]
        setSelectedRoomId(asg?.roomId ?? "")
        // Seed per-guest identification state from the loaded profiles.
        const seed: typeof idEdits = {}
        const people = [d.reservation.primaryGuest, ...(d.reservation.accompanyingGuests ?? []).map((a: any) => a.profile)]
        for (const p of people) {
          seed[p.upid] = {
            dateOfBirth: p.dateOfBirth ?? null,
            nationality: p.nationality ?? null,
            docCount: (p.documents ?? []).length,
            hasExpired: (p.documents ?? []).some((doc: any) => isExpired(doc.expiryDate)),
          }
        }
        setIdEdits(seed)
        // Available rooms for the arrival segment's room type.
        if (asg) {
          const qs = new URLSearchParams({
            propertyId, roomTypeId: asg.roomTypeId,
            checkInDate: d.reservation.checkInDate, checkOutDate: d.reservation.checkOutDate,
            excludeReservationId: reservationId,
          })
          fetch(`/api/rooms/available?${qs}`).then((r) => r.json()).then((rd) => {
            const list: { id: string; roomNumber: string; status: string }[] = Array.isArray(rd) ? rd : []
            // Keep the currently-assigned room visible even if it's no longer "available".
            if (asg.room && !list.some((x) => x.id === asg.room.id)) list.unshift(asg.room)
            setRooms(list)
          }).catch(() => {})
        }
      })
      .catch(() => setError("Failed to load the reservation."))
      .finally(() => setLoading(false))
    fetch(`/api/payment-methods`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setPaymentMethods(d.filter((m: any) => m.isActive !== false))
    }).catch(() => {})
  }, [isOpen, reservationId, propertyId])

  const guestStatus = (upid: string) => {
    const e = idEdits[upid]
    if (!e) return { complete: false, missing: ["details"] as string[], hasExpired: false }
    const missing: string[] = []
    if (!e.dateOfBirth) missing.push("Date of Birth")
    if (!e.nationality) missing.push("Nationality")
    if (e.docCount === 0) missing.push("ID record")
    return { complete: missing.length === 0, missing, hasExpired: e.hasExpired }
  }

  const saveGuestBasics = async (upid: string) => {
    const e = idEdits[upid]
    setSavingId(true)
    try {
      await fetch(`/api/profiles/${upid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateOfBirth: e.dateOfBirth, nationality: e.nationality }),
      })
    } finally {
      setSavingId(false)
    }
  }

  // After the ID-document manager changes, re-pull the guest's docs to refresh warnings.
  const refreshDocs = async (upid: string) => {
    try {
      const res = await fetch(`/api/profiles/${upid}/documents`)
      if (!res.ok) return
      const docs = await res.json()
      setIdEdits((prev) => ({
        ...prev,
        [upid]: { ...prev[upid], docCount: docs.length, hasExpired: docs.some((d: any) => isExpired(d.expiryDate)) },
      }))
    } catch { /* non-blocking */ }
  }

  const anyIdIncomplete = guests.some((g) => !guestStatus(g.profile.upid).complete)
  const anyExpired = guests.some((g) => guestStatus(g.profile.upid).hasExpired)

  const doCheckIn = async () => {
    if (!reservationId) return
    setSubmitting(true); setError(null)
    try {
      // 1. Assign the arrival room if it changed.
      if (activeAssignment && selectedRoomId && selectedRoomId !== activeAssignment.roomId) {
        const res = await fetch(`/api/reservations/assignments/${activeAssignment.id}/reassign`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: selectedRoomId }),
        })
        if (!res.ok) { setError((await res.json()).error || "Failed to assign the room."); setSubmitting(false); return }
      }
      // 2. Check in.
      const res = await fetch(`/api/reservations/${reservationId}/check-in`, { method: "POST" })
      const checkInData = await res.json()
      if (!res.ok) { setError(checkInData.error || "Check-in failed."); setSubmitting(false); return }
      // 3. Optional payment.
      const amt = parseFloat(payment.amount)
      if (payment.methodId && Number.isFinite(amt) && amt > 0 && checkInData.folioId) {
        await fetch(`/api/folios/${checkInData.folioId}/payments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethodId: payment.methodId, amount: amt, referenceNumber: payment.reference }),
        })
      }
      onDone({ title: "Checked In", message: `${profName(reservation.primaryGuest)} is now In-House.${checkInData.roomWarning ? ` (${checkInData.roomWarning})` : ""}` })
      onClose()
    } catch {
      setError("An error occurred during check-in.")
    } finally {
      setSubmitting(false)
    }
  }

  const stepList: { key: Step; label: string; icon: any }[] = [
    { key: "room", label: "Room", icon: BedDouble },
    { key: "identification", label: "Identification", icon: Contact },
    ...(regCardEnabled ? [{ key: "regcard" as Step, label: "Registration Card", icon: ReceiptText }] : []),
    { key: "confirm", label: "Confirm", icon: CheckCircle2 },
  ]
  const stepIndex = stepList.findIndex((s) => s.key === step)
  const goNextStep = () => setStep(stepList[Math.min(stepIndex + 1, stepList.length - 1)].key)
  const goPrevStep = () => setStep(stepList[Math.max(stepIndex - 1, 0)].key)

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId)
  const roomBlocked = selectedRoom && (selectedRoom.status === "OUT_OF_ORDER" || selectedRoom.status === "OUT_OF_SERVICE")

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Key className="w-5 h-5" /> Check In — {reservation ? reservation.confirmationNo : ""}</DialogTitle>
          <DialogDescription>{reservation ? profName(reservation.primaryGuest) : ""}</DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {stepList.map((s, i) => (
            <div key={s.key} className={`flex items-center gap-1.5 px-2 py-1 rounded ${i === stepIndex ? "bg-primary/10 text-primary font-medium" : i < stepIndex ? "text-success" : "text-muted-foreground"}`}>
              <s.icon className="w-3.5 h-3.5" /> {s.label}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground">Loading…</div>
        ) : !reservation ? (
          <div className="py-12 text-center text-destructive">{error || "Reservation not found."}</div>
        ) : (
          <div className="py-2 space-y-4">
            {/* STEP: ROOM */}
            {step === "room" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">A room must be assigned to check the guest in.</p>
                <div className="space-y-1.5">
                  <Label>Room ({activeAssignment?.roomType?.name})</Label>
                  <SearchableSelect
                    value={selectedRoomId}
                    onChange={(v) => setSelectedRoomId(v)}
                    placeholder="Select a room…"
                    options={rooms.map((r) => ({ value: r.id, label: `Room ${r.roomNumber}${r.status !== "CLEAN" && r.status !== "INSPECTED" ? ` · ${r.status.replace(/_/g, " ").toLowerCase()}` : ""}` }))}
                  />
                </div>
                {roomBlocked && <p className="text-sm text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> This room is out of order/service — check-in will be blocked. Pick another.</p>}
                {selectedRoom?.status === "DIRTY" && <p className="text-sm text-warning flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> This room hasn't been cleaned yet — you can proceed with a warning.</p>}
              </div>
            )}

            {/* STEP: IDENTIFICATION (per guest, one by one) */}
            {step === "identification" && guests[guestIdx] && (() => {
              const g = guests[guestIdx]
              const upid = g.profile.upid
              const e = idEdits[upid]
              const status = guestStatus(upid)
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{profName(g.profile)}</h4>
                      <Badge variant="outline" className="text-[10px] uppercase">{g.isLead ? "Lead" : "Accompanying"}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">Guest {guestIdx + 1} of {guests.length}</span>
                  </div>

                  {status.complete ? (
                    <p className="text-sm text-success flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> On file — confirm the details below are current.{status.hasExpired && <span className="text-destructive ml-1">(an ID has expired — please update)</span>}</p>
                  ) : (
                    <p className="text-sm text-warning flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Missing: {status.missing.join(", ")}. You can complete it now or skip (not enforced).</p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Date of Birth</Label>
                      <DatePicker value={e?.dateOfBirth ?? undefined} onChange={(v: any) => setIdEdits((p) => ({ ...p, [upid]: { ...p[upid], dateOfBirth: v ?? null } }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nationality</Label>
                      <SystemCodeSelect category="NATIONALITY" value={e?.nationality ?? ""} onValueChange={(v) => setIdEdits((p) => ({ ...p, [upid]: { ...p[upid], nationality: v } }))} placeholder="Select nationality" />
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => saveGuestBasics(upid)} disabled={savingId}>{savingId ? "Saving…" : "Save Date of Birth & Nationality"}</Button>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Identification Documents</Label>
                    <div className="rounded-lg border p-3">
                      <IdentificationManager upid={upid} onChange={() => refreshDocs(upid)} />
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* STEP: REGISTRATION CARD (per guest) */}
            {step === "regcard" && guests[guestIdx] && (() => {
              const g = guests[guestIdx]
              const upid = g.profile.upid
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{profName(g.profile)}</h4>
                      <Badge variant="outline" className="text-[10px] uppercase">{g.isLead ? "Lead" : "Accompanying"}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">Guest {guestIdx + 1} of {guests.length}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Print the registration card for the guest to complete and physically sign.</p>
                  <Button variant="outline" onClick={() => window.open(`/e/${slug}/dashboard/reservations/${reservationId}/registration-card?guest=${upid}`, "_blank")}>
                    <Printer className="w-4 h-4 mr-2" /> Print Registration Card
                  </Button>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={regCollected.has(upid)} onCheckedChange={(v) => setRegCollected((prev) => { const n = new Set(prev); if (v) n.add(upid); else n.delete(upid); return n })} />
                    Printed &amp; signed card collected
                  </label>
                </div>
              )
            })()}

            {/* STEP: CONFIRM */}
            {step === "confirm" && (
              <div className="space-y-4">
                <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Room</span><span className="font-medium">{selectedRoom ? `Room ${selectedRoom.roomNumber}` : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Guests</span><span className="font-medium">{guests.length}</span></div>
                  {anyIdIncomplete && <p className="text-warning flex items-center gap-1.5 pt-1"><AlertTriangle className="w-4 h-4" /> Some guests have incomplete identification (not enforced).</p>}
                  {anyExpired && <p className="text-destructive flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> A guest has an expired ID on file.</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Collect a payment now (optional)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <SearchableSelect value={payment.methodId} onChange={(v) => setPayment((p) => ({ ...p, methodId: v }))} placeholder="Method" options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))} />
                    <Input type="number" min="0" step="0.01" placeholder="Amount" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} />
                    <Input placeholder="Reference" value={payment.reference} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))} />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {stepIndex > 0 && step !== "confirm" && guestIdx === 0 && <Button variant="ghost" onClick={goPrevStep}>Back</Button>}
            {(step === "identification" || step === "regcard") && guestIdx > 0 && <Button variant="ghost" onClick={() => setGuestIdx((i) => i - 1)}>Previous guest</Button>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {step === "room" && <Button onClick={goNextStep} disabled={!selectedRoomId || !!roomBlocked}>Next</Button>}
            {(step === "identification" || step === "regcard") && (
              guestIdx < guests.length - 1
                ? <Button onClick={() => setGuestIdx((i) => i + 1)}>Next guest</Button>
                : <Button onClick={() => { setGuestIdx(0); goNextStep() }}>Continue</Button>
            )}
            {step === "confirm" && <Button onClick={doCheckIn} disabled={submitting || !selectedRoomId}><Key className="w-4 h-4 mr-2" /> {submitting ? "Checking in…" : "Check In"}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
