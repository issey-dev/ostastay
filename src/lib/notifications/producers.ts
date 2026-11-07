import { prisma } from "@/lib/db"
import { notify } from "./notify"

// The events that raise notifications today (NOTIFICATIONS_PLAN.md, phase N1). Each is a
// small function so the call site is one line and the wording lives here. Every one is
// safe to call twice (a dedupeKey), never throws (notify() guarantees it), and keeps guest
// names and amounts OUT of the text — it may reach a phone's lock screen later.

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })

async function whereIs(propertyId: string) {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, enterprise: { select: { slug: true } } } })
  return p ? { name: p.name, slug: p.enterprise.slug } : null
}

/** The business date moved on — tell everyone at the property. */
export async function notifyBusinessDateRolled(a: { enterpriseId: string; propertyId: string; newDate: Date; actorUserId?: string }) {
  try {
    const where = await whereIs(a.propertyId)
    if (!where) return
    await notify({
      type: "BUSINESS_DATE_ROLLED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: `Business date is now ${dayLabel(a.newDate)}`,
      body: where.name,
      url: `/e/${where.slug}/dashboard/financials/night-audit`,
      entityType: "Property",
      entityId: a.propertyId,
      dedupeKey: `BUSINESS_DATE_ROLLED:${a.propertyId}:${ymd(a.newDate)}`,
      audience: {},
      excludeUserId: a.actorUserId,
    })
  } catch (e) {
    console.error("[notifications] business date roll", e)
  }
}

/** A scheduled Night Audit stopped, failed or fell behind — tell the people who run Night Audit. */
export async function notifyNightAuditFailed(a: { enterpriseId: string; propertyId: string; businessDate: Date; detail: string }) {
  try {
    const where = await whereIs(a.propertyId)
    if (!where) return
    await notify({
      type: "NIGHT_AUDIT_FAILED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: "Night Audit did not finish",
      body: `${where.name}: ${a.detail}`.slice(0, 300),
      url: `/e/${where.slug}/dashboard/financials/night-audit`,
      entityType: "Property",
      entityId: a.propertyId,
      // One alert per property per business date, however often the scheduler retries.
      dedupeKey: `NIGHT_AUDIT_FAILED:${a.propertyId}:${ymd(a.businessDate)}`,
      audience: { need: { module: "NIGHT_AUDIT" } },
    })
  } catch (e) {
    console.error("[notifications] night audit failure", e)
  }
}

/** A channel booking became a reservation — tell the people who take reservations. */
export async function notifyChannelBookingReceived(a: { enterpriseId: string; propertyId: string; reservationId: string; channelName: string | null }) {
  try {
    const where = await whereIs(a.propertyId)
    if (!where) return
    await notify({
      type: "CHANNEL_BOOKING_RECEIVED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: `New online booking${a.channelName ? ` from ${a.channelName}` : ""}`,
      body: where.name,
      url: `/e/${where.slug}/dashboard/reservations/${a.reservationId}`,
      entityType: "Reservation",
      entityId: a.reservationId,
      dedupeKey: `CHANNEL_BOOKING_RECEIVED:${a.reservationId}`,
      audience: { need: { module: "RESERVATIONS", action: "create" } },
    })
  } catch (e) {
    console.error("[notifications] channel booking", e)
  }
}

/** A channel booking could not be turned into a reservation — it needs a person. */
export async function notifyChannelBookingFailed(a: { enterpriseId: string; propertyId: string | null; inboundBookingId: string; reason: string }) {
  try {
    const where = a.propertyId ? await whereIs(a.propertyId) : null
    await notify({
      type: "CHANNEL_BOOKING_FAILED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: "An online booking could not be added",
      body: `${where ? `${where.name}: ` : ""}${a.reason}`.slice(0, 300),
      url: where ? `/e/${where.slug}/hub` : undefined,
      entityType: "ChannelInboundBooking",
      entityId: a.inboundBookingId,
      dedupeKey: `CHANNEL_BOOKING_FAILED:${a.inboundBookingId}`,
      audience: { need: { module: "RESERVATIONS", action: "create" } },
    })
  } catch (e) {
    console.error("[notifications] channel booking failure", e)
  }
}

/** A channel-manager connection just broke — tell the people who manage integrations. */
export async function notifyChannelConnectionFailed(a: { enterpriseId: string; connectionId: string; connectionName: string }) {
  try {
    const ent = await prisma.enterprise.findUnique({ where: { id: a.enterpriseId }, select: { slug: true } })
    if (!ent) return
    await notify({
      type: "CHANNEL_CONNECTION_FAILED",
      enterpriseId: a.enterpriseId,
      propertyId: null,
      title: "A channel connection stopped working",
      body: a.connectionName,
      url: `/e/${ent.slug}/hub`,
      entityType: "ChannelConnection",
      entityId: a.connectionId,
      // The caller only fires on a connection that JUST broke; the hour keeps a flapping one quiet.
      dedupeKey: `CHANNEL_CONNECTION_FAILED:${a.connectionId}:${new Date().toISOString().slice(0, 13)}`,
      audience: { need: { module: "INTEGRATIONS" } },
    })
  } catch (e) {
    console.error("[notifications] channel connection failure", e)
  }
}

/** A maintenance task was assigned to someone — tell them (personal). */
export async function notifyTaskAssigned(a: { enterpriseId: string; propertyId: string; assigneeId: string; actorUserId: string; taskId: string; roomNumber: string }) {
  try {
    const where = await whereIs(a.propertyId)
    if (!where) return
    await notify({
      type: "TASK_ASSIGNED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: "A maintenance task was assigned to you",
      body: `${where.name}: room ${a.roomNumber}`,
      url: `/e/${where.slug}/dashboard/maintenance`,
      entityType: "RoomMaintenance",
      entityId: a.taskId,
      // Giving the same person the task again after someone else had it is a new assignment;
      // the minute only stops a double click.
      dedupeKey: `TASK_ASSIGNED:${a.taskId}:${a.assigneeId}:${new Date().toISOString().slice(0, 16)}`,
      audience: { userIds: [a.assigneeId] },
      excludeUserId: a.actorUserId,
      createdByUserId: a.actorUserId,
    })
  } catch (e) {
    console.error("[notifications] task assigned", e)
  }
}

/** Someone signed in from a browser or device this account has not used before — tell the account's owner (personal). */
export async function notifyNewDeviceSignIn(a: { enterpriseId: string; userId: string; device: string }) {
  try {
    const ent = await prisma.enterprise.findUnique({ where: { id: a.enterpriseId }, select: { slug: true } })
    await notify({
      type: "NEW_DEVICE_SIGN_IN",
      enterpriseId: a.enterpriseId,
      propertyId: null,
      title: "New sign-in to your account",
      body: `${a.device}. If this was not you, tell your administrator.`,
      url: ent ? `/e/${ent.slug}/dashboard/notifications` : undefined,
      dedupeKey: `NEW_DEVICE_SIGN_IN:${a.userId}:${a.device}:${new Date().toISOString().slice(0, 13)}`,
      audience: { userIds: [a.userId] },
    })
  } catch (e) {
    console.error("[notifications] new device sign-in", e)
  }
}

/** Osta support opened a session inside this enterprise — tell the people who manage users. */
export async function notifySupportSessionOpened(a: { enterpriseId: string; grantId: string }) {
  try {
    const ent = await prisma.enterprise.findUnique({ where: { id: a.enterpriseId }, select: { slug: true } })
    if (!ent) return
    await notify({
      type: "SUPPORT_SESSION_OPENED",
      enterpriseId: a.enterpriseId,
      propertyId: null,
      title: "Osta support opened a session",
      body: "Support is working in your enterprise under an access grant you approved. Everything they do is logged.",
      url: `/e/${ent.slug}/hub/enterprise/support-access`,
      dedupeKey: `SUPPORT_SESSION_OPENED:${a.grantId}:${new Date().toISOString().slice(0, 13)}`,
      audience: { need: { module: "USERS" } },
    })
  } catch (e) {
    console.error("[notifications] support session", e)
  }
}

/** A guest booked an excursion or spa treatment through the Booking API — tell the people who run that service. */
export async function notifyActivityBookingReceived(a: { enterpriseId: string; propertyId: string; module: string; recordId: string }) {
  try {
    const where = await whereIs(a.propertyId)
    if (!where) return
    const spa = a.module === "SPA"
    await notify({
      type: "ACTIVITY_BOOKING_RECEIVED",
      enterpriseId: a.enterpriseId,
      propertyId: a.propertyId,
      title: spa ? "New spa booking from the website" : "New excursion booking from the website",
      body: where.name,
      url: `/e/${where.slug}/dashboard/${spa ? "spa" : "excursions"}`,
      entityType: "ApiActivityBooking",
      entityId: a.recordId,
      dedupeKey: `ACTIVITY_BOOKING_RECEIVED:${a.recordId}`,
      audience: { need: { module: spa ? "SPA" : "EXCURSIONS", action: "create" } },
    })
  } catch (e) {
    console.error("[notifications] activity booking", e)
  }
}
