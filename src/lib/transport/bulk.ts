import { prisma } from "@/lib/db"
import { logActivity } from "@/lib/activity-log"
import { BookingError } from "@/lib/booking-error"
import { applyBookingStatus, bookingReference } from "@/lib/transport/bookings"
import { billingAction } from "@/lib/transport/billing"
import { assertTransportEnabled, forbidden, fromZod, invalid, type TransportActor } from "@/lib/transport/common"
import { bulkActionSchema } from "@/lib/transport/schemas"

// Board bulk actions: change status, assign an airport rep, confirm drafts, post charges.
// Each booking is handled on its own and reported back — one refusal (a cancelled booking,
// a missing price) never stops the rest.

export type BulkOutcome = { done: number; failed: { reference: string; guestName: string; error: string }[] }

export async function bulkAction(actor: TransportActor, propertyId: string, body: unknown, can: { manage: boolean }): Promise<BulkOutcome> {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = bulkActionSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const a = parsed.data
  const bookings = await prisma.transportBooking.findMany({
    where: { id: { in: a.bookingIds }, propertyId },
    include: { manifest: { select: { providerId: true } } },
  })
  if (bookings.length !== new Set(a.bookingIds).size) throw invalid("Some bookings were not found at this property", "NOT_FOUND")
  const out: BulkOutcome = { done: 0, failed: [] }
  const fail = (b: { id: string; guestName: string }, e: unknown) => {
    if (!(e instanceof BookingError)) throw e
    out.failed.push({ reference: bookingReference(b.id), guestName: b.guestName, error: e.message })
  }

  if (a.action === "POST") {
    if (!actor.canBill) throw forbidden("Posting transfer charges needs the Transportation billing permission")
    for (const b of bookings) {
      try {
        await billingAction(actor, propertyId, b.id, { action: "POST", mode: "FULL" })
        out.done++
      } catch (e) {
        fail(b, e)
      }
    }
    return out
  }

  if (!can.manage) throw forbidden("Missing create or update permission on TRANSPORTATION")

  if (a.action === "ASSIGN_REP") {
    if (a.airportRepUserId) {
      const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { enterpriseId: true } })
      const rep = await prisma.user.findFirst({
        where: { id: a.airportRepUserId, enterpriseId: property.enterpriseId, isActive: true, isSystem: false, OR: [{ scope: "ENTERPRISE" }, { propertyId }] },
        select: { firstName: true, lastName: true },
      })
      if (!rep) throw invalid("Airport rep not found at this property", "INVALID_REFERENCE")
    }
    const r = await prisma.transportBooking.updateMany({ where: { id: { in: bookings.map((b) => b.id) } }, data: { airportRepUserId: a.airportRepUserId } })
    out.done = r.count
  } else {
    const target = a.action === "CONFIRM_DRAFTS" ? "CONFIRMED" : a.status
    for (const b of bookings) {
      if (a.action === "CONFIRM_DRAFTS" && b.status !== "DRAFT") continue
      try {
        await prisma.$transaction((tx) => applyBookingStatus(tx, b, target, settings, a.action === "STATUS" ? a.reason : null))
        out.done++
      } catch (e) {
        fail(b, e)
      }
    }
  }

  if (out.done > 0) {
    await logActivity({
      ctx: actor.ctx,
      module: "TRANSPORTATION",
      action: "BULK_UPDATE",
      entityType: "TransportBooking",
      description: `Transportation bulk ${a.action === "ASSIGN_REP" ? "airport rep assignment" : a.action === "CONFIRM_DRAFTS" ? "confirmation of drafts" : `status → ${a.status}`}: ${out.done} booking(s)`,
      metadata: { propertyId, bookingIds: bookings.map((b) => bookingReference(b.id)), source: actor.source },
    })
  }
  return out
}
