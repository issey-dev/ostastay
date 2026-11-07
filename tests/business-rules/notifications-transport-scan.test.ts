import { describe, it, expect, beforeAll, vi } from "vitest"

// The transport scan (NOTIFICATIONS_PLAN.md section 4): which people are told, once per
// problem, again when the flight time moves, and only for properties that use the module.
// The booking list is replaced with fixed rows; the attention RULES have their own tests.

type Row = { id: string; reference: string; flightAt: string | null; attention: { code: string; message: string }[] }
let rows: Row[] = []
vi.mock("@/lib/transport/bookings", () => ({
  listBookings: async () => ({ items: rows, nextCursor: null }),
}))

const { prisma } = await import("@/lib/db")
const scans = await import("@/lib/notifications/scans")

describe("transport attention scan", () => {
  const tag = `tscan-${Date.now()}`
  let ent: string, prop: string, dispatcher: string, viewer: string

  beforeAll(async () => {
    ent = (await prisma.enterprise.create({ data: { name: tag, slug: tag, type: "STANDARD" } })).id
    prop = (
      await prisma.property.create({
        data: { enterpriseId: ent, name: "T Resort", code: tag, legalName: "T LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: new Date("2026-11-10T00:00:00Z") },
      })
    ).id
    const update = await prisma.role.create({ data: { enterpriseId: ent, name: "Dispatch", permissions: { create: { module: "TRANSPORTATION", canView: true, canUpdate: true } } } })
    const view = await prisma.role.create({ data: { enterpriseId: ent, name: "Viewer", permissions: { create: { module: "TRANSPORTATION", canView: true } } } })
    const mk = async (n: string, roleId: string) =>
      (await prisma.user.create({ data: { enterpriseId: ent, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: "PROPERTY", propertyId: prop, roles: { create: { roleId } } } })).id
    dispatcher = await mk("dispatch", update.id)
    viewer = await mk("viewer", view.id)
  })

  const recipients = async (entityId: string) =>
    (await prisma.notificationRecipient.findMany({ where: { notification: { enterpriseId: ent, type: "TRANSPORT_ATTENTION", entityId } } })).map((r) => r.userId)

  it("does nothing until the add-on and the property's transport switch are on", async () => {
    rows = [{ id: "b1", reference: "TR-0001", flightAt: "2026-11-11T09:00:00.000Z", attention: [{ code: "PICKUP_TOO_EARLY", message: "The boat leaves before the flight lands" }] }]
    expect(await scans.scanTransportAttention(ent)).toBe(0)
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId: ent, module: "TRANSPORTATION", enabled: true } })
    expect(await scans.scanTransportAttention(ent)).toBe(0)
    await prisma.transportSettings.create({ data: { propertyId: prop, enabled: true } })
  })

  it("tells people who manage manifests (not view-only people), once per problem", async () => {
    expect(await scans.scanTransportAttention(ent)).toBe(1)
    expect(await recipients("b1")).toEqual([dispatcher])
    expect(await recipients("b1")).not.toContain(viewer)
    expect(await scans.scanTransportAttention(ent)).toBe(0)
  })

  it("the same booking after its flight time moved, or with a new problem, is a new alert", async () => {
    rows = [{ ...rows[0], flightAt: "2026-11-11T07:00:00.000Z" }]
    expect(await scans.scanTransportAttention(ent)).toBe(1)
    rows = [{ ...rows[0], attention: [...rows[0].attention, { code: "FLIGHT_CHANGED", message: "Flight time changed" }] }]
    expect(await scans.scanTransportAttention(ent)).toBe(1)
    expect(await prisma.notification.count({ where: { enterpriseId: ent, type: "TRANSPORT_ATTENTION", entityId: "b1" } })).toBe(3)
  })

  it("a booking with nothing to flag raises nothing", async () => {
    rows = []
    expect(await scans.scanTransportAttention(ent)).toBe(0)
  })

  it("the lock-screen text names the property and booking reference, never a guest", async () => {
    const n = await prisma.notification.findFirstOrThrow({ where: { enterpriseId: ent, type: "TRANSPORT_ATTENTION" } })
    expect(n.body).toContain("T Resort")
    expect(n.body).toContain("TR-0001")
  })
})
