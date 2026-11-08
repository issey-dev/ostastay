import { createHash } from "crypto"
import { prisma } from "@/lib/db"
import { ForbiddenError, type AuthContext } from "@/lib/scope"
import { notify } from "./notify"
import { announcementSchema as _schema, type AnnouncementInput, type AnnouncementRow } from "./announcements-shared"

export { _schema as announcementSchema }
export type { AnnouncementInput, AnnouncementRow }

// Announcements: a message from an administrator to everyone in the enterprise, or to one
// property (NOTIFICATIONS_PLAN.md section 4). Authored in the Hub; delivered as a
// notification of kind ANNOUNCEMENT, which cannot be muted in the bell.

/** Send one. Returns the number of people it reached (0 = nobody to tell). */
export async function sendAnnouncement(ctx: AuthContext, input: AnnouncementInput): Promise<{ id: string | null; recipients: number }> {
  // Support staff act inside a tenant to troubleshoot; they do not speak to the tenant's staff.
  if (ctx.isActingAsSupport) throw new ForbiddenError("Announcements cannot be sent from a support session")

  let propertyId: string | null = null
  if (input.audience !== "ALL") {
    const property = await prisma.property.findFirst({ where: { id: input.audience, enterpriseId: ctx.enterpriseId, status: "ACTIVE" }, select: { id: true } })
    if (!property) throw new ForbiddenError("Property not found")
    propertyId = property.id
  }

  // The same message sent twice within the minute (a double click) is one announcement.
  const minute = Math.floor(Date.now() / 60_000)
  const dedupeKey = `ANNOUNCEMENT:${createHash("sha256").update(`${ctx.userId}|${input.title}|${input.body ?? ""}|${input.audience}|${minute}`).digest("hex").slice(0, 24)}`

  const id = await notify({
    type: "ANNOUNCEMENT",
    enterpriseId: ctx.enterpriseId,
    propertyId,
    title: input.title,
    body: input.body || undefined,
    createdByUserId: ctx.userId,
    dedupeKey,
    audience: propertyId ? {} : { everyone: true },
    excludeUserId: ctx.userId,
  })
  if (!id) return { id: null, recipients: 0 }
  return { id, recipients: await prisma.notificationRecipient.count({ where: { notificationId: id } }) }
}

/** The most recent announcements the enterprise has sent, with how many people have read each. */
export async function listAnnouncements(enterpriseId: string, limit = 20): Promise<AnnouncementRow[]> {
  const rows = await prisma.notification.findMany({
    where: { enterpriseId, type: "ANNOUNCEMENT" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      body: true,
      propertyId: true,
      createdAt: true,
      _count: { select: { recipients: true } },
    },
  })
  const readCounts = await prisma.notificationRecipient.groupBy({
    by: ["notificationId"],
    where: { notificationId: { in: rows.map((r) => r.id) }, readAt: { not: null } },
    _count: { _all: true },
  })
  const read = new Map(readCounts.map((r) => [r.notificationId, r._count._all]))
  const names = new Map(
    (await prisma.property.findMany({ where: { id: { in: rows.map((r) => r.propertyId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    propertyName: r.propertyId ? (names.get(r.propertyId) ?? "A property") : null,
    createdAt: r.createdAt.toISOString(),
    recipients: r._count.recipients,
    read: read.get(r.id) ?? 0,
  }))
}
