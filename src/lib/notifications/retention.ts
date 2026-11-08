import { prisma } from "@/lib/db"

// How long notifications are kept (NOTIFICATIONS_PLAN.md section 12, default accepted):
// what a person has READ goes after 90 days, everything after 180, and a notification that
// no longer has anyone to show it to goes after a day. Run by the "notification-alerts" job.

export const READ_RETENTION_DAYS = 90
export const MAX_RETENTION_DAYS = 180

export async function pruneNotifications(now: Date = new Date()): Promise<{ recipients: number; notifications: number }> {
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
  const read = await prisma.notificationRecipient.deleteMany({ where: { readAt: { lt: daysAgo(READ_RETENTION_DAYS) } } })
  const old = await prisma.notification.deleteMany({ where: { createdAt: { lt: daysAgo(MAX_RETENTION_DAYS) } } })
  const orphans = await prisma.notification.deleteMany({ where: { createdAt: { lt: daysAgo(1) }, recipients: { none: {} } } })
  return { recipients: read.count, notifications: old.count + orphans.count }
}
