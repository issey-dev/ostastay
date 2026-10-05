import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Transportation (TRANSPORTATION_PLAN.md): no enterprise can read or write another
// enterprise's transport configuration, bookings, departures, board or report — the same
// harness as every tenant-isolation suite (in-memory cookie jar, real route handlers).

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const configRoute = await import("@/app/api/transport/config/route");
const entityRoute = await import("@/app/api/transport/config/[entity]/route");
const entityIdRoute = await import("@/app/api/transport/config/[entity]/[id]/route");
const bookingsRoute = await import("@/app/api/transport/bookings/route");
const bookingRoute = await import("@/app/api/transport/bookings/[id]/route");
const billingRoute = await import("@/app/api/transport/bookings/[id]/billing/route");
const boardRoute = await import("@/app/api/transport/board/route");
const reportRoute = await import("@/app/api/transport/report/route");
const settingsRoute = await import("@/app/api/transport/settings/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
async function as(userId: string, handler: any, url: string, method = "GET", body?: unknown, params: Record<string, string> = {}) {
  cookieJar.clear();
  await createSession(userId);
  try {
    const res: Response = await handler(
      new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
      { params: Promise.resolve(params) }
    );
    return res.status;
  } finally {
    await destroySession();
  }
}

describe("Tenant isolation: Transportation", () => {
  let propertyA: string;
  let adminB: string;
  let typeA: string;
  let bookingA: string;

  beforeAll(async () => {
    await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const passwordHash = await bcrypt.hash("password123", 10);
    const make = async (label: string) => {
      const e = await prisma.enterprise.create({ data: { name: `Iso ${label}`, slug: `iso-transport-${label}-${uniq()}` } });
      const roles = await ensureRoles(prisma, e.id, SYSTEM_ROLE_DEFS, true);
      const p = await prisma.property.create({
        data: { enterpriseId: e.id, name: `Iso ${label}`, code: `ISOT-${uniq()}`, legalName: "x", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "12:00" },
      });
      await prisma.transportSettings.create({ data: { propertyId: p.id, enabled: true } });
      await prisma.enterpriseAddonAccess.create({ data: { enterpriseId: e.id, module: "TRANSPORTATION", enabled: true } });
      const u = await prisma.user.create({
        data: { enterpriseId: e.id, email: `iso-t-${label}-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: label, roles: { create: { roleId: roles["Admin"] } }, scope: "ENTERPRISE" },
      });
      return { propertyId: p.id, userId: u.id };
    };
    const a = await make("a");
    const b = await make("b");
    propertyA = a.propertyId;
    adminB = b.userId;
    typeA = (await prisma.transportType.create({ data: { propertyId: propertyA, code: "SPB", name: "Speedboat", mode: "SPEEDBOAT" } })).id;
    bookingA = (await prisma.transportBooking.create({ data: { propertyId: propertyA, guestName: "Guest A", direction: "PICKUP", serviceDate: new Date("2027-01-01") } })).id;
  });

  it("refuses every read and write on another enterprise's property", async () => {
    const q = `?propertyId=${propertyA}`;
    expect(await as(adminB, configRoute.GET, `/api/transport/config${q}`)).toBe(403);
    expect(await as(adminB, settingsRoute.PATCH, `/api/transport/settings${q}`, "PATCH", { enabled: false })).toBe(403);
    expect(await as(adminB, entityRoute.POST, `/api/transport/config/types${q}`, "POST", { code: "XX", name: "Hijack", mode: "LAND" }, { entity: "types" })).toBe(403);
    expect(await as(adminB, entityIdRoute.PATCH, `/api/transport/config/types/${typeA}${q}`, "PATCH", { isActive: false }, { entity: "types", id: typeA })).toBe(403);
    expect(await as(adminB, bookingsRoute.GET, `/api/transport/bookings${q}`)).toBe(403);
    expect(await as(adminB, bookingRoute.GET, `/api/transport/bookings/${bookingA}${q}`, "GET", undefined, { id: bookingA })).toBe(403);
    expect(await as(adminB, billingRoute.POST, `/api/transport/bookings/${bookingA}/billing${q}`, "POST", { action: "WAIVE", reason: "nope" }, { id: bookingA })).toBe(403);
    expect(await as(adminB, boardRoute.GET, `/api/transport/board${q}&date=2027-01-01`)).toBe(403);
    expect(await as(adminB, reportRoute.GET, `/api/transport/report${q}&from=2027-01-01`)).toBe(403);
    // Nothing changed.
    expect((await prisma.transportType.findUniqueOrThrow({ where: { id: typeA } })).isActive).toBe(true);
    expect((await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingA } })).billingStatus).toBe("NOT_BILLED");
  });

  it("an id from another enterprise is not found under one's own property", async () => {
    const own = await prisma.property.findFirstOrThrow({ where: { enterprise: { users: { some: { id: adminB } } } } });
    expect(await as(adminB, bookingRoute.GET, `/api/transport/bookings/${bookingA}?propertyId=${own.id}`, "GET", undefined, { id: bookingA })).toBe(404);
    expect(await as(adminB, entityIdRoute.PATCH, `/api/transport/config/types/${typeA}?propertyId=${own.id}`, "PATCH", { isActive: false }, { entity: "types", id: typeA })).toBe(404);
  });
});
