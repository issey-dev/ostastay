import { prisma } from "@/lib/db"
import type { AuthContext } from "@/lib/scope"

// A signed-in person's own notifications. Everything is keyed on ctx.userId AND the
// enterprise being worked in, so one person can never read or mark another's (the recipient
// row is the only way a notification reaches anyone).

export type InboxItem = {
  id: string
  type: string
  severity: string
  title: string
  body: string | null
  url: string | null
  createdAt: string
  read: boolean
}

const MAX_PAGE = 50

export async function listInbox(ctx: AuthContext, opts: { limit?: number; before?: string | null; unreadOnly?: boolean } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_PAGE)
  const before = opts.before ? new Date(opts.before) : null
  const rows = await prisma.notificationRecipient.findMany({
    where: {
      userId: ctx.userId,
      notification: { enterpriseId: ctx.enterpriseId },
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { notification: true },
  })
  const page = rows.slice(0, limit)
  const items: InboxItem[] = page.map((r) => ({
    id: r.id,
    type: r.notification.type,
    severity: r.notification.severity,
    title: r.notification.title,
    body: r.notification.body,
    url: r.notification.url,
    createdAt: r.createdAt.toISOString(),
    read: r.readAt !== null,
  }))
  return { items, nextBefore: rows.length > limit ? items[items.length - 1].createdAt : null }
}

export async function unreadCount(ctx: AuthContext): Promise<number> {
  return prisma.notificationRecipient.count({
    where: { userId: ctx.userId, readAt: null, notification: { enterpriseId: ctx.enterpriseId } },
  })
}

/** Mark some (by recipient id) or all of the caller's own notifications read. Returns how many changed. */
export async function markRead(ctx: AuthContext, target: { ids: string[] } | { all: true }): Promise<number> {
  const res = await prisma.notificationRecipient.updateMany({
    where: {
      userId: ctx.userId,
      readAt: null,
      notification: { enterpriseId: ctx.enterpriseId },
      ...("ids" in target ? { id: { in: target.ids } } : {}),
    },
    data: { readAt: new Date() },
  })
  return res.count
}
