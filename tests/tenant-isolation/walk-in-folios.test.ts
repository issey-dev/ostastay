import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");

const folioWalkInRoute = await import("@/app/api/folios/walk-in/route");
const folioIdRoute = await import("@/app/api/folios/[id]/route");
const lineItemsRoute = await import("@/app/api/folios/[id]/line-items/route");
const paymentsRoute = await import("@/app/api/folios/[id]/payments/route");
const invoiceDataRoute = await import("@/app/api/folios/[id]/invoice-data/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Walk-in folios (no reservation): tenant isolation", () => {
  let propertyAId: string;
  let propertyA2Id: string;
  let propertyBId: string;
  let adminAId: string;
  let propertyScopedA2Id: string;
  let adminBId: string;
  let chargeCodeAId: string;
  let paymentMethodAId: string;
  let walkInFolioId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-walkin-enterprise-a" },
      update: {},
      create: { name: "Walk-in Enterprise A", slug: "test-walkin-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-walkin-enterprise-b" },
      update: {},
      create: { name: "Walk-in Enterprise B", slug: "test-walkin-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "Walk-in Property A", code: `WA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00", pricesIncludeTaxes: false,
      },
    });
    propertyAId = propertyA.id;

    const propertyA2 = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "Walk-in Property A2", code: `WA2-${Date.now()}`,
        legalName: "Property A2 LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyA2Id = propertyA2.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "Walk-in Property B", code: `WB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const chargeCodeA = await prisma.chargeCode.create({
      data: { enterpriseId: enterpriseA.id, code: "WI-SPA", description: "Spa" },
    });
    chargeCodeAId = chargeCodeA.id;
    const paymentMethodA = await prisma.paymentMethod.create({
      data: { enterpriseId: enterpriseA.id, name: "Cash", type: "CASH" },
    });
    paymentMethodAId = paymentMethodA.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `walkin-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const propertyScopedA2 = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `walkin-propscoped-a2-${Date.now()}@test.local`, passwordHash,
        firstName: "PropScoped", lastName: "A2", roleId: roleIds["Admin"], scope: "PROPERTY", propertyId: propertyA2Id,
      },
    });
    propertyScopedA2Id = propertyScopedA2.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `walkin-admin-b-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const created = await asUser(adminAId, () =>
      folioWalkInRoute.POST(
        new Request("http://localhost/api/folios/walk-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, walkInGuestName: "Passerby Guest", walkInGuestContact: "555-0100" }),
        })
      )
    );
    expect(created.status).toBe(201);
    walkInFolioId = (await created.json()).id;
  });

  it("POST /api/folios/walk-in 403s when the property belongs to a different enterprise", async () => {
    const res = await asUser(adminBId, () =>
      folioWalkInRoute.POST(
        new Request("http://localhost/api/folios/walk-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, walkInGuestName: "Hijack Attempt" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/folios/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => folioIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: walkInFolioId }) }));
    expect(res.status).toBe(403);
  });

  it("GET /api/folios/[id] 403s for a PROPERTY-scoped user at a different property in the same enterprise", async () => {
    const res = await asUser(propertyScopedA2Id, () => folioIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: walkInFolioId }) }));
    expect(res.status).toBe(403);
  });

  it("GET /api/folios/[id] succeeds for the correctly-scoped admin and reflects the walk-in guest info", async () => {
    const res = await asUser(adminAId, () => folioIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: walkInFolioId }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservation).toBeNull();
    expect(body.walkInGuestName).toBe("Passerby Guest");
  });

  it("GET /api/folios/[id]/invoice-data 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => invoiceDataRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: walkInFolioId }) }));
    expect(res.status).toBe(403);
  });

  it("GET /api/folios/[id]/invoice-data succeeds and its reservation is null", async () => {
    const res = await asUser(adminAId, () => invoiceDataRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: walkInFolioId }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.folio.reservation).toBeNull();
    expect(body.folio.walkInGuestName).toBe("Passerby Guest");
  });

  it("POST /api/folios/[id]/line-items 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () =>
      lineItemsRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeCodeId: chargeCodeAId, amount: 50, description: "Hijack" }) }),
        { params: Promise.resolve({ id: walkInFolioId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/folios/[id]/line-items succeeds for the correctly-scoped admin", async () => {
    const res = await asUser(adminAId, () =>
      lineItemsRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeCodeId: chargeCodeAId, amount: 50, description: "Massage" }) }),
        { params: Promise.resolve({ id: walkInFolioId }) }
      )
    );
    expect(res.status).toBe(201);
  });

  it("POST /api/folios/[id]/payments 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () =>
      paymentsRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 50 }) }),
        { params: Promise.resolve({ id: walkInFolioId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/folios/[id]/payments succeeds for the correctly-scoped admin", async () => {
    const res = await asUser(adminAId, () =>
      paymentsRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 50 }) }),
        { params: Promise.resolve({ id: walkInFolioId }) }
      )
    );
    expect(res.status).toBe(201);
  });

  it("PATCH /api/folios/[id] closes a walk-in folio", async () => {
    const res = await asUser(adminAId, () =>
      folioIdRoute.PATCH(
        new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isClosed: true }) }),
        { params: Promise.resolve({ id: walkInFolioId }) }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isClosed).toBe(true);
  });
});
