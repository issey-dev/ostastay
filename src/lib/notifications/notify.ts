import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { NOTIFICATION_TYPES, type NotificationType } from "./types"
import { resolveRecipients, type AudienceQuery } from "./audience"
import { sendPushToUsers } from "./push"
import { splitRecipients } from "./preferences"

// The ONE way a notification is raised. Like logActivity() and notifyBookingChange(), it
// NEVER throws into the caller: telling people about something must not break the action
// (or the cron job) that happened. Failures go to console.error.

export type NotifyInput = {
  type: NotificationType
  enterpriseId: string
  propertyId: string | null
  title: string
  /** Keep it free of guest names and amounts: it may later appear on a phone's lock screen. */
  body?: string
  /** A same-origin path, e.g. "/e/acme/dashboard/financials/night-audit". */
  url?: string
  entityType?: string
  entityId?: string
  /** Makes the producer safe to run twice. Same key in the same enterprise = one notification. */
  dedupeKey?: string
  createdByUserId?: string
  /**
   * Who: everyone at the property, only users who hold a permission, or named people
   * (`userIds`, a PERSONAL notification — still limited to active users of this enterprise).
   */
  audience: Pick<AudienceQuery, "need" | "everyone"> & { userIds?: string[] }
  /** Never notify the person who just did it themselves. */
  excludeUserId?: string
}

/** Only a path on this site can be a target — never another origin. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  return url.startsWith("/") && !url.startsWith("//") ? url : null
}

export async function notify(input: NotifyInput): Promise<string | null> {
  try {
    const personal = input.audience.userIds !== undefined
    const wanted = personal
      ? (
          await prisma.user.findMany({
            where: { id: { in: input.audience.userIds }, enterpriseId: input.enterpriseId, isActive: true, isSystem: false },
            select: { id: true },
          })
        ).map((u) => u.id)
      : await resolveRecipients({ enterpriseId: input.enterpriseId, propertyId: input.propertyId, need: input.audience.need, everyone: input.audience.everyone })
    // Each person's own choices: who sees it in the bell, and who also gets it on a phone.
    const { bell: recipients, phone } = await splitRecipients(
      input.type,
      wanted.filter((id) => id !== input.excludeUserId),
    )
    if (recipients.length === 0) return null

    const meta = NOTIFICATION_TYPES[input.type]
    try {
      const created = await prisma.notification.create({
        data: {
          enterpriseId: input.enterpriseId,
          propertyId: input.propertyId,
          type: input.type,
          severity: meta.severity,
          scope: personal ? "PERSONAL" : "GLOBAL",
          title: input.title,
          body: input.body ?? null,
          url: safeUrl(input.url),
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey ?? null,
          createdByUserId: input.createdByUserId ?? null,
          recipients: { create: recipients.map((userId) => ({ userId })) },
        },
        select: { id: true },
      })
      // Phone push only for things someone should act on; INFO stays in the bell. Fire and
      // forget: push is best-effort and must never slow or fail the action itself.
      if (meta.severity !== "INFO") {
        void sendPushToUsers(phone, {
          title: input.title,
          body: input.body,
          url: safeUrl(input.url),
          tag: created.id,
          urgent: meta.severity === "URGENT",
        })
      }
      return created.id
    } catch (e) {
      // Same dedupeKey already raised: that is the point of the key, not an error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null
      throw e
    }
  } catch (e) {
    console.error("[notifications] could not raise", input.type, e)
    return null
  }
}
