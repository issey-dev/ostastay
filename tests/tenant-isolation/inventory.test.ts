import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts — lets the real route handlers'
// calls into src/lib/scope.ts (which reads next/headers' cookies()) run under Vitest.
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
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");

const buildingsRoute = await import("@/app/api/buildings/route");
const chargeCodesRoute = await import("@/app/api/charge-codes/route");
const ratePlansRoute = await import("@/app/api/rate-plans/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Phase 2 tenant isolation: buildings, rate-plans, charge-codes", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let adminBId: string;
  let frontDeskAId: string;
  let taxProfileAId: string;
  let taxProfileBId: string;
  // Charge codes are classified by ChargeSubgroup now, so each enterprise needs its own
  // canonical tree — and the subgroup id a POST supplies must belong to it.
  let subgroupAId: string;
  let subgroupBId: string;

  beforeAll(async () => {
    // Reuses the same INTERNAL "Osta" enterprise row as tests/scope.test.ts (same slug) —
    // src/lib/scope.ts's getOstaEnterpriseId() caches the first INTERNAL enterprise id it
    // resolves for the lifetime of the test process, so a second, differently-slugged
    // INTERNAL row here would desync whichever test file's beforeAll runs second.
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-p2-enterprise-a" },
      update: {},
      create: { name: "P2 Enterprise A", slug: "test-p2-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-p2-enterprise-b" },
      update: {},
      create: { name: "P2 Enterprise B", slug: "test-p2-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id,
        name: "P2 Property A",
        code: `P2PA-${Date.now()}`,
        legalName: "Property A LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id,
        name: "P2 Property B",
        code: `P2PB-${Date.now()}`,
        legalName: "Property B LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const passwordHash = await bcrypt.hash("password123", 10);

    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id,
        email: `p2-admin-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "A",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id,
        email: `p2-admin-b-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "B",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const frontDeskA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id,
        email: `p2-frontdesk-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Front",
        lastName: "Desk",
        roleId: roleIds["Front Desk"],
        scope: "PROPERTY",
        propertyId: propertyAId,
      },
    });
    frontDeskAId = frontDeskA.id;

    const taxProfileA = await prisma.taxProfile.create({
      data: {
        enterpriseId: enterpriseA.id,
        name: "P2 VAT A",
        rates: { create: { ratePercent: 10, effectiveFrom: new Date() } },
      },
    });
    taxProfileAId = taxProfileA.id;

    const taxProfileB = await prisma.taxProfile.create({
      data: {
        enterpriseId: enterpriseB.id,
        name: "P2 VAT B",
        rates: { create: { ratePercent: 20, effectiveFrom: new Date() } },
      },
    });
    taxProfileBId = taxProfileB.id;

    for (const [entId, assign] of [
      [enterpriseA.id, (v: string) => { subgroupAId = v; }],
      [enterpriseB.id, (v: string) => { subgroupBId = v; }],
    ] as const) {
      await ensureChargeTree(prisma, entId);
      const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
        where: { enterpriseId_code: { enterpriseId: entId, code: "GOVERNMENT_LEVY" } },
      });
      assign(sub.id);
    }
  });

  it("GET /api/buildings 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      buildingsRoute.GET(new Request(`http://localhost/api/buildings?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/buildings 403s creating under a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      buildingsRoute.POST(
        new Request("http://localhost/api/buildings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyBId, name: "Sneaky Building" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/buildings succeeds for the actor's own property", async () => {
    const res = await asUser(adminAId, () =>
      buildingsRoute.POST(
        new Request("http://localhost/api/buildings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, name: "Main Building" }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.propertyId).toBe(propertyAId);
  });

  it("POST /api/buildings 403s for a PROPERTY-scoped user without CONTROLS permission", async () => {
    const res = await asUser(frontDeskAId, () =>
      buildingsRoute.POST(
        new Request("http://localhost/api/buildings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, name: "Should Not Exist" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/charge-codes 404s when the tax profile belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      chargeCodesRoute.POST(
        new Request("http://localhost/api/charge-codes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "vat", description: "VAT", chargeSubgroupId: subgroupAId, useDefaultTax: false, taxProfileId: taxProfileBId }),
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/charge-codes ignores a client-supplied enterpriseId and always uses the session's own", async () => {
    const res = await asUser(adminAId, () =>
      chargeCodesRoute.POST(
        new Request("http://localhost/api/charge-codes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: "vat-a",
            description: "VAT A",
            chargeSubgroupId: subgroupAId,
            useDefaultTax: false,
            taxProfileId: taxProfileAId,
            enterpriseId: "some-other-enterprise-id",
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const created = await prisma.chargeCode.findUnique({ where: { id: body.id } });
    expect(created?.enterpriseId).not.toBe("some-other-enterprise-id");
  });

  it("GET /api/charge-codes only ever returns the caller's own enterprise's rows", async () => {
    await asUser(adminBId, () =>
      chargeCodesRoute.POST(
        new Request("http://localhost/api/charge-codes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "vat-b", description: "VAT B", chargeSubgroupId: subgroupBId, useDefaultTax: false, taxProfileId: taxProfileBId }),
        })
      )
    );

    const res = await asUser(adminAId, () => chargeCodesRoute.GET());
    const body = await res.json();
    expect(body.every((c: { code: string }) => c.code !== "VAT-B")).toBe(true);
  });

  it("POST /api/rate-plans 403s for a role without REVENUE permission", async () => {
    const res = await asUser(frontDeskAId, () =>
      ratePlansRoute.POST(
        new Request("http://localhost/api/rate-plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "BAR", name: "Best Available Rate", propertyId: propertyAId }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/rate-plans 403s creating under a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      ratePlansRoute.POST(
        new Request("http://localhost/api/rate-plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "BAR", name: "Best Available Rate", propertyId: propertyBId }),
        })
      )
    );
    expect(res.status).toBe(403);
  });
});
