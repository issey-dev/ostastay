import { prisma } from "@/lib/db"
import type { Action, Module } from "@/lib/modules"

// Who receives a notification. Decided by what a person may DO (their merged role
// permissions) and where they work, never by a role name or a job function — see
// NOTIFICATIONS_PLAN.md principle 2.

export type AudienceUser = {
  id: string
  scope: string
  propertyId: string | null
  roles: Array<{ role: { permissions: Array<{ module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }> } }>
}

const FLAG = { view: "canView", create: "canCreate", update: "canUpdate", delete: "canDelete" } as const

/** Pure: does the user work at this property (an enterprise user works at all of them)? */
export function worksAt(u: Pick<AudienceUser, "scope" | "propertyId">, propertyId: string | null): boolean {
  if (u.scope === "ENTERPRISE") return true
  return propertyId === null ? false : u.propertyId === propertyId
}

/** Pure: does ANY of the user's roles grant `action` on `module`? (the same OR rule as mergeRolePermissions) */
export function canDo(u: Pick<AudienceUser, "roles">, module: Module, action: Action): boolean {
  const flag = FLAG[action]
  return u.roles.some((r) => r.role.permissions.some((p) => p.module === module && p[flag]))
}

export type AudienceQuery = {
  enterpriseId: string
  propertyId: string | null
  /** Omit for "everyone at the property". */
  need?: { module: Module; action?: Action }
  /** Everyone in the enterprise, whichever property they work at (announcements). */
  everyone?: boolean
}

/** Active, real (not system) users of the enterprise who may receive this. */
export async function resolveRecipients(q: AudienceQuery): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      enterpriseId: q.enterpriseId,
      isActive: true,
      isSystem: false,
      ...(q.everyone ? {} : q.propertyId ? { OR: [{ scope: "ENTERPRISE" }, { propertyId: q.propertyId }] } : { scope: "ENTERPRISE" }),
    },
    select: {
      id: true,
      scope: true,
      propertyId: true,
      roles: { select: { role: { select: { permissions: true } } } },
    },
  })
  return users
    .filter((u) => q.everyone || worksAt(u, q.propertyId))
    .filter((u) => !q.need || canDo(u, q.need.module, q.need.action ?? "view"))
    .map((u) => u.id)
}
