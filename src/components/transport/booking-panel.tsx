"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Pencil, Receipt, Ban, RotateCcw, XCircle, UserX, CheckCircle2, Ship } from "@/components/icons"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ContactLink } from "@/components/ui/contact-link"
import { InlineLoading } from "@/components/ui/inline-loading"
import { OptionSelect } from "@/components/ui/option-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { MobileActions, type MobileAction } from "@/components/ui/mobile"
import { useConfirm, useReasonPrompt } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { DIRECTION_LABELS, PROVIDER_KIND_LABELS, label } from "@/lib/transport/constants"
import {
  api,
  AttentionBadge,
  BillingStatus,
  BookingStatus,
  GroupTag,
  ManifestStatus,
  dayLabel,
  money,
  paxLabel,
  type BookingView,
  type ManifestView,
  type TransportConfig,
} from "@/components/transport/shared"

// The side panel a booking opens into from the board, the airport/dispatch views and the
// reservation's Transportation card: every detail, then the actions — edit, put on a
// departure, status (confirm, complete, no-show, cancel, reinstate) and billing (post,
// custom fee, waive, void). Actions the user's role can't take are not shown.

export type TransportPerms = { manageBookings: boolean; manageManifests: boolean; canBill: boolean; canVoid: boolean }

function Row({ label: l, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || children === false) return null
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{l}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

const postSchema = z
  .object({
    mode: z.enum(["FULL", "CUSTOM"]),
    amount: z.string(),
    reason: z.string(),
    description: z.string().max(120),
    chargeCodeId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "CUSTOM") {
      if (!/^\d+(\.\d{1,2})?$/.test(v.amount) || Number(v.amount) <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount" })
      if (v.reason.trim().length < 3) ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason" })
    }
  })

function PostChargeDialog({
  open,
  onOpenChange,
  booking,
  config,
  propertyId,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  booking: BookingView
  config: TransportConfig | null
  propertyId: string
  onDone: (b: BookingView) => void
}) {
  const hasPrice = (booking.pricing.amount ?? 0) > 0 && !!booking.pricing.chargeCodeId
  const form = useForm<z.infer<typeof postSchema>>({ resolver: zodResolver(postSchema), mode: "onChange" })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (open) {
      setError(null)
      const penalty = booking.status === "NO_SHOW" || booking.status === "CANCELLED"
      form.reset({
        mode: hasPrice && !penalty ? "FULL" : "CUSTOM",
        amount: "",
        reason: booking.status === "NO_SHOW" ? "No-show" : booking.status === "CANCELLED" ? "Late cancellation" : "",
        description: penalty ? `Transfer ${booking.status === "NO_SHOW" ? "no-show" : "cancellation"} fee` : "",
        chargeCodeId: "",
      })
    }
  }, [open, booking, hasPrice, form])
  const mode = form.watch("mode")
  const submit = async (v: z.infer<typeof postSchema>) => {
    setPending(true)
    setError(null)
    try {
      const r = await api<{ booking: BookingView; posted: { grandTotal: number } }>(`/api/transport/bookings/${booking.id}/billing?propertyId=${propertyId}`, {
        method: "POST",
        json:
          v.mode === "FULL"
            ? { action: "POST", mode: "FULL", description: v.description || null }
            : { action: "POST", mode: "CUSTOM", amount: Number(v.amount), reason: v.reason.trim(), description: v.description || null, chargeCodeId: v.chargeCodeId || null },
      })
      toast.success(`Posted ${money(r.posted.grandTotal)} to the folio`)
      onOpenChange(false)
      onDone(r.booking)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <DialogHeader>
              <DialogTitle>Post charge</DialogTitle>
              <DialogDescription>Posts to {booking.reservation ? `${booking.reservation.confirmationNo}'s folio` : "the traveller's walk-in bill"} on today&apos;s business date.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Charge</FormLabel>
                    <FormControl>
                      <OptionSelect
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          ...(hasPrice ? [{ value: "FULL", label: `Full rate — ${money(booking.pricing.amount)}` }] : []),
                          { value: "CUSTOM", label: "Custom amount (fee or penalty)" },
                        ]}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              {mode === "CUSTOM" && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount $ *</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reason *</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="chargeCodeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Charge code</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="The transfer's own code"
                            options={[{ value: "", label: "The transfer's own code", group: "" }, ...chargeCodeOptions(config?.chargeCodes ?? [])]}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </>
              )}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Folio description</FormLabel>
                    <FormControl>
                      <Input placeholder="Transfer – Pickup (route)" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Post charge</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function BookingPanel({
  bookingId,
  onOpenChange,
  propertyId,
  config,
  perms,
  dayManifests,
  onChanged,
  onEdit,
  onOpenManifest,
}: {
  bookingId: string | null
  onOpenChange: (open: boolean) => void
  propertyId: string
  config: TransportConfig | null
  perms: TransportPerms
  /** Departures on the booking's day — for "Put on a departure". Loaded on demand if absent. */
  dayManifests?: ManifestView[]
  onChanged: () => void
  onEdit: (b: BookingView) => void
  onOpenManifest?: (id: string) => void
}) {
  const { slug } = useParams<{ slug: string }>()
  const confirm = useConfirm()
  const askReason = useReasonPrompt()
  const [booking, setBooking] = useState<BookingView | null>(null)
  const [manifests, setManifests] = useState<ManifestView[]>([])
  const [busy, setBusy] = useState(false)
  const [postOpen, setPostOpen] = useState(false)

  useEffect(() => {
    if (!bookingId) return
    setBooking(null)
    api<BookingView>(`/api/transport/bookings/${bookingId}?propertyId=${propertyId}`)
      .then(setBooking)
      .catch((e: Error) => toast.error(e.message))
  }, [bookingId, propertyId])

  useEffect(() => {
    if (!booking) return
    if (dayManifests) {
      setManifests(dayManifests.filter((m) => m.serviceDate === booking.serviceDate))
      return
    }
    api<ManifestView[]>(`/api/transport/manifests?propertyId=${propertyId}&from=${booking.serviceDate}&to=${booking.serviceDate}&direction=${booking.direction}`)
      .then(setManifests)
      .catch(() => setManifests([]))
  }, [booking, dayManifests, propertyId])

  const run = async (fn: () => Promise<{ booking?: BookingView; note?: string | null } | BookingView | ManifestView | unknown>, ok: string) => {
    setBusy(true)
    try {
      const r = (await fn()) as { booking?: BookingView; note?: string | null } | BookingView
      const next = "booking" in (r as object) ? (r as { booking: BookingView }).booking : (r as BookingView)
      if (next && "reference" in next) setBooking(next)
      else if (bookingId) setBooking(await api<BookingView>(`/api/transport/bookings/${bookingId}?propertyId=${propertyId}`))
      const note = (r as { note?: string | null }).note
      toast.success(note ? `${ok}. ${note}` : ok)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: string, needsReason = false) => {
    let reason: string | null = null
    if (needsReason) {
      reason = await askReason({ title: status === "CANCELLED" ? "Cancel this transfer?" : "Mark as no-show?", reasonLabel: "Reason", required: status === "CANCELLED", destructive: true, confirmLabel: status === "CANCELLED" ? "Cancel transfer" : "Mark no-show" })
      if (reason === null) return
    }
    await run(() => api(`/api/transport/bookings/${booking!.id}/status?propertyId=${propertyId}`, { method: "POST", json: { status, reason } }), "Status updated")
  }

  const billing = async (action: "WAIVE" | "RESUME" | "VOID") => {
    let reason: string | null = null
    if (action !== "RESUME") {
      reason = await askReason({
        title: action === "WAIVE" ? "Waive this transfer charge?" : "Void the posted charge?",
        description: action === "VOID" ? "The line stays on the folio, marked void, with your reason — the standard folio correction." : "Night Audit won't post it.",
        reasonLabel: "Reason",
        destructive: action === "VOID",
        confirmLabel: action === "WAIVE" ? "Waive" : "Void charge",
      })
      if (reason === null) return
    }
    await run(
      () => api(`/api/transport/bookings/${booking!.id}/billing?propertyId=${propertyId}`, { method: "POST", json: { action, ...(reason ? { reason } : {}) } }),
      action === "WAIVE" ? "Charge waived" : action === "VOID" ? "Charge voided" : "Billing restored"
    )
  }

  const putOn = async (manifestId: string) => {
    if (!manifestId) {
      if (!booking?.manifest) return
      await run(() => api(`/api/transport/manifests/${booking.manifest!.id}/bookings?propertyId=${propertyId}`, { method: "POST", json: { action: "DETACH", bookingIds: [booking.id] } }), "Removed from the departure")
      return
    }
    await run(() => api(`/api/transport/manifests/${manifestId}/bookings?propertyId=${propertyId}`, { method: "POST", json: { action: "ATTACH", bookingIds: [booking!.id] } }), "Added to the departure")
  }

  const b = booking
  const st = b?.status
  const bill = b?.billing.status
  const statusActions: MobileAction[] = []
  if (b && perms.manageBookings) {
    if (st === "DRAFT") statusActions.push({ label: "Confirm", icon: CheckCircle2, onSelect: () => setStatus("CONFIRMED") })
    if (st === "CONFIRMED" || st === "ASSIGNED") statusActions.push({ label: "Mark completed", icon: CheckCircle2, onSelect: () => setStatus("COMPLETED") })
    if (st === "NO_SHOW" || st === "COMPLETED" || st === "CANCELLED") statusActions.push({ label: st === "CANCELLED" ? "Reinstate" : "Back to confirmed", icon: RotateCcw, onSelect: () => setStatus("CONFIRMED") })
    if (st === "CONFIRMED" || st === "ASSIGNED") statusActions.push({ label: "Mark no-show", icon: UserX, onSelect: () => setStatus("NO_SHOW", true), destructive: true })
    if (st && st !== "CANCELLED" && st !== "COMPLETED") statusActions.push({ label: "Cancel transfer", icon: XCircle, onSelect: () => setStatus("CANCELLED", true), destructive: true })
  }
  const billingActions: MobileAction[] = []
  if (b && perms.canBill && st !== "DRAFT" && bill !== "POSTED") billingActions.push({ label: "Post charge", icon: Receipt, onSelect: () => setPostOpen(true) })
  if (b && perms.canBill && (bill === "NOT_BILLED" || bill === "PENDING")) billingActions.push({ label: "Waive charge", icon: Ban, onSelect: () => billing("WAIVE") })
  if (b && perms.canBill && bill === "WAIVED") billingActions.push({ label: "Bill again", icon: RotateCcw, onSelect: () => billing("RESUME") })
  if (b && perms.canVoid && bill === "POSTED") billingActions.push({ label: "Void charge", icon: XCircle, onSelect: () => billing("VOID"), destructive: true })

  const manifestOptions = manifests
    .filter((m) => m.direction === b?.direction && m.status !== "CANCELLED" && m.status !== "COMPLETED")
    .map((m) => ({ value: m.id, label: `${m.departureLocal.time} · ${m.route.name} · ${m.pax}${m.capacity ? `/${m.capacity}` : ""} pax` }))

  return (
    <Sheet open={!!bookingId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
            {b ? b.guestName : "Transfer"}
            {b && <BookingStatus status={b.status} />}
            {b && <GroupTag group={b.groupBlock} />}
          </SheetTitle>
          <SheetDescription>
            {b ? `${b.reference} · ${label(DIRECTION_LABELS, b.direction)} · ${dayLabel(b.serviceDate, { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {!b ? (
          <div className="p-4">
            <InlineLoading />
          </div>
        ) : (
          <div className="space-y-5 px-4 pb-6">
            {b.attention.length > 0 && (
              <div className="border border-warning/40 bg-warning-muted p-3 text-sm text-warning" role="status">
                <AttentionBadge reasons={b.attention} />
                <ul className="mt-2 list-disc pl-5">
                  {b.attention.map((a, i) => (
                    <li key={i}>{a.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Primary actions: one main, the rest behind More on phones; a row on desktop. */}
            <div className="flex flex-wrap gap-2 max-md:hidden">
              {perms.manageBookings && b.status !== "CANCELLED" && (
                <Button variant="outline" size="sm" onClick={() => onEdit(b)} disabled={busy}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Edit
                </Button>
              )}
              {[...statusActions, ...billingActions].map((a) => (
                <Button key={a.label} variant="outline" size="sm" onClick={a.onSelect} disabled={busy} className={a.destructive ? "text-destructive hover:text-destructive" : undefined}>
                  {a.icon && <a.icon className="mr-1.5 h-4 w-4" />} {a.label}
                </Button>
              ))}
            </div>
            <MobileActions
              className="md:hidden"
              primary={
                perms.manageBookings && b.status !== "CANCELLED" ? (
                  <Button variant="outline" className="h-11" onClick={() => onEdit(b)} disabled={busy}>
                    <Pencil className="mr-1.5 h-4 w-4" /> Edit
                  </Button>
                ) : undefined
              }
              more={[...statusActions, ...billingActions]}
            />

            <dl className="divide-y divide-border">
              <Row label="Passengers">{`${b.pax} (${paxLabel(b)})`}</Row>
              <Row label="Reservation">
                {b.reservation ? (
                  <Link className="underline-offset-2 hover:underline" href={`/e/${slug}/dashboard/reservations/${b.reservation.id}`}>
                    {b.reservation.confirmationNo}
                    {b.reservation.roomNumber ? ` · Room ${b.reservation.roomNumber}` : ""}
                  </Link>
                ) : (
                  "No stay — billed on a walk-in bill"
                )}
              </Row>
              <Row label="Contact">{b.guestContact && <ContactLink type="phone" value={b.guestContact} showIcon />}</Row>
            </dl>

            {(b.needsFlight || b.flightNo) && (
              <section>
                <h3 className="mb-1 text-sm font-medium">Airport</h3>
                <dl className="divide-y divide-border">
                  <Row label={b.direction === "PICKUP" ? "Arrives" : "Departs"}>
                    {b.flightNo || b.flightLocal ? (
                      <span>
                        <span className="font-mono font-medium">{b.flightNo ?? "—"}</span>
                        {b.airline ? ` ${b.airline}` : ""}
                        {b.flightLocal ? ` · ${b.flightLocal.time}${b.flightLocal.dateKey !== b.serviceDate ? ` (${dayLabel(b.flightLocal.dateKey)})` : ""}` : ""}
                        {b.terminal ? ` · ${b.terminal}` : ""}
                      </span>
                    ) : (
                      <span className="text-warning">Flight details missing</span>
                    )}
                  </Row>
                  <Row label="Airport rep">{b.airportRep?.name ?? <span className="text-muted-foreground">Not assigned</span>}</Row>
                  <Row label="Meeting / luggage">{b.meetingNotes}</Row>
                </dl>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-sm font-medium">Transfer</h3>
              <dl className="divide-y divide-border">
                <Row label="Route">{b.route ? `${b.route.name} (${b.route.from.code} → ${b.route.to.code})` : <span className="text-muted-foreground">No route yet</span>}</Row>
                <Row label="Transport">{b.transportType?.name}</Row>
                <Row label="Departure">
                  {b.manifest ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => onOpenManifest?.(b.manifest!.id)}>
                        {b.manifest.departureLocal.time}
                      </button>
                      <ManifestStatus status={b.manifest.status} />
                    </span>
                  ) : b.departureLocal ? (
                    `${b.departureLocal.time} (not on a departure yet)`
                  ) : (
                    <span className="text-muted-foreground">Not scheduled</span>
                  )}
                </Row>
                <Row label="Provider">{b.provider ? `${b.provider.name} · ${label(PROVIDER_KIND_LABELS, b.provider.kind)}` : null}</Row>
                <Row label="Vessel">{b.vessel ? `${b.vessel.name} (${b.vessel.capacity} seats)` : null}</Row>
                <Row label="Driver / captain">
                  {b.driverName || b.driverContact ? (
                    <span>
                      {b.driverName} {b.driverContact && <ContactLink type="phone" value={b.driverContact} />}
                    </span>
                  ) : null}
                </Row>
                <Row label="Seat / ref.">{b.seatNote}</Row>
                <Row label="Instructions">{b.route?.instructions}</Row>
                <Row label="Notes">{b.notes}</Row>
              </dl>
              {perms.manageManifests && b.status !== "CANCELLED" && (
                <div className="mt-3 grid gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    <Ship className="mr-1 inline h-3.5 w-3.5" /> Departure
                  </span>
                  <OptionSelect
                    value={b.manifest?.id ?? ""}
                    onChange={putOn}
                    disabled={busy}
                    options={[{ value: "", label: b.manifest ? "Remove from the departure" : "Not on a departure" }, ...manifestOptions]}
                  />
                </div>
              )}
            </section>

            <Separator />
            <section>
              <h3 className="mb-1 text-sm font-medium">Billing</h3>
              <dl className="divide-y divide-border">
                <Row label="Price">
                  {b.pricing.amount == null ? (
                    "Complimentary"
                  ) : (
                    <span>
                      <span className="font-mono">{money(b.pricing.amount)}</span>
                      {b.pricing.priceOverridden && <span className="text-muted-foreground"> · set by hand: {b.pricing.overrideReason}</span>}
                    </span>
                  )}
                </Row>
                <Row label="Status">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <BillingStatus status={b.billing.status} />
                    {b.billing.postedGross != null && b.billing.status === "POSTED" && <span className="font-mono text-sm">{money(b.billing.postedGross)} on the folio</span>}
                  </span>
                </Row>
                <Row label="Note">{b.billing.note}</Row>
                <Row label="When">
                  {b.billing.status === "NOT_BILLED"
                    ? b.direction === "PICKUP"
                      ? "Night Audit posts it on the arrival day"
                      : "Night Audit posts it on the guest's last night, dated the departure day"
                    : null}
                </Row>
              </dl>
            </section>

            {b.status === "CANCELLED" && b.cancellationReason && <p className="text-sm text-muted-foreground">Cancelled: {b.cancellationReason}</p>}
          </div>
        )}
        {b && <PostChargeDialog open={postOpen} onOpenChange={setPostOpen} booking={b} config={config} propertyId={propertyId} onDone={(nb) => { setBooking(nb); onChanged() }} />}
      </SheetContent>
    </Sheet>
  )
}
