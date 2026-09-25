"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/ui/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"
import { MobileActions, type MobileAction } from "@/components/ui/mobile"

// The desk's view of one spa appointment, and its lifecycle: check in → start → complete,
// or no-show / cancel (SPA_PLAN.md §6/§9; server rules in src/lib/spa-lifecycle.ts). The
// server decides permissions — a late cancel or a waived fee needs a manager, voiding the
// charge needs cashiering — and says what it did with the money; this panel shows that.

type Appointment = {
  id: string
  propertyId: string
  appointmentDate: string
  startTime: string
  treatmentEndTime: string
  appointmentStatus: string
  paymentStatus: string
  priceSnapshot: number
  currencySnapshot: string
  partySize: number
  source: string
  holdExpiresAt: string | null
  notes: string | null
  folioId: string | null
  cancellationReasonCode: string | null
  cancellationNotes: string | null
  treatment: { name: string }
  room: { name: string } | null
  participants: {
    participantIndex: number
    walkInGuestName: string | null
    reservation: { primaryGuest: { firstName: string; lastName: string | null } } | null
    therapist: { displayName: string } | null
  }[]
  apiBooking: {
    publicRef: string
    paymentStatus: string | null
    paymentReference: string | null
    paymentProvider: string | null
    amountMismatch: boolean
    guestEmail: string | null
    guestPhone: string | null
  } | null
}

const REASONS: { value: string; label: string }[] = [
  { value: "GUEST_REQUEST", label: "Guest request" },
  { value: "ILLNESS", label: "Illness" },
  { value: "SCHEDULE_CONFLICT", label: "Schedule conflict" },
  { value: "THERAPIST_UNAVAILABLE", label: "Therapist unavailable" },
  { value: "ROOM_UNAVAILABLE", label: "Room unavailable" },
  { value: "WEATHER", label: "Weather" },
  { value: "DUPLICATE", label: "Duplicate booking" },
  { value: "OTHER", label: "Other" },
]

const PAYMENT_LABEL: Record<string, string> = {
  NOT_POSTED: "Not charged yet",
  POSTED_TO_FOLIO: "On the bill",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid",
  VOID_PENDING: "Charge to be voided by cashiering",
  VOIDED: "Charge voided",
  REFUND_REQUIRED: "Refund due",
  REFUNDED: "Refunded",
}

// The reason is required unless the property's Spa settings switch off "Require
// cancellation reason" (the API enforces the same rule — cancelSpaAppointment).
const cancelSchemaFor = (reasonRequired: boolean) =>
  z
    .object({ reasonCode: z.string(), notes: z.string().max(500), waiveFee: z.boolean() })
    .refine((v) => !reasonRequired || v.reasonCode.length > 0, { message: "Choose a reason", path: ["reasonCode"] })
    .refine((v) => v.reasonCode !== "OTHER" || v.notes.trim().length > 0, { message: "Describe the reason", path: ["notes"] })
type CancelValues = z.infer<ReturnType<typeof cancelSchemaFor>>

const noShowSchema = z
  .object({ waiveFee: z.boolean(), notes: z.string().max(500) })
  .refine((v) => !v.waiveFee || v.notes.trim().length > 0, { message: "Say why the fee is waived", path: ["notes"] })
type NoShowValues = z.infer<typeof noShowSchema>

const guestLabel = (p: Appointment["participants"][number]) =>
  p.reservation ? `${p.reservation.primaryGuest.firstName} ${p.reservation.primaryGuest.lastName ?? ""}`.trim() : p.walkInGuestName ?? "Guest"

export function SpaAppointmentSheet({
  appointmentId,
  onClose,
  onChanged,
  onOpenBill,
}: {
  appointmentId: string | null
  onClose: () => void
  /** Something changed — reload whatever lists the appointment. */
  onChanged: () => void
  onOpenBill: (folioId: string) => void
}) {
  const [appt, setAppt] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<"view" | "cancel" | "noshow">("view")

  // SpaSettings.requireCancellationReason for this appointment's property (default on).
  const [reasonRequired, setReasonRequired] = useState(true)
  const cancelForm = useForm<CancelValues>({ resolver: zodResolver(cancelSchemaFor(reasonRequired)), mode: "onChange", defaultValues: { reasonCode: "", notes: "", waiveFee: false } })
  const noShowForm = useForm<NoShowValues>({ resolver: zodResolver(noShowSchema), mode: "onChange", defaultValues: { waiveFee: false, notes: "" } })

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/spa/appointments/${id}`)
      if (res.ok) setAppt(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setMode("view")
    setAppt(null)
    cancelForm.reset({ reasonCode: "", notes: "", waiveFee: false })
    noShowForm.reset({ waiveFee: false, notes: "" })
    if (appointmentId) load(appointmentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, load])

  const act = async (path: string, body: unknown, done: string) => {
    if (!appt) return
    setBusy(true)
    try {
      const res = await fetch(`/api/spa/appointments/${appt.id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(typeof data?.error === "string" ? data.error : "That didn't work")
        return
      }
      toast.success(data?.chargeNote ? `${done}. ${data.chargeNote}` : done)
      setMode("view")
      await load(appt.id)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const propertyIdForSettings = appt?.propertyId
  useEffect(() => {
    if (!propertyIdForSettings) return
    let alive = true
    fetch(`/api/spa/settings?propertyId=${propertyIdForSettings}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive) setReasonRequired(s?.requireCancellationReason ?? true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [propertyIdForSettings])

  const status = appt?.appointmentStatus
  const heldOnline = status === "TENTATIVE" && appt?.source === "WEBSITE_API"

  // Phones: a pinned footer with the ONE next lifecycle step as the primary button, the
  // rest under More — the same handlers (and the same cancel / no-show forms) as desktop.
  const nextStep =
    status === "CONFIRMED" ? { label: "Check in", run: () => act("check-in", {}, "Checked in") }
    : status === "CHECKED_IN" ? { label: "Start treatment", run: () => act("start", {}, "Treatment started") }
    : status === "IN_TREATMENT" ? { label: "Complete", run: () => act("complete", {}, "Completed") }
    : null
  const phoneMore: MobileAction[] = [
    ...(status === "CHECKED_IN" ? [{ label: "Complete", disabled: busy, onSelect: () => act("complete", {}, "Completed") }] : []),
    ...(appt?.folioId ? [{ label: "Open bill", onSelect: () => onOpenBill(appt.folioId!) }] : []),
    ...(status === "CONFIRMED" ? [{ label: "No-show", disabled: busy, destructive: true, onSelect: () => setMode("noshow") }] : []),
    ...(status === "CONFIRMED" || status === "CHECKED_IN" || status === "IN_TREATMENT"
      ? [{ label: "Cancel appointment", disabled: busy, destructive: true, onSelect: () => setMode("cancel") }]
      : []),
  ]

  return (
    <Sheet open={!!appointmentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{appt?.treatment.name ?? "Appointment"}</SheetTitle>
          <SheetDescription>
            {appt ? `${new Date(appt.appointmentDate).toLocaleDateString()} · ${appt.startTime}–${appt.treatmentEndTime}` : " "}
          </SheetDescription>
        </SheetHeader>

        {loading || !appt ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={heldOnline ? "Held online" : appt.appointmentStatus.replace("_", " ")} status={appt.appointmentStatus} />
              {appt.source === "WEBSITE_API" && <Badge variant="outline">Online</Badge>}
              {appt.apiBooking && <span className="font-mono text-xs text-muted-foreground">{appt.apiBooking.publicRef}</span>}
            </div>

            {heldOnline && (
              <p className="text-muted-foreground">
                A website is holding this time while its guest pays
                {appt.holdExpiresAt ? `, until ${new Date(appt.holdExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.
                If it isn&apos;t booked by then it is released automatically.
              </p>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guests</p>
              {appt.participants
                .slice()
                .sort((a, b) => a.participantIndex - b.participantIndex)
                .map((p) => (
                  <div key={p.participantIndex} className="flex justify-between gap-3">
                    <span>{guestLabel(p)}</span>
                    <span className="text-muted-foreground">{p.therapist?.displayName ?? "No therapist"}</span>
                  </div>
                ))}
              <div className="flex justify-between gap-3 text-muted-foreground">
                <span>Room</span>
                <span>{appt.room?.name ?? "—"}</span>
              </div>
              {appt.apiBooking && (appt.apiBooking.guestEmail || appt.apiBooking.guestPhone) && (
                <div className="flex justify-between gap-3 text-muted-foreground">
                  <span>Contact</span>
                  <span className="truncate">{[appt.apiBooking.guestEmail, appt.apiBooking.guestPhone].filter(Boolean).join(" · ")}</span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</p>
              <div className="flex justify-between gap-3">
                <span>Price</span>
                <span className="tabular-nums">
                  {appt.priceSnapshot.toFixed(2)} {appt.currencySnapshot}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Status</span>
                <span className={appt.paymentStatus === "REFUND_REQUIRED" || appt.paymentStatus === "VOID_PENDING" ? "text-destructive" : ""}>
                  {PAYMENT_LABEL[appt.paymentStatus] ?? appt.paymentStatus}
                </span>
              </div>
              {appt.apiBooking?.paymentStatus === "PAID" && (
                <div className="flex justify-between gap-3 text-muted-foreground">
                  <span>Paid online</span>
                  <span>{[appt.apiBooking.paymentProvider, appt.apiBooking.paymentReference].filter(Boolean).join(" · ") || "Yes"}</span>
                </div>
              )}
              {appt.apiBooking?.amountMismatch && <p className="text-destructive">The website&apos;s paid amount differs from the total — check the payment.</p>}
            </div>

            {(appt.notes || appt.cancellationReasonCode) && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                {appt.cancellationReasonCode && (
                  <p>
                    Cancelled: {REASONS.find((r) => r.value === appt.cancellationReasonCode)?.label ?? appt.cancellationReasonCode}
                    {appt.cancellationNotes ? ` — ${appt.cancellationNotes}` : ""}
                  </p>
                )}
                {appt.notes && <p className="whitespace-pre-line text-muted-foreground">{appt.notes}</p>}
              </div>
            )}

            {mode === "view" && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4 max-md:hidden">
                {status === "CONFIRMED" && (
                  <Button size="sm" disabled={busy} onClick={() => act("check-in", {}, "Checked in")}>Check in</Button>
                )}
                {status === "CHECKED_IN" && (
                  <Button size="sm" disabled={busy} onClick={() => act("start", {}, "Treatment started")}>Start treatment</Button>
                )}
                {(status === "CHECKED_IN" || status === "IN_TREATMENT") && (
                  <Button size="sm" disabled={busy} onClick={() => act("complete", {}, "Completed")}>Complete</Button>
                )}
                {status === "CONFIRMED" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode("noshow")}>No-show</Button>
                )}
                {(status === "CONFIRMED" || status === "CHECKED_IN" || status === "IN_TREATMENT") && (
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setMode("cancel")}>
                    Cancel
                  </Button>
                )}
                {appt.folioId && (
                  <Button size="sm" variant="ghost" onClick={() => onOpenBill(appt.folioId!)}>Open bill</Button>
                )}
              </div>
            )}

            {mode === "cancel" && (
              <Form {...cancelForm}>
                <form
                  className="space-y-3 border-t border-border pt-4"
                  onSubmit={cancelForm.handleSubmit((v) => act("cancel", { reasonCode: v.reasonCode || null, notes: v.notes || null, waiveFee: v.waiveFee }, "Cancelled"))}
                >
                  <FormField control={cancelForm.control} name="reasonCode" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason{reasonRequired ? " *" : " (optional)"}</FormLabel>
                      <Select value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue>{REASONS.find((r) => r.value === field.value)?.label ?? "Choose a reason"}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={cancelForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Textarea rows={2} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={cancelForm.control} name="waiveFee" render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /></FormControl>
                      <FormLabel className="!mt-0 font-normal">Waive any late-cancellation fee (manager)</FormLabel>
                    </FormItem>
                  )} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" variant="destructive" disabled={busy}>Cancel appointment</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>Back</Button>
                  </div>
                </form>
              </Form>
            )}

            {mode === "noshow" && (
              <Form {...noShowForm}>
                <form
                  className="space-y-3 border-t border-border pt-4"
                  onSubmit={noShowForm.handleSubmit((v) => act("no-show", { waiveFee: v.waiveFee, notes: v.notes || null }, "Marked as no-show"))}
                >
                  <p className="text-muted-foreground">The spa&apos;s no-show fee applies unless a manager waives it.</p>
                  <FormField control={noShowForm.control} name="waiveFee" render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} /></FormControl>
                      <FormLabel className="!mt-0 font-normal">Waive the no-show fee (manager)</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={noShowForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Textarea rows={2} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={busy}>Mark no-show</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>Back</Button>
                  </div>
                </form>
              </Form>
            )}
          </div>
        )}

        {appt && !loading && mode === "view" && (nextStep || phoneMore.length > 0) && (
          <div className="sticky bottom-0 mt-auto border-t border-border bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
            <MobileActions
              primary={nextStep ? <Button disabled={busy} onClick={nextStep.run}>{nextStep.label}</Button> : undefined}
              more={phoneMore}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
