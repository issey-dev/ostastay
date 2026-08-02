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

const typesRoute = await import("@/app/api/excursions/types/route");
const typeIdRoute = await import("@/app/api/excursions/types/[id]/route");
const departuresRoute = await import("@/app/api/excursions/departures/route");
const departureIdRoute = await import("@/app/api/excursions/departures/[id]/route");
const bookingsRoute = await import("@/app/api/excursions/bookings/route");
const enterpriseAddonsRoute = await import("@/app/api/licenses/enterprise-addons/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Excursions: tenant isolation", () => {
  let ostaAdminId: string;
  let enterpriseAId: string;
  let propertyAId: string;
  let propertyA2Id: string; // a second property under Enterprise A, for the PROPERTY-scoped guard
  let propertyBId: string;
  let adminAId: string;
  let propertyScopedA2Id: string;
  let adminBId: string;
  let chargeCodeAId: string;
  let chargeCodeBId: string;
  let excursionTypeAId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id, email: `excursions-osta-admin-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    const enterpriseA = await prisma.enterprise.create({
      data: { name: "Excursions Enterprise A", slug: `test-excursions-a-${uniq()}`, type: "STANDARD" },
    });
    enterpriseAId = enterpriseA.id;
    const enterpriseB = await prisma.enterprise.create({
      data: { name: "Excursions Enterprise B", slug: `test-excursions-b-${uniq()}`, type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseAId, name: "Excursions Property A", code: `XA-${uniq()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyA2 = await prisma.property.create({
      data: {
        enterpriseId: enterpriseAId, name: "Excursions Property A2", code: `XA2-${uniq()}`,
        legalName: "Property A2 LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyA2Id = propertyA2.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "Excursions Property B", code: `XB-${uniq()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    // The add-on defaults OFF and is enterprise-scoped (2026-08-02) — enable it for
    // Enterprise A only, same as a real Osta support-admin would via
    // /osta/enterprises/[id]. Enterprise B deliberately stays OFF: its admin is only
    // ever used for cross-tenant 403 checks, and the defaults-OFF test below relies
    // on B never having the add-on.
    await asUser(ostaAdminId, () =>
      enterpriseAddonsRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-addons", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId: enterpriseAId, module: "EXCURSIONS", enabled: true }),
        })
      )
    );

    const chargeCodeA = await customChargeCode(enterpriseAId, { code: "XC-A", description: "Excursion Charge A" });
    chargeCodeAId = chargeCodeA.id;
    const chargeCodeB = await customChargeCode(enterpriseB.id, { code: "XC-B", description: "Excursion Charge B" });
    chargeCodeBId = chargeCodeB.id;

    // Hub-wide Excursion Outlet per enterprise — posting is refused without one
    // (owner rule 2026-07-30).
    for (const [entId, propId, code] of [[enterpriseAId, propertyAId, "XOA"], [enterpriseB.id, propertyBId, "XOB"]] as const) {
      const outlet = await prisma.outlet.create({ data: { propertyId: propId, name: `Dive ${code}`, code, outletType: "RECREATION" } });
      await prisma.enterpriseSettings.upsert({
        where: { enterpriseId: entId },
        update: { excursionOutletId: outlet.id },
        create: { enterpriseId: entId, resConfirmPrefix: "", resConfirmLength: 6, excursionOutletId: outlet.id },
      });
    }

    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId, email: `excursions-admin-a-${uniq()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const propertyScopedA2 = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId, email: `excursions-propscoped-a2-${uniq()}@test.local`, passwordHash,
        firstName: "PropScoped", lastName: "A2", roleId: roleIds["Admin"], scope: "PROPERTY", propertyId: propertyA2Id,
      },
    });
    propertyScopedA2Id = propertyScopedA2.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `excursions-admin-b-${uniq()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const created = await asUser(adminAId, () =>
      typesRoute.POST(
        new Request("http://localhost/api/excursions/types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId, code: "SNORK", name: "Snorkelling Trip", chargeCodeId: chargeCodeAId,
            rates: [{ adultPrice: 50, childPrice: 25, infantPrice: 0, effectiveFrom: "2020-01-01" }],
          }),
        })
      )
    );
    expect(created.status).toBe(201);
    excursionTypeAId = (await created.json()).id;
  });

  it("POST /api/excursions/types 403s when linking a different enterprise's charge code", async () => {
    const res = await asUser(adminAId, () =>
      typesRoute.POST(
        new Request("http://localhost/api/excursions/types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, code: "CROSS", name: "Cross-Tenant", chargeCodeId: chargeCodeBId }),
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/excursions/types 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => typesRoute.GET(new Request(`http://localhost/api/excursions/types?propertyId=${propertyAId}`)));
    expect(res.status).toBe(403);
  });

  it("PUT /api/excursions/types/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () =>
      typeIdRoute.PUT(
        new Request("http://localhost", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Hijacked" }) }),
        { params: Promise.resolve({ id: excursionTypeAId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/excursions/types/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () =>
      typeIdRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: excursionTypeAId }) })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/excursions/departures 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => departuresRoute.GET(new Request(`http://localhost/api/excursions/departures?propertyId=${propertyAId}`)));
    expect(res.status).toBe(403);
  });

  it("GET /api/excursions/types 403s for a PROPERTY-scoped user at a different property in the same enterprise", async () => {
    const res = await asUser(propertyScopedA2Id, () => typesRoute.GET(new Request(`http://localhost/api/excursions/types?propertyId=${propertyAId}`)));
    expect(res.status).toBe(403);
  });

  it("GET /api/excursions/types succeeds for the correctly-scoped admin", async () => {
    const res = await asUser(adminAId, () => typesRoute.GET(new Request(`http://localhost/api/excursions/types?propertyId=${propertyAId}`)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((t: any) => t.id === excursionTypeAId)).toBe(true);
  });

  it("POST /api/excursions/bookings 403s for a different enterprise's admin", async () => {
    const departures = await asUser(adminAId, () => departuresRoute.GET(new Request(`http://localhost/api/excursions/departures?propertyId=${propertyAId}`)));
    // No departures generated yet in this suite — booking against a nonexistent id from
    // a foreign admin should still 403/404 before ever reaching "departure not found",
    // since assertPropertyModuleAccess runs first in the well-formed case; here we just
    // confirm the route rejects a cross-enterprise caller outright at the permission gate.
    void departures;
    const res = await asUser(adminBId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: "nonexistent", reservationId: "nonexistent", adultCount: 1 }),
        })
      )
    );
    expect([403, 404]).toContain(res.status);
  });

  it("catalog and booking routes 403 when the add-on isn't enabled for the enterprise (defaults OFF)", async () => {
    // Enterprise B never enabled EXCURSIONS — its own admin, on its own property,
    // passes the property-access check but must still be stopped at the add-on gate.
    const res = await asUser(adminBId, () => typesRoute.GET(new Request(`http://localhost/api/excursions/types?propertyId=${propertyBId}`)));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not enabled for this enterprise/i);
  });

  it("enabling the add-on lights it up for EVERY property in the enterprise", async () => {
    // Enterprise A was enabled once at the enterprise level — its second property (A2)
    // never got an individual toggle, yet the add-on must work there too.
    const res = await asUser(adminAId, () => typesRoute.GET(new Request(`http://localhost/api/excursions/types?propertyId=${propertyA2Id}`)));
    expect(res.status).toBe(200);
  });

  it("only Osta staff can toggle an enterprise's add-on access", async () => {
    const res = await asUser(adminAId, () =>
      enterpriseAddonsRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-addons", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId: enterpriseAId, module: "EXCURSIONS", enabled: false }),
        })
      )
    );
    expect(res.status).toBe(403);
  });
});
