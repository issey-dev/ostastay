import { describe, it, expect, beforeAll } from "vitest"
import type { AuthContext } from "@/lib/scope"

// Real database: who a notification reaches, that a producer running twice raises it once,
// and that nobody can read or mark another person's notifications (NOTIFICATIONS_PLAN.md §2).

const { prisma } = await import("@/lib/db")
const { notify } = await import("@/lib/notifications/notify")
const { listInbox, markRead, unreadCount } = await import("@/lib/notifications/inbox")

const ctxFor = (userId: string, enterpriseId: string) => ({ userId, enterpriseId }) as AuthContext

describe("notifications (database)", () => {
  const tag = `ntf-${Date.now()}`
  let entA: string, entB: string, propA1: string, propA2: string
  let auditor: string, desk: string, otherProperty: string, inactive: string, otherEnt: string
  const ids: Record<string, string> = {}

  async function mkUser(enterpriseId: string, name: string, opts: { scope?: string; propertyId?: string; roleId?: string; isActive?: boolean }) {
    const u = await prisma.user.create({
      data: {
        enterpriseId,
        email: `${tag}-${name}@example.test`,
        passwordHash: "x",
        firstName: name,
        lastName: "Test",
        scope: opts.scope ?? "PROPERTY",
        propertyId: opts.propertyId ?? null,
        isActive: opts.isActive ?? true,
        ...(opts.roleId ? { roles: { create: { roleId: opts.roleId } } } : {}),
      },
    })
    return u.id
  }

  beforeAll(async () => {
    entA = (await prisma.enterprise.create({ data: { name: `${tag} A`, slug: `${tag}-a`, type: "STANDARD" } })).id
    entB = (await prisma.enterprise.create({ data: { name: `${tag} B`, slug: `${tag}-b`, type: "STANDARD" } })).id
    const mkProp = (enterpriseId: string, n: string) =>
      prisma.property.create({
        data: { enterpriseId, name: n, code: `${tag}-${n}`, legalName: `${n} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      })
    propA1 = (await mkProp(entA, "p1")).id
    propA2 = (await mkProp(entA, "p2")).id
    const auditRole = await prisma.role.create({ data: { enterpriseId: entA, name: "Auditor", permissions: { create: { module: "NIGHT_AUDIT", canView: true } } } })
    const deskRole = await prisma.role.create({ data: { enterpriseId: entA, name: "Desk", permissions: { create: { module: "FRONT_DESK", canView: true } } } })
    auditor = await mkUser(entA, "auditor", { propertyId: propA1, roleId: auditRole.id })
    desk = await mkUser(entA, "desk", { propertyId: propA1, roleId: deskRole.id })
    otherProperty = await mkUser(entA, "otherprop", { propertyId: propA2, roleId: auditRole.id })
    inactive = await mkUser(entA, "inactive", { propertyId: propA1, roleId: auditRole.id, isActive: false })
    const roleB = await prisma.role.create({ data: { enterpriseId: entB, name: "Auditor", permissions: { create: { module: "NIGHT_AUDIT", canView: true } } } })
    otherEnt = await mkUser(entB, "entb", { scope: "ENTERPRISE", roleId: roleB.id })
    Object.assign(ids, { auditor, desk, otherProperty, inactive, otherEnt })
  })

  const recipientsOf = async (notificationId: string) =>
    (await prisma.notificationRecipient.findMany({ where: { notificationId } })).map((r) => r.userId).sort()

  it("module-scoped: only active users at that property who hold the module", async () => {
    const id = await notify({
      type: "NIGHT_AUDIT_FAILED",
      enterpriseId: entA,
      propertyId: propA1,
      title: "Night Audit failed",
      audience: { need: { module: "NIGHT_AUDIT" } },
    })
    expect(id).toBeTruthy()
    expect(await recipientsOf(id!)).toEqual([auditor])
  })

  it("everyone-at-the-property: active users there, nobody from another property or enterprise", async () => {
    const id = await notify({ type: "BUSINESS_DATE_ROLLED", enterpriseId: entA, propertyId: propA1, title: "Business date rolled", audience: {} })
    expect(await recipientsOf(id!)).toEqual([auditor, desk].sort())
  })

  it("the same dedupeKey raises it once", async () => {
    const input = { type: "BUSINESS_DATE_ROLLED" as const, enterpriseId: entA, propertyId: propA1, title: "Rolled", audience: {}, dedupeKey: `${tag}-roll` }
    expect(await notify(input)).toBeTruthy()
    expect(await notify(input)).toBeNull()
    expect(await prisma.notification.count({ where: { enterpriseId: entA, dedupeKey: `${tag}-roll` } })).toBe(1)
  })

  it("excludes the person who did it, and rejects a link to another site", async () => {
    const id = await notify({
      type: "BUSINESS_DATE_ROLLED", enterpriseId: entA, propertyId: propA1, title: "x", audience: {}, excludeUserId: desk, url: "https://evil.example",
    })
    expect(await recipientsOf(id!)).toEqual([auditor])
    expect((await prisma.notification.findUnique({ where: { id: id! } }))!.url).toBeNull()
  })

  it("a person only sees and clears their own; ids from someone else match nothing", async () => {
    const mine = ctxFor(auditor, entA)
    const theirs = ctxFor(desk, entA)
    const before = await unreadCount(mine)
    expect(before).toBeGreaterThan(0)

    const deskItems = (await listInbox(theirs)).items
    const auditorItems = (await listInbox(mine)).items
    expect(auditorItems.length).toBeGreaterThan(deskItems.length)

    // The desk user tries to mark the auditor's rows read: changes nothing.
    expect(await markRead(theirs, { ids: auditorItems.map((i) => i.id) })).toBe(0)
    expect(await unreadCount(mine)).toBe(before)

    // Another enterprise's context sees nothing of enterprise A.
    expect((await listInbox(ctxFor(otherEnt, entB))).items).toEqual([])

    expect(await markRead(mine, { all: true })).toBe(before)
    expect(await unreadCount(mine)).toBe(0)
  })

  it("never throws into the caller", async () => {
    await expect(notify({ type: "BUSINESS_DATE_ROLLED", enterpriseId: "not-a-real-id", propertyId: null, title: "x", audience: {} })).resolves.toBeNull()
  })
})
