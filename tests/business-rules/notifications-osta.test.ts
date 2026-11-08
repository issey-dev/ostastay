import { describe, it, expect, beforeAll, vi } from "vitest"
import type { InboxItem } from "@/lib/osta/attention"

// Notifications for Uppsolut's platform staff: raised from the console's own "Needs action"
// list, once per item, only to Osta staff, never visible in a customer's settings. The list
// itself is replaced with fixed items (its own rules live in src/lib/osta/attention.ts).

let inbox: InboxItem[] = []
vi.mock("@/lib/osta/attention", () => ({ getOstaToday: async () => ({ inbox }) }))

const { prisma } = await import("@/lib/db")
const { ostaAlertFor, scanOstaInbox } = await import("@/lib/notifications/osta-scan")
const { listPreferences } = await import("@/lib/notifications/preferences")

const NOW = new Date("2026-11-10T12:00:00Z")
const approval: InboxItem = { kind: "approval", id: "approval:p1", propertyId: "p1", propertyName: "Lagoon Retreat", propertyCode: "LR", enterpriseId: "e1", enterpriseName: "Veyo", submittedAt: "2026-11-09T00:00:00Z", used: 1, cap: 2 }
const channel: InboxItem = { kind: "channel", id: "channel:c1", connectionId: "c1", connectionName: "Beds24", enterpriseName: "Veyo", propertyName: "Beach", lastError: "token rejected", lastHealthCheckAt: null }
const license: InboxItem = { kind: "license", id: "license:e1", enterpriseId: "e1", enterpriseName: "Veyo", state: "GRACE", expiresAt: "2026-11-01T00:00:00Z", graceEndsAt: "2026-11-15T00:00:00Z" }
const billing = (daysOverdue: number): InboxItem => ({ kind: "billing", id: "billing:i1", invoiceId: "i1", invoiceNo: "LI-0001", enterpriseId: "e1", enterpriseName: "Veyo", amount: 1200, currency: "USD", issuedAt: "2026-10-01T00:00:00Z", dueAt: null, daysOverdue })

describe("platform alert wording and dedupe", () => {
  it("each kind of inbox item becomes its own kind of notification with a link into the console", () => {
    expect(ostaAlertFor(approval, NOW)).toMatchObject({ type: "OSTA_PROPERTY_REVIEW", url: "/osta/properties/p1", dedupeKey: "OSTA_PROPERTY_REVIEW:p1" })
    expect(ostaAlertFor(channel, NOW)).toMatchObject({ type: "OSTA_CHANNEL_FAILING", url: "/osta/channel-manager" })
    expect(ostaAlertFor(license, NOW)).toMatchObject({ type: "OSTA_LICENSE", url: "/osta/enterprises/e1" })
    expect(ostaAlertFor(billing(0), NOW)).toMatchObject({ type: "OSTA_BILLING", url: "/osta/billing" })
  })

  it("an unpaid invoice is announced again when it becomes overdue, not before", () => {
    expect(ostaAlertFor(billing(0), NOW)!.dedupeKey).toBe("OSTA_BILLING:i1:issued")
    expect(ostaAlertFor(billing(3), NOW)!.dedupeKey).toBe("OSTA_BILLING:i1:overdue")
    expect(ostaAlertFor(billing(9), NOW)!.dedupeKey).toBe("OSTA_BILLING:i1:overdue")
  })

  it("a failing channel repeats daily, not every few minutes; a licence alerts on a change of state", () => {
    expect(ostaAlertFor(channel, NOW)!.dedupeKey).toBe("OSTA_CHANNEL_FAILING:c1:2026-11-10")
    expect(ostaAlertFor(channel, new Date("2026-11-11T01:00:00Z"))!.dedupeKey).toBe("OSTA_CHANNEL_FAILING:c1:2026-11-11")
    expect(ostaAlertFor({ ...license, state: "EXPIRED" }, NOW)!.dedupeKey).not.toBe(ostaAlertFor(license, NOW)!.dedupeKey)
  })

  it("the text carries the customer and the thing, never an amount or an error message", () => {
    for (const item of [approval, channel, license, billing(3)]) {
      const a = ostaAlertFor(item, NOW)!
      const text = `${a.title} ${a.body}`
      expect(text).not.toMatch(/1200|1,200|token rejected/)
    }
  })
})

describe("platform scan (database)", () => {
  const tag = `osta-${Date.now()}`
  let osta: string, tenant: string, staff: string, noAccess: string, tenantUser: string

  beforeAll(async () => {
    osta = (await prisma.enterprise.create({ data: { name: `${tag} Osta`, slug: `${tag}-osta`, type: "INTERNAL" } })).id
    tenant = (await prisma.enterprise.create({ data: { name: `${tag} T`, slug: `${tag}-t`, type: "STANDARD" } })).id
    const role = await prisma.role.create({ data: { enterpriseId: osta, name: "Admin", permissions: { create: { module: "CONTROLS", canView: true } } } })
    const mk = async (enterpriseId: string, n: string, roleId?: string) =>
      (await prisma.user.create({ data: { enterpriseId, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: "ENTERPRISE", ...(roleId ? { roles: { create: { roleId } } } : {}) } })).id
    staff = await mk(osta, "staff", role.id)
    noAccess = await mk(osta, "noaccess")
    tenantUser = await mk(tenant, "tenantuser")
  })

  const count = (userId: string) => prisma.notificationRecipient.count({ where: { userId, notification: { type: { startsWith: "OSTA_" } } } })

  it("raises each item once, to Osta staff who can see the console, and not again", async () => {
    inbox = [approval, channel, license, billing(0)]
    expect(await scanOstaInbox(osta, NOW)).toBe(4)
    expect(await count(staff)).toBe(4)
    expect(await count(noAccess)).toBe(0)
    expect(await scanOstaInbox(osta, NOW)).toBe(0)
    expect(await count(staff)).toBe(4)
  })

  it("only an item that changed is raised again", async () => {
    inbox = [approval, channel, license, billing(5)]
    expect(await scanOstaInbox(osta, NOW)).toBe(1)
    expect(await count(staff)).toBe(5)
  })

  it("does nothing for a customer enterprise, and nobody there ever receives a platform item", async () => {
    inbox = [approval]
    expect(await scanOstaInbox(tenant, NOW)).toBe(0)
    expect(await count(tenantUser)).toBe(0)
  })

  it("platform kinds are in the settings of Osta staff only", async () => {
    const platform = (await listPreferences(staff, { platform: true })).map((p) => p.type)
    const customer = (await listPreferences(tenantUser)).map((p) => p.type)
    expect(platform).toEqual(expect.arrayContaining(["OSTA_PROPERTY_REVIEW", "OSTA_CHANNEL_FAILING", "OSTA_LICENSE", "OSTA_BILLING"]))
    expect(customer.some((t) => t.startsWith("OSTA_"))).toBe(false)
    expect(customer).toContain("NIGHT_AUDIT_FAILED")
  })
})
