import { describe, it, expect, beforeAll } from "vitest"
import type { AuthContext } from "@/lib/scope"

// Announcements (NOTIFICATIONS_PLAN.md section 4): who one reaches, that the sender and other
// enterprises are left out, that a double click is one announcement, and personal targeting
// and bell opt-outs in the real notify() path.

const { prisma } = await import("@/lib/db")
const { sendAnnouncement, listAnnouncements, announcementSchema } = await import("@/lib/notifications/announcements")
const { notify } = await import("@/lib/notifications/notify")
const { setPreference } = await import("@/lib/notifications/preferences")

describe("announcements and preferences (database)", () => {
  const tag = `ann-${Date.now()}`
  let entA: string, entB: string, p1: string, p2: string
  let admin: string, atP1: string, atP2: string, enterpriseUser: string, otherEnt: string, inactive: string

  const mk = async (enterpriseId: string, n: string, o: { scope?: string; propertyId?: string; isActive?: boolean } = {}) =>
    (
      await prisma.user.create({
        data: { enterpriseId, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: o.scope ?? "PROPERTY", propertyId: o.propertyId ?? null, isActive: o.isActive ?? true },
      })
    ).id
  const ctx = (userId: string, enterpriseId: string, support = false) => ({ userId, enterpriseId, isActingAsSupport: support }) as AuthContext
  const mkProp = (enterpriseId: string, n: string) =>
    prisma.property.create({ data: { enterpriseId, name: n, code: `${tag}-${n}`, legalName: `${n} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } })
  const got = async (id: string) => (await prisma.notificationRecipient.findMany({ where: { notificationId: id } })).map((r) => r.userId).sort()

  beforeAll(async () => {
    entA = (await prisma.enterprise.create({ data: { name: `${tag} A`, slug: `${tag}-a`, type: "STANDARD" } })).id
    entB = (await prisma.enterprise.create({ data: { name: `${tag} B`, slug: `${tag}-b`, type: "STANDARD" } })).id
    p1 = (await mkProp(entA, "p1")).id
    p2 = (await mkProp(entA, "p2")).id
    admin = await mk(entA, "admin", { scope: "ENTERPRISE" })
    enterpriseUser = await mk(entA, "entuser", { scope: "ENTERPRISE" })
    atP1 = await mk(entA, "atp1", { propertyId: p1 })
    atP2 = await mk(entA, "atp2", { propertyId: p2 })
    inactive = await mk(entA, "inactive", { propertyId: p1, isActive: false })
    otherEnt = await mk(entB, "other", { scope: "ENTERPRISE" })
  })

  it("to everyone: every active person of every property, not the sender, not another enterprise", async () => {
    const r = await sendAnnouncement(ctx(admin, entA), { title: `${tag} all`, body: "Hello", audience: "ALL" })
    expect(r.id).toBeTruthy()
    expect(await got(r.id!)).toEqual([enterpriseUser, atP1, atP2].sort())
    expect(r.recipients).toBe(3)
    expect(await got(r.id!)).not.toContain(inactive)
    expect(await got(r.id!)).not.toContain(otherEnt)
  })

  it("to one property: its people and enterprise-wide people, not another property's", async () => {
    const r = await sendAnnouncement(ctx(admin, entA), { title: `${tag} p1`, audience: p1 })
    expect(await got(r.id!)).toEqual([enterpriseUser, atP1].sort())
  })

  it("refuses a property of another enterprise and a support session", async () => {
    const foreign = await mkProp(entB, "foreign")
    await expect(sendAnnouncement(ctx(admin, entA), { title: "Nope nope", audience: foreign.id })).rejects.toThrow(/not found/i)
    await expect(sendAnnouncement(ctx(admin, entA, true), { title: "Support says", audience: "ALL" })).rejects.toThrow(/support/i)
  })

  it("the same message twice in a minute is one announcement", async () => {
    const input = { title: `${tag} twice`, audience: "ALL" }
    expect((await sendAnnouncement(ctx(admin, entA), input)).id).toBeTruthy()
    expect((await sendAnnouncement(ctx(admin, entA), input)).id).toBeNull()
  })

  it("history lists what was sent, with read counts, only for this enterprise", async () => {
    const list = await listAnnouncements(entA)
    const all = list.find((a) => a.title === `${tag} all`)!
    expect(all.recipients).toBe(3)
    expect(all.read).toBe(0)
    expect(all.propertyName).toBeNull()
    expect(list.find((a) => a.title === `${tag} p1`)!.propertyName).toBe("p1")
    expect(await listAnnouncements(entB)).toEqual([])
  })

  it("validates title and message length", () => {
    expect(announcementSchema.safeParse({ title: "ab", audience: "ALL" }).success).toBe(false)
    expect(announcementSchema.safeParse({ title: "x".repeat(81), audience: "ALL" }).success).toBe(false)
    expect(announcementSchema.safeParse({ title: "Fine title", body: "y".repeat(501), audience: "ALL" }).success).toBe(false)
    expect(announcementSchema.safeParse({ title: "Fine title", body: "", audience: "ALL" }).success).toBe(true)
  })

  it("a personal notification reaches only the named active person of this enterprise", async () => {
    const id = await notify({
      type: "TASK_ASSIGNED", enterpriseId: entA, propertyId: p1, title: "A task was assigned to you",
      audience: { userIds: [atP1, otherEnt, inactive] },
    })
    expect(await got(id!)).toEqual([atP1])
    expect((await prisma.notification.findUnique({ where: { id: id! } }))!.scope).toBe("PERSONAL")
  })

  it("someone who muted a kind is skipped; a locked kind (announcement) cannot be muted", async () => {
    await setPreference(atP2, "CHANNEL_BOOKING_RECEIVED", { inApp: false })
    await setPreference(atP2, "ANNOUNCEMENT", { inApp: false })
    expect(await prisma.notificationPreference.findFirst({ where: { userId: atP2, type: "ANNOUNCEMENT" } })).toMatchObject({ inApp: true })
    const muted = await notify({ type: "CHANNEL_BOOKING_RECEIVED", enterpriseId: entA, propertyId: null, title: "Online", audience: { everyone: true } })
    expect(await got(muted!)).not.toContain(atP2)
    expect(await got(muted!)).toContain(atP1)
    const ann = await sendAnnouncement(ctx(admin, entA), { title: `${tag} locked`, audience: "ALL" })
    expect(await got(ann.id!)).toContain(atP2)
  })

  it("refuses an unknown kind of notification when saving a choice", async () => {
    expect(await setPreference(atP1, "NOT_A_KIND", { inApp: false })).toBe(false)
  })
})
