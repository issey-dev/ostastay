import { prisma } from "@/lib/db"
import { NOTIFICATION_TYPES, isNotificationType, typeMeta, type NotificationType } from "./types"

// Each person's choice, per kind of notification, about the bell and their phone. No stored
// row means the default (both on). Types marked `locked` ignore an in-app opt-out.

export type PrefRow = { userId: string; type: string; inApp: boolean; push: boolean }

/**
 * Pure: of these users, who sees it in the bell and who also gets it on a phone.
 * Phone is only ever a subset of the bell — turning the bell off turns the phone off too.
 */
export function applyPreferences(type: NotificationType, userIds: string[], prefs: PrefRow[]): { bell: string[]; phone: string[] } {
  const locked = typeMeta(type)?.locked === true
  const byUser = new Map(prefs.filter((p) => p.type === type).map((p) => [p.userId, p]))
  const bell = userIds.filter((id) => locked || byUser.get(id)?.inApp !== false)
  const phone = bell.filter((id) => byUser.get(id)?.push !== false)
  return { bell, phone }
}

export async function splitRecipients(type: NotificationType, userIds: string[]) {
  const prefs = await prisma.notificationPreference.findMany({ where: { type, userId: { in: userIds } } })
  return applyPreferences(type, userIds, prefs)
}

export type PreferenceView = {
  type: NotificationType
  label: string
  description: string
  group: string
  severity: string
  locked: boolean
  inApp: boolean
  push: boolean
  /** INFO notifications never go to phones, whatever the choice. */
  pushable: boolean
}

/** Every kind, with the person's current choice, for the settings page. */
export async function listPreferences(userId: string): Promise<PreferenceView[]> {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } })
  const byType = new Map(rows.map((r) => [r.type, r]))
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => {
    const m = NOTIFICATION_TYPES[type] as { label: string; description: string; group: string; severity: string; locked?: boolean }
    const r = byType.get(type)
    return {
      type,
      label: m.label,
      description: m.description,
      group: m.group,
      severity: m.severity,
      locked: m.locked === true,
      inApp: m.locked === true ? true : (r?.inApp ?? true),
      push: r?.push ?? true,
      pushable: m.severity !== "INFO",
    }
  })
}

/** Save one choice. Unknown kinds are refused; a locked kind keeps its bell on. */
export async function setPreference(userId: string, type: string, change: { inApp?: boolean; push?: boolean }): Promise<boolean> {
  if (!isNotificationType(type)) return false
  const locked = typeMeta(type)?.locked === true
  const data = {
    ...(change.inApp !== undefined ? { inApp: locked ? true : change.inApp } : {}),
    ...(change.push !== undefined ? { push: change.push } : {}),
  }
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, ...data },
    update: data,
  })
  return true
}
