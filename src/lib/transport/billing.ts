import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { logActivity } from "@/lib/activity-log"
import { BookingError } from "@/lib/booking-error"
import { ensureOpenShift } from "@/lib/cashier-shift"
import { chargeCodeInclude, postCharge, type PostingTaxSettings } from "@/lib/posting/post-charge"
import { voidPostedCharge, actorDisplayName } from "@/lib/posting/void-charge"
import { getPropertySettings } from "@/lib/property-settings"
import { resolveBusinessDate } from "@/lib/business-date"
import { bookingReference, getBooking } from "@/lib/transport/bookings"
import { assertTransportEnabled, forbidden, fromZod, invalid, notFound, type TransportActor } from "@/lib/transport/common"
import { ensureTransportChargeCode } from "@/lib/transport/config"
import { POSTABLE_BOOKING_STATUSES } from "@/lib/transport/constants"
import { taxOverrideFor } from "@/lib/transport/pricing"
import { billingActionSchema } from "@/lib/transport/schemas"
import { dateToKey } from "@/lib/transport/time"

// Transport billing (section 5 of the brief). Everything posts through postCharge — the same
// engine as every folio line — with the booking's snapshotted charge code and tax mode, and
// every correction goes through the shared void helper, never a delete.
//
// Idempotency: one posting per booking. TransportBooking.folioLineItemId is unique and
// Night Audit only picks up bookings with no line and billingStatus NOT_BILLED/PENDING, so a
// re-run, a retried audit or an Advance Bill can never post the same transfer twice.
//
// When Night Audit posts (owner rule, see TRANSPORTATION_PLAN.md "Billing"):
//   PICKUP    at the audit of the arrival day (the service date), once the guest is in house.
//   DROP_OFF  at the audit of the guest's LAST NIGHT, stamped with the departure day — so the
//             charge is on the folio when the guest settles at check-out the next morning.
//             A drop-off for a guest no longer in house, or a standalone traveller, posts at
//             the audit of the service date itself.
//   Missed days are caught up at the next audit. Drafts, no-shows and cancellations never
//   post automatically — the desk posts a fee for those by hand ("Post charge").

type Tx = Prisma.TransactionClient

const BILLABLE_OPEN = ["NOT_BILLED", "PENDING"]

type BookingForPosting = {
  id: string
  propertyId: string
  reservationId: string | null
  folioId: string | null
  guestName: string
  guestContact: string | null
  direction: string
  serviceDate: Date
  flightNo: string | null
  chargeCodeId: string | null
  taxMode: string
  taxProfileId: string | null
  route: { name: string } | null
}

/** Where a transfer charge lands: the reservation's bill (group master / routing rule
 *  first, as Night Audit routes room charges), or the standalone guest's walk-in folio. */
async function targetFolio(tx: Tx, b: BookingForPosting, chargeCodeId: string): Promise<{ folioId: string } | { pending: string }> {
  if (b.reservationId) {
    const r = await tx.reservation.findUniqueOrThrow({
      where: { id: b.reservationId },
      select: { groupBlockId: true, groupBillToMaster: true, folios: { where: { isClosed: false }, orderBy: { folioNumber: "asc" }, select: { id: true } } },
    })
    const rule = await tx.folioRoutingRule.findFirst({
      where: { reservationId: b.reservationId, chargeCodeId, targetFolio: { isClosed: false } },
      select: { targetFolioId: true },
    })
    if (rule) return { folioId: rule.targetFolioId }
    if (r.groupBlockId && r.groupBillToMaster) {
      const master = await tx.folio.findFirst({ where: { groupBlockId: r.groupBlockId, isMaster: true, isClosed: false }, select: { id: true } })
      if (master) return { folioId: master.id }
    }
    if (r.folios[0]) return { folioId: r.folios[0].id }
    return { pending: "The reservation has no open folio" }
  }
  // Standalone traveller: the walk-in bill opened for them (a fresh one if theirs was settled
  // and closed) — the same non-reservation billing Excursions and Fast Post use.
  if (b.folioId) {
    const f = await tx.folio.findUnique({ where: { id: b.folioId }, select: { isClosed: true } })
    if (f && !f.isClosed) return { folioId: b.folioId }
  }
  const folio = await tx.folio.create({
    data: { propertyId: b.propertyId, folioNumber: 1, walkInGuestName: b.guestName, walkInGuestContact: b.guestContact },
  })
  await tx.transportBooking.update({ where: { id: b.id }, data: { folioId: folio.id } })
  return { folioId: folio.id }
}

export function transferDescription(b: { direction: string; route: { name: string } | null }) {
  return `Transfer – ${b.direction === "PICKUP" ? "Pickup" : "Drop-off"}${b.route ? ` (${b.route.name})` : ""}`
}

async function postOne(
  tx: Tx,
  b: BookingForPosting,
  p: {
    amount: number
    chargeCodeId: string
    taxMode: string
    taxProfileId: string | null
    date: Date
    description?: string | null
    shiftId?: string | null
    settings: PostingTaxSettings
    pricesIncludeTaxes: boolean
  }
) {
  const target = await targetFolio(tx, b, p.chargeCodeId)
  if ("pending" in target) return target
  const code = await tx.chargeCode.findFirst({ where: { id: p.chargeCodeId, propertyId: b.propertyId }, include: chargeCodeInclude() })
  if (!code) return { pending: "The charge code no longer exists" }
  const taxProfile =
    p.taxMode === "CUSTOM" && p.taxProfileId
      ? await tx.taxProfile.findFirst({ where: { id: p.taxProfileId, propertyId: b.propertyId }, include: { rates: true } })
      : null
  const posted = await postCharge(tx, {
    folioId: target.folioId,
    chargeCode: code,
    inputAmount: p.amount,
    settings: p.settings,
    pricesIncludeTaxes: p.pricesIncludeTaxes,
    date: p.date,
    description: p.description?.trim() || transferDescription(b),
    reference: b.flightNo ?? bookingReference(b.id),
    outlet: taxOverrideFor(p.taxMode, taxProfile),
    shiftId: p.shiftId ?? null,
    propertyId: b.propertyId,
  })
  return { posted, folioId: target.folioId }
}

const POSTING_SELECT = {
  id: true,
  propertyId: true,
  reservationId: true,
  folioId: true,
  guestName: true,
  guestContact: true,
  direction: true,
  serviceDate: true,
  flightNo: true,
  chargeCodeId: true,
  taxMode: true,
  taxProfileId: true,
  amount: true,
  status: true,
  billingStatus: true,
  folioLineItemId: true,
  route: { select: { name: true } },
} as const

// ── Night Audit ────────────────────────────────────────────────────────────────────────

export type TransportAuditResult = { posted: number; taxPosted: number; postings: number; pending: { reference: string; guestName: string; reason: string }[] }

/**
 * Night Audit's transport pass — runs inside the audit transaction, so a failed audit rolls
 * these postings back with everything else. Does nothing at a property with the module off.
 */
export async function postDueTransportCharges(
  tx: Tx,
  input: { propertyId: string; auditDate: Date; settings: PostingTaxSettings; pricesIncludeTaxes: boolean }
): Promise<TransportAuditResult> {
  const result: TransportAuditResult = { posted: 0, taxPosted: 0, postings: 0, pending: [] }
  const enabled = await tx.transportSettings.findUnique({ where: { propertyId: input.propertyId }, select: { enabled: true } })
  if (!enabled?.enabled) return result

  const day = 86_400_000
  const audit = input.auditDate.getTime()
  const dayAfter = new Date(audit + day)
  const candidates = await tx.transportBooking.findMany({
    where: {
      propertyId: input.propertyId,
      status: { in: POSTABLE_BOOKING_STATUSES },
      billingStatus: { in: BILLABLE_OPEN },
      folioLineItemId: null,
      amount: { gt: 0 },
      chargeCodeId: { not: null },
      // Up to tomorrow: a drop-off on tomorrow's departure posts tonight (the last night).
      serviceDate: { lte: dayAfter },
    },
    select: { ...POSTING_SELECT, reservation: { select: { status: true, checkOutDate: true } } },
    orderBy: [{ serviceDate: "asc" }, { id: "asc" }],
  })

  for (const b of candidates) {
    const svc = b.serviceDate.getTime()
    const r = b.reservation
    if (r) {
      // Only a guest who actually arrived is charged automatically (a no-show's pickup is
      // not a transfer that happened). Checked-out guests are caught up if a day was missed.
      if (r.status !== "IN_HOUSE" && r.status !== "CHECKED_OUT") continue
      const lastNightDropOff = b.direction === "DROP_OFF" && r.status === "IN_HOUSE" && svc === audit + day
      if (svc > audit && !lastNightDropOff) continue
    } else if (svc > audit) {
      continue
    }
    // Stamped with the transfer's own day when posted ahead (the last-night drop-off),
    // otherwise with the business date being audited — never back-dated.
    const date = svc > audit ? b.serviceDate : input.auditDate
    const res = await postOne(tx, b, {
      amount: b.amount!,
      chargeCodeId: b.chargeCodeId!,
      taxMode: b.taxMode,
      taxProfileId: b.taxProfileId,
      date,
      settings: input.settings,
      pricesIncludeTaxes: input.pricesIncludeTaxes,
    })
    if ("pending" in res) {
      await tx.transportBooking.update({ where: { id: b.id }, data: { billingStatus: "PENDING", billingNote: res.pending } })
      result.pending.push({ reference: bookingReference(b.id), guestName: b.guestName, reason: res.pending })
      continue
    }
    await tx.transportBooking.update({
      where: { id: b.id },
      data: { billingStatus: "POSTED", folioLineItemId: res.posted.parent.id, postedAt: new Date(), billingNote: null },
    })
    result.posted += 1
    result.taxPosted += res.posted.taxTotal + res.posted.leviesTotal
    result.postings += 1 + res.posted.generated.length
  }
  return result
}

/**
 * Advance Bill: post every still-open billable transfer of the reservation now, alongside
 * the stay, so the settled bill is complete and Night Audit has nothing left to add.
 */
export async function postReservationTransportNow(
  tx: Tx,
  input: { reservationId: string; date: Date; settings: PostingTaxSettings; pricesIncludeTaxes: boolean }
) {
  const bookings = await tx.transportBooking.findMany({
    where: {
      reservationId: input.reservationId,
      status: { in: POSTABLE_BOOKING_STATUSES },
      billingStatus: { in: BILLABLE_OPEN },
      folioLineItemId: null,
      amount: { gt: 0 },
      chargeCodeId: { not: null },
    },
    select: POSTING_SELECT,
  })
  let grandTotal = 0
  let lines = 0
  for (const b of bookings) {
    const res = await postOne(tx, b, {
      amount: b.amount!,
      chargeCodeId: b.chargeCodeId!,
      taxMode: b.taxMode,
      taxProfileId: b.taxProfileId,
      date: input.date,
      description: `Advance — ${transferDescription(b)}`,
      settings: input.settings,
      pricesIncludeTaxes: input.pricesIncludeTaxes,
    })
    if ("pending" in res) continue
    await tx.transportBooking.update({
      where: { id: b.id },
      data: { billingStatus: "POSTED", folioLineItemId: res.posted.parent.id, postedAt: new Date(), billingNote: "Posted by Advance Bill" },
    })
    grandTotal += res.posted.grandTotal
    lines += 1 + res.posted.generated.length
  }
  return { grandTotal, lines }
}

// ── Manual billing (the desk and the API) ──────────────────────────────────────────────

export async function billingAction(actor: TransportActor, propertyId: string, id: string, body: unknown) {
  await assertTransportEnabled(propertyId)
  const parsed = billingActionSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const a = parsed.data
  const b = await prisma.transportBooking.findFirst({
    where: { id, propertyId },
    select: { ...POSTING_SELECT, folioLineItem: { select: { id: true, isVoid: true, folio: { select: { isClosed: true } } } } },
  })
  if (!b) throw notFound("Transport booking")
  const status = b.billingStatus === "POSTED" && b.folioLineItem?.isVoid ? "VOIDED" : b.billingStatus

  if (a.action === "VOID") {
    if (!actor.canVoid) throw forbidden("Voiding a posted charge needs Cashiering update permission")
    if (status !== "POSTED" || !b.folioLineItem) throw invalid("There is no posted charge to void.", "NOT_POSTED")
    if (b.folioLineItem.folio.isClosed) throw invalid("The folio is closed — handle this as a refund or adjustment on the folio.", "FOLIO_CLOSED")
    await prisma.$transaction(async (tx) => {
      await voidPostedCharge(tx, { lineItemId: b.folioLineItem!.id, reason: a.reason, actorName: await actorDisplayName(tx, actor.userId) })
      await tx.transportBooking.update({ where: { id }, data: { billingStatus: "VOIDED", billingNote: a.reason } })
    })
    await logActivity({
      ctx: actor.ctx,
      module: "CASHIERING",
      action: "VOID",
      entityType: "TransportBooking",
      entityId: id,
      description: `Voided the transfer charge of ${bookingReference(id)} (${b.guestName}) — ${a.reason}`,
      metadata: { propertyId, folioLineItemId: b.folioLineItem.id, source: actor.source },
    })
    return { booking: await getBooking(propertyId, id) }
  }

  if (!actor.canBill) throw forbidden("Posting or waiving a transfer charge needs the Transportation billing permission")

  if (a.action === "WAIVE") {
    if (status === "POSTED") throw invalid("The charge is already posted — void it instead.", "ALREADY_POSTED")
    await prisma.transportBooking.update({ where: { id }, data: { billingStatus: "WAIVED", billingNote: a.reason } })
    await logActivity({
      ctx: actor.ctx,
      module: "TRANSPORTATION",
      action: "WAIVE",
      entityType: "TransportBooking",
      entityId: id,
      description: `Waived the transfer charge of ${bookingReference(id)} (${b.guestName}) — ${a.reason}`,
      metadata: { propertyId, amount: b.amount, source: actor.source },
    })
    return { booking: await getBooking(propertyId, id) }
  }

  if (a.action === "RESUME") {
    if (status !== "WAIVED") throw invalid("Only a waived charge can be billed again.", "NOT_WAIVED")
    await prisma.transportBooking.update({
      where: { id },
      data: { billingStatus: b.amount && b.amount > 0 && b.chargeCodeId ? "NOT_BILLED" : "NON_BILLABLE", billingNote: null },
    })
    await logActivity({
      ctx: actor.ctx,
      module: "TRANSPORTATION",
      action: "UPDATE",
      entityType: "TransportBooking",
      entityId: id,
      description: `Billing restored for ${bookingReference(id)} (${b.guestName}) — Night Audit will post it`,
      metadata: { propertyId, source: actor.source },
    })
    return { booking: await getBooking(propertyId, id) }
  }

  // POST — full rate or a custom amount (a penalty for a no-show or late cancellation, say).
  if (status === "POSTED") throw invalid("This transfer is already charged. Void the charge first to post it again.", "ALREADY_POSTED")
  if (b.status === "DRAFT") throw invalid("Confirm the booking before charging it.", "BOOKING_DRAFT")
  let amount: number
  let chargeCodeId: string | null = b.chargeCodeId
  let taxMode = b.taxMode
  let taxProfileId = b.taxProfileId
  let note: string | null = null
  if (a.mode === "FULL") {
    if (!b.amount || b.amount <= 0 || !b.chargeCodeId) throw invalid("This transfer has no price — post a custom amount instead.", "NO_PRICE")
    amount = b.amount
  } else {
    amount = a.amount!
    note = a.reason!
    if (a.chargeCodeId && a.chargeCodeId !== b.chargeCodeId) {
      const code = await prisma.chargeCode.findFirst({ where: { id: a.chargeCodeId, propertyId, postingType: "CHARGE" }, select: { id: true } })
      if (!code) throw invalid("Charge code not found at this property", "INVALID_REFERENCE")
      chargeCodeId = code.id
      // A different code (a penalty code, say) is taxed as that code says.
      taxMode = "CHARGE_CODE"
      taxProfileId = null
    }
    if (!chargeCodeId) {
      const settings = await prisma.transportSettings.findUnique({ where: { propertyId }, select: { defaultChargeCodeId: true } })
      chargeCodeId = settings?.defaultChargeCodeId ?? (await ensureTransportChargeCode(propertyId)).id
    }
  }

  const [settings, property] = await Promise.all([
    getPropertySettings(propertyId),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { pricesIncludeTaxes: true, businessDate: true } }),
  ])
  const shift = await ensureOpenShift(actor.ctx, propertyId)
  const res = await prisma.$transaction(async (tx) => {
    const r = await postOne(tx, b, {
      amount,
      chargeCodeId: chargeCodeId!,
      taxMode,
      taxProfileId,
      date: resolveBusinessDate(property),
      description: a.description,
      shiftId: shift.id,
      settings,
      pricesIncludeTaxes: property.pricesIncludeTaxes,
    })
    if ("pending" in r) throw new BookingError(409, "NO_OPEN_FOLIO", `${r.pending}. Open a folio for the reservation first.`)
    await tx.transportBooking.update({
      where: { id },
      data: { billingStatus: "POSTED", folioLineItemId: r.posted.parent.id, postedAt: new Date(), billingNote: note },
    })
    return r
  })
  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: "POST_CHARGE",
    entityType: "TransportBooking",
    entityId: id,
    description: `Posted ${a.mode === "FULL" ? "the transfer charge" : `a custom transfer charge (${note})`} for ${bookingReference(id)} (${b.guestName}): ${res.posted.grandTotal.toFixed(2)} on ${dateToKey(resolveBusinessDate(property))}`,
    metadata: { propertyId, amount, chargeCodeId, folioId: res.folioId, folioLineItemId: res.posted.parent.id, source: actor.source },
  })
  return { booking: await getBooking(propertyId, id), posted: { grandTotal: res.posted.grandTotal, folioId: res.folioId } }
}
