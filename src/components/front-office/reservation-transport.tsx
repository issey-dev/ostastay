"use client"

import { useEffect, useState } from "react"
import { postableChargeCodes } from "@/lib/charge-code-options"
import { Compass, Pencil, ArrowRightCircle, ArrowLeftRight } from "@/components/icons"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SystemCodeSelect } from "@/components/ui/system-code-select"

type Dir = "PICKUP" | "DROPOFF"

type Leg = {
  direction: Dir
  transportType?: string | null
  carrierCode?: string | null
  carrierTime?: string | null
  transportNo?: string | null
  transportTime?: string | null
  remarks?: string | null
  chargeToGuest?: boolean
  chargeCodeId?: string | null
  chargeAmount?: number | null
  chargedLineItemId?: string | null
}

type FormLeg = {
  transportType: string
  carrierCode: string
  carrierTime: string
  transportNo: string
  transportTime: string
  remarks: string
  chargeToGuest: boolean
  chargeCodeId: string
  chargeAmount: string
}

const DIRECTIONS: { key: Dir; label: string; icon: typeof ArrowRightCircle }[] = [
  { key: "PICKUP", label: "Pickup (Arrival)", icon: ArrowRightCircle },
  { key: "DROPOFF", label: "Dropoff (Departure)", icon: ArrowLeftRight },
]

function toLocalInput(iso?: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fmt = (iso?: string | null) => (iso ? format(new Date(iso), "dd-MMM h:mm a") : null)

const emptyForm = (): FormLeg => ({
  transportType: "", carrierCode: "", carrierTime: "", transportNo: "", transportTime: "",
  remarks: "", chargeToGuest: false, chargeCodeId: "", chargeAmount: "",
})

function legToForm(leg?: Leg): FormLeg {
  if (!leg) return emptyForm()
  return {
    transportType: leg.transportType ?? "",
    carrierCode: leg.carrierCode ?? "",
    carrierTime: toLocalInput(leg.carrierTime),
    transportNo: leg.transportNo ?? "",
    transportTime: toLocalInput(leg.transportTime),
    remarks: leg.remarks ?? "",
    chargeToGuest: !!leg.chargeToGuest,
    chargeCodeId: leg.chargeCodeId ?? "",
    chargeAmount: leg.chargeAmount != null ? String(leg.chargeAmount) : "",
  }
}

export function ReservationTransport({
  reservationId,
  propertyId,
  checkInDate,
  checkOutDate,
  transports,
  onChanged,
  onNotify,
}: {
  reservationId: string
  propertyId: string
  checkInDate: string
  checkOutDate: string
  transports: Leg[]
  onChanged: () => void
  onNotify: (n: { title: string; message: string; isError?: boolean }) => void
}) {
  const legFor = (dir: Dir) => transports.find((t) => t.direction === dir)
  // Transport time must fall inside the stay (the charge realizes within these dates);
  // carrier/flight time may be earlier but not after check-out. Bounds are datetime-local
  // strings so they compare lexically against the inputs' own values.
  const stayMin = `${checkInDate.slice(0, 10)}T00:00`
  const stayMax = `${checkOutDate.slice(0, 10)}T23:59`
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [forms, setForms] = useState<Record<Dir, FormLeg>>({ PICKUP: emptyForm(), DROPOFF: emptyForm() })
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({})
  const [chargeCodes, setChargeCodes] = useState<{ id: string; code: string; description: string; category: string }[]>([])

  useEffect(() => {
    fetch(`/api/settings/system-codes?category=TRANSPORT_TYPE`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => Array.isArray(rows) && setTypeLabels(Object.fromEntries(rows.map((c) => [c.code, c.value]))))
      .catch(() => {})
    fetch(`/api/charge-codes?propertyId=${propertyId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => Array.isArray(rows) && setChargeCodes(postableChargeCodes(rows, { buckets: ["TRANSPORT"] })))
      .catch(() => {})
  }, [propertyId])

  const openEditor = () => {
    setForms({ PICKUP: legToForm(legFor("PICKUP")), DROPOFF: legToForm(legFor("DROPOFF")) })
    setIsEditing(true)
  }
  const update = (dir: Dir, patch: Partial<FormLeg>) => setForms((f) => ({ ...f, [dir]: { ...f[dir], ...patch } }))

  const handleSave = async () => {
    // Client-side guard (also enforced server-side): transport time within the stay,
    // carrier time not after check-out.
    for (const { key, label } of DIRECTIONS) {
      const f = forms[key]
      if (f.transportTime && (f.transportTime < stayMin || f.transportTime > stayMax)) {
        onNotify({ title: "Invalid Transport Time", message: `${label}: transport time must fall between check-in and check-out.`, isError: true })
        return
      }
      if (f.carrierTime && f.carrierTime > stayMax) {
        onNotify({ title: "Invalid Carrier Time", message: `${label}: carrier (flight) time cannot be after check-out.`, isError: true })
        return
      }
    }
    setSaving(true)
    try {
      const payload = {
        transports: DIRECTIONS.map(({ key }) => {
          const f = forms[key]
          return {
            direction: key,
            transportType: f.transportType || null,
            carrierCode: f.carrierCode || null,
            carrierTime: f.carrierTime || null,
            transportNo: f.transportNo || null,
            transportTime: f.transportTime || null,
            remarks: f.remarks || null,
            chargeToGuest: f.chargeToGuest,
            chargeCodeId: f.chargeToGuest ? f.chargeCodeId || null : null,
            chargeAmount: f.chargeToGuest && f.chargeAmount ? parseFloat(f.chargeAmount) : null,
          }
        }),
      }
      const res = await fetch(`/api/reservations/${reservationId}/transport`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsEditing(false)
        onChanged()
      } else {
        const data = await res.json().catch(() => ({}))
        onNotify({ title: "Save Failed", message: data.error || "Could not save transport.", isError: true })
      }
    } finally {
      setSaving(false)
    }
  }

  const hasAny = transports.length > 0
  const detail = (label: string, value?: string | null) =>
    value ? (
      <p className="text-xs">
        <span className="text-muted-foreground">{label}: </span>{value}
      </p>
    ) : null

  return (
    <Card className="shadow-elevation-1 lg:col-span-2">
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <CardTitle className="text-lg flex items-center gap-2">
          <Compass className="w-5 h-5 text-muted-foreground" /> Transport
        </CardTitle>
        <Button variant="outline" size="sm" onClick={openEditor}>
          <Pencil className="w-4 h-4 mr-2" /> {hasAny ? "Edit" : "Add"}
        </Button>
      </CardHeader>
      <CardContent className="text-sm">
        {!hasAny ? (
          <p className="text-muted-foreground">No pickup or dropoff arranged.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {DIRECTIONS.map(({ key, label, icon: Icon }) => {
              const leg = legFor(key)
              return (
                <div key={key} className="rounded-md border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </p>
                  {!leg ? (
                    <p className="text-muted-foreground">Not set</p>
                  ) : (
                    <div className="space-y-1">
                      {leg.transportType && (
                        <Badge variant="outline" className="mb-1">{typeLabels[leg.transportType] ?? leg.transportType}</Badge>
                      )}
                      {detail("Carrier", [leg.carrierCode, fmt(leg.carrierTime)].filter(Boolean).join(" · "))}
                      {detail("Transport", [leg.transportNo, fmt(leg.transportTime)].filter(Boolean).join(" · "))}
                      {detail("Remarks", leg.remarks)}
                      {leg.chargeToGuest && leg.chargeAmount != null && leg.chargeAmount > 0 && (() => {
                        const realizeIso = leg.transportTime ?? leg.carrierTime
                        const realizeStr = realizeIso ? format(new Date(realizeIso), "dd-MMM-yy") : null
                        return (
                          <div className="pt-1">
                            {leg.chargedLineItemId ? (
                              <Badge variant="outline" className="bg-success-muted text-success border-success/30 text-[10px]">
                                Charged ${leg.chargeAmount.toFixed(2)}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                ${leg.chargeAmount.toFixed(2)} — posts at Night Audit{realizeStr ? ` on ${realizeStr}` : ""}
                              </Badge>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Editor */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transport</DialogTitle>
            <DialogDescription>Pickup and dropoff details. Leave a section blank to remove it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 sm:grid-cols-2">
            {DIRECTIONS.map(({ key, label, icon: Icon }) => {
              const f = forms[key]
              return (
                <div key={key} className="space-y-3 rounded-lg border border-border p-4">
                  <p className="font-semibold flex items-center gap-2 text-sm">
                    <Icon className="w-4 h-4 text-muted-foreground" /> {label}
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Carrier Code (Flight No.)</Label>
                    <Input value={f.carrierCode} onChange={(e) => update(key, { carrierCode: e.target.value })} placeholder="e.g. Q2-104" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Carrier Time (Flight Time)</Label>
                    <Input type="datetime-local" max={stayMax} value={f.carrierTime} onChange={(e) => update(key, { carrierTime: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transport Type</Label>
                    <SystemCodeSelect
                      category="TRANSPORT_TYPE"
                      value={f.transportType}
                      onValueChange={(v) => update(key, { transportType: v ?? "" })}
                      placeholder="Select type…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transport No.</Label>
                    <Input value={f.transportNo} onChange={(e) => update(key, { transportNo: e.target.value })} placeholder="Vessel / vehicle / ticket no." />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transport Time</Label>
                    <Input type="datetime-local" min={stayMin} max={stayMax} value={f.transportTime} onChange={(e) => update(key, { transportTime: e.target.value })} />
                    <p className="text-[11px] text-muted-foreground">Must fall within the stay (check-in to check-out).</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Transport Remarks</Label>
                    <Input value={f.remarks} onChange={(e) => update(key, { remarks: e.target.value })} placeholder="Free text" />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Label className="text-xs">Booked by hotel — charge guest</Label>
                    <Switch checked={f.chargeToGuest} onCheckedChange={(v) => update(key, { chargeToGuest: !!v })} />
                  </div>
                  {f.chargeToGuest && (
                    <div className="space-y-3 rounded-md bg-muted/40 p-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Charge Code</Label>
                        <Select value={f.chargeCodeId} onValueChange={(v) => update(key, { chargeCodeId: v ?? "" })}>
                          <SelectTrigger>
                            <SelectValue placeholder={chargeCodes.length ? "Select charge code…" : "No transport charge codes"}>
                              {(() => {
                                const c = chargeCodes.find((cc) => cc.id === f.chargeCodeId)
                                return c ? `${c.code} — ${c.description}` : undefined
                              })()}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {chargeCodes.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.code} — {c.description}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {chargeCodes.length === 0 && (
                          <p className="text-[11px] text-warning">Add a Transportation charge code in Controls › Finance › Charge Codes.</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Charge Amount</Label>
                        <Input type="number" min="0" step="0.01" value={f.chargeAmount} onChange={(e) => update(key, { chargeAmount: e.target.value })} placeholder="0.00" />
                        <p className="text-[11px] text-muted-foreground">Posted to the guest folio (tax applied) after check-in.</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Transport"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
