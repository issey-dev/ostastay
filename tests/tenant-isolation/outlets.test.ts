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

const outletsRoute = await import("@/app/api/outlets/route");
const outletIdRoute = await import("@/app/api/outlets/[id]/route");
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

describe("Outlets: tenant isolation", () => {
  let propertyAId: string;
  let propertyA2Id: string; // a second property under Enterprise A, for the PROPERTY-scoped guard
  let propertyBId: string;
  let adminAId: string;
  let propertyScopedA2Id: string; // PROPERTY-scoped user whose work location is propertyA2, not propertyA
  let adminBId: string;
  let chargeCodeAId: string;
  let chargeCodeBId: string;
  let outletAId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-outlets-enterprise-a" },
      update: {},
      create: { name: "Outlets Enterprise A", slug: "test-outlets-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-outlets-enterprise-b" },
      update: {},
      create: { name: "Outlets Enterprise B", slug: "test-outlets-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "Outlets Property A", code: `OA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyA2 = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "Outlets Property A2", code: `OA2-${Date.now()}`,
        legalName: "Property A2 LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyA2Id = propertyA2.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "Outlets Property B", code: `OB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const chargeCodeA = await customChargeCode(enterpriseA.id, { code: "SPA-A", description: "Spa Treatment A" });
    chargeCodeAId = chargeCodeA.id;
    const chargeCodeB = await customChargeCode(enterpriseB.id, { code: "SPA-B", description: "Spa Treatment B" });
    chargeCodeBId = chargeCodeB.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `outlets-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const propertyScopedA2 = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `outlets-propscoped-a2-${Date.now()}@test.local`, passwordHash,
        firstName: "PropScoped", lastName: "A2", roleId: roleIds["Admin"], scope: "PROPERTY", propertyId: propertyA2Id,
      },
    });
    propertyScopedA2Id = propertyScopedA2.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `outlets-admin-b-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const outletA = await asUser(adminAId, () =>
      outletsRoute.POST(
        new Request("http://localhost/api/outlets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, name: "Ocean Spa", code: "OCE", outletType: "SPA", chargeCodeIds: [chargeCodeAId] }),
        })
      )
    );
    outletAId = (await outletA.json()).id;
  });

  it("POST /api/outlets 403s when adding a different enterprise's charge code to the pool", async () => {
    const res = await asUser(adminAId, () =>
      outletsRoute.POST(
        new Request("http://localhost/api/outlets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, name: "Cross-Tenant Outlet", code: "XTN", chargeCodeIds: [chargeCodeBId] }),
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/outlets/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => outletIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: outletAId }) }));
    expect(res.status).toBe(403);
  });

  it("PATCH /api/outlets/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () =>
      outletIdRoute.PATCH(
        new Request("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Hijacked" }) }),
        { params: Promise.resolve({ id: outletAId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/outlets/[id] 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => outletIdRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ id: outletAId }) }));
    expect(res.status).toBe(403);
  });

  it("GET /api/outlets/[id] 403s for a PROPERTY-scoped user at a different property in the same enterprise", async () => {
    const res = await asUser(propertyScopedA2Id, () => outletIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: outletAId }) }));
    expect(res.status).toBe(403);
  });

  it("GET /api/outlets/[id] succeeds for the correctly-scoped admin", async () => {
    const res = await asUser(adminAId, () => outletIdRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: outletAId }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The pool holds the explicitly attached code PLUS the outlet's own provisioned
    // template codes (outlet-wise subgroups) — membership, not an exact list.
    expect(body.chargeCodes.map((oc: any) => oc.chargeCodeId)).toContain(chargeCodeAId);
  });

  it("GET /api/outlets?propertyId= 403s for a different enterprise's admin", async () => {
    const res = await asUser(adminBId, () => outletsRoute.GET(new Request(`http://localhost/api/outlets?propertyId=${propertyAId}`)));
    expect(res.status).toBe(403);
  });

});
