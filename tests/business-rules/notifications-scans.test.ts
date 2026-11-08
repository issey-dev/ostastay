import { describe, it, expect, beforeAll } from "vitest"

// Alerts that come from the clock (NOTIFICATIONS_PLAN.md section 4): an open cashier shift,
// a group cut-off, the retention sweep. The cron runs these every few minutes, so each must
// raise an alert once and then stay quiet.

const { prisma } = await import("@/lib/db")
const scans = await import("@/lib/notifications/scans")
const { pruneNotifications, READ_RETENTION_DAYS, MAX_RETENTION_DAYS } = await import("@/lib/notifications/retention")

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("time-based alert rules", () => {
  it("a group cut-off is only worth an alert today or tomorrow", () => {
    const today = D("2026-11-10")
    expect(scans.cutoffStage(D("2026-11-10"), today)).toBe("TODAY")
    expect(scans.cutoffStage(D("2026-11-11"), today)).toBe("TOMORROW")
    expect(scans.cutoffStage(D("2026-11-12"), today)).toBeNull()
    expect(scans.cutoffStage(D("2026-11-09"), today)).toBeNull()
    expect(scans.cutoffStage(null, today)).toBeNull()
  })

  it("a shift is forgotten after 16 hours, not before", () => {
    const now = new Date("2026-11-10T12:00:00Z")
    expect(scans.shiftLeftOpen(new Date("2026-11-09T19:59:00Z"), now)).toBe(true)
    expect(scans.shiftLeftOpen(new Date("2026-11-09T20:00:00Z"), now)).toBe(true)
    expect(scans.shiftLeftOpen(new Date("2026-11-09T20:01:00Z"), now)).toBe(false)
  })
})

describe("scans and retention (database)", () => {
  const tag = `scan-${Date.now()}`
  let ent: string, prop: string, cashier: string, supervisor: string, plain: string, groupMgr: string
  const businessDate = D("2026-11-10")

  const mkUser = async (n: string, roleId?: string) =>
    (
      await prisma.user.create({
        data: { enterpriseId: ent, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: "PROPERTY", propertyId: prop, ...(roleId ? { roles: { create: { roleId } } } : {}) },
      })
    ).id
  const got = async (type: string, entityId: string) => {
    const n = await prisma.notification.findMany({ where: { enterpriseId: ent, type, entityId }, include: { recipients: true } })
    return n.flatMap((x) => x.recipients.map((r) => r.userId)).sort()
  }

  beforeAll(async () => {
    ent = (await prisma.enterprise.create({ data: { name: tag, slug: tag, type: "STANDARD" } })).id
    prop = (
      await prisma.property.create({
        data: { enterpriseId: ent, name: "Scan Resort", code: tag, legalName: "S LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate },
      })
    ).id
    const supRole = await prisma.role.create({ data: { enterpriseId: ent, name: "Cash Sup", permissions: { create: { module: "CASHIERING", canView: true, canUpdate: true } } } })
    const grpRole = await prisma.role.create({ data: { enterpriseId: ent, name: "Groups", permissions: { create: { module: "GROUP_BLOCKS", canView: true, canUpdate: true } } } })
    cashier = await mkUser("cashier")
    supervisor = await mkUser("sup", supRole.id)
    groupMgr = await mkUser("grp", grpRole.id)
    plain = await mkUser("plain")
  })

  it("an open shift: the cashier and the supervisors hear once, nobody else, and not again", async () => {
    const old = await prisma.cashierShift.create({ data: { enterpriseId: ent, userId: cashier, propertyId: prop, businessDate, openedAt: new Date(Date.now() - 20 * 3_600_000) } })
    expect(await scans.scanOpenShifts(ent)).toBe(1)
    expect(await got("CASHIER_SHIFT_OPEN", old.id)).toEqual([cashier, supervisor].sort())
    expect(await got("CASHIER_SHIFT_OPEN", old.id)).not.toContain(plain)
    expect(await scans.scanOpenShifts(ent)).toBe(0)
    expect(await prisma.notification.count({ where: { enterpriseId: ent, type: "CASHIER_SHIFT_OPEN" } })).toBe(2)
  })

  it("a shift that is recent or already closed raises nothing", async () => {
    const before = await prisma.notification.count({ where: { enterpriseId: ent, type: "CASHIER_SHIFT_OPEN" } })
    const other = await mkUser("cashier2")
    const other2 = await mkUser("cashier3")
    await prisma.cashierShift.create({ data: { enterpriseId: ent, userId: other, propertyId: prop, businessDate, openedAt: new Date(Date.now() - 2 * 3_600_000) } })
    await prisma.cashierShift.create({ data: { enterpriseId: ent, userId: other2, propertyId: prop, businessDate, openedAt: new Date(Date.now() - 30 * 3_600_000), closedAt: new Date() } })
    expect(await scans.scanOpenShifts(ent)).toBe(0)
    expect(await prisma.notification.count({ where: { enterpriseId: ent, type: "CASHIER_SHIFT_OPEN" } })).toBe(before)
  })

  it("a group cut-off tomorrow with rooms still held tells the people who manage groups, once", async () => {
    const rt = await prisma.roomType.create({ data: { propertyId: prop, name: "Std", code: "STD", maxOccupancy: 2 } })
    const g = await prisma.groupBlock.create({
      data: {
        propertyId: prop, code: "G1", name: "Wedding", startDate: D("2026-12-01"), endDate: D("2026-12-05"), cutoffDate: D("2026-11-11"), status: "DEFINITE",
        roomHolds: { create: { roomTypeId: rt.id, quantity: 5 } },
      },
    })
    expect(await scans.scanGroupCutoffs(ent)).toBe(1)
    expect(await got("GROUP_CUTOFF", g.id)).toEqual([groupMgr])
    expect(await scans.scanGroupCutoffs(ent)).toBe(0)
    const n = await prisma.notification.findFirstOrThrow({ where: { enterpriseId: ent, type: "GROUP_CUTOFF" } })
    expect(n.body).toContain("5 of 5 rooms not picked up")
  })

  it("a group with a far-off cut-off, no cut-off, or cancelled raises nothing", async () => {
    const rt = await prisma.roomType.findFirstOrThrow({ where: { propertyId: prop } })
    const mk = (code: string, cutoffDate: Date | null, status = "DEFINITE") =>
      prisma.groupBlock.create({ data: { propertyId: prop, code, name: code, startDate: D("2026-12-01"), endDate: D("2026-12-05"), cutoffDate, status, roomHolds: { create: { roomTypeId: rt.id, quantity: 3 } } } })
    await mk("FAR", D("2026-11-20"))
    await mk("NONE", null)
    await mk("CANC", D("2026-11-11"), "CANCELLED")
    expect(await scans.scanGroupCutoffs(ent)).toBe(0)
  })

  it("transport scan is off until the add-on is switched on", async () => {
    expect(await scans.scanTransportAttention(ent)).toBe(0)
  })

  it("retention: read items go after 90 days, everything after 180, and orphans after a day", async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
    const mk = async (title: string, createdAt: Date, readAt: Date | null, withRecipient = true) =>
      prisma.notification.create({
        data: { enterpriseId: ent, type: "BUSINESS_DATE_ROLLED", title, createdAt, ...(withRecipient ? { recipients: { create: { userId: plain, readAt, createdAt } } } : {}) },
      })
    const keepUnread = await mk("keep-unread", daysAgo(100), null)
    const goneRead = await mk("gone-read", daysAgo(READ_RETENTION_DAYS + 5), daysAgo(READ_RETENTION_DAYS + 1))
    const goneOld = await mk("gone-old", daysAgo(MAX_RETENTION_DAYS + 5), null)
    const orphan = await mk("orphan", daysAgo(3), null, false)
    const fresh = await mk("fresh", daysAgo(0), null)
    await pruneNotifications()
    const left = async (id: string) => (await prisma.notification.count({ where: { id } })) === 1
    const recipLeft = async (id: string) => (await prisma.notificationRecipient.count({ where: { notificationId: id } })) === 1
    expect(await left(keepUnread.id)).toBe(true)
    expect(await recipLeft(keepUnread.id)).toBe(true)
    expect(await recipLeft(goneRead.id)).toBe(false)
    expect(await left(goneOld.id)).toBe(false)
    expect(await left(orphan.id)).toBe(false)
    expect(await left(fresh.id)).toBe(true)
  })
})
