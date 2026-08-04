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

const allocationsRoute = await import("@/app/api/allocations/route");
const allocationIdRoute = await import("@/app/api/allocations/[id]/route");
const ratePlanIdRoute = await import("@/app/api/rate-plans/[id]/route");
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

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("Allocations: tenant isolation", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let adminBId: string;
  let chargeCodeAId: string;
  let chargeCodeBId: string;
  let allocationAId: string;
  let allocationBId: string;
  let ratePlanAId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.create({
      data: { name: "Alloc Enterprise A", slug: `test-alloc-ent-a-${uniq()}`, type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.create({
      data: { name: "Alloc Enterprise B", slug: `test-alloc-ent-b-${uniq()}`, type: "STANDARD" },
    });

    const mkProperty = (enterpriseId: string, label: string) =>
      prisma.property.create({
        data: {
          enterpriseId, name: `Alloc Property ${label}`, code: `AP${label}-${uniq()}`,
          legalName: `Property ${label} LLC`, defaultCurrency: "USD", timeZone: "UTC",
          checkInTime: "14:00", checkOutTime: "11:00",
        },
      });

    const propertyA = await mkProperty(enterpriseA.id, "A");
    propertyAId = propertyA.id;
    const propertyB = await mkProperty(enterpriseB.id, "B");
    propertyBId = propertyB.id;

    chargeCodeAId = (
      await customChargeCode(enterpriseA.id, { code: "AL-A", description: "Allocation Revenue A" })
    ).id;
    chargeCodeBId = (
      await customChargeCode(enterpriseB.id, { code: "AL-B", description: "Allocation Revenue B" })
    ).id;

    allocationAId = (
      await prisma.allocation.create({
        data: {
          propertyId: propertyAId, code: "BF", name: "Breakfast A", chargeCodeId: chargeCodeAId,
          rates: { create: { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2020-01-01") } },
        },
      })
    ).id;
    allocationBId = (
      await prisma.allocation.create({
        data: {
          propertyId: propertyBId, code: "BF", name: "Breakfast B", chargeCodeId: chargeCodeBId,
          rates: { create: { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2020-01-01") } },
        },
      })
    ).id;

    ratePlanAId = (
      await prisma.ratePlan.create({ data: { propertyId: propertyAId, code: "BAR", name: "Best Available A" } })
    ).id;

    const passwordHash = await bcrypt.hash("password123", 10);
    adminAId = (
      await prisma.user.create({
        data: {
          enterpriseId: enterpriseA.id, email: `alloc-admin-a-${uniq()}@test.local`, passwordHash,
          firstName: "Admin", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;
    adminBId = (
      await prisma.user.create({
        data: {
          enterpriseId: enterpriseB.id, email: `alloc-admin-b-${uniq()}@test.local`, passwordHash,
          firstName: "Admin", lastName: "B", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;
  });

  it("blocks listing another enterprise's allocations", async () => {
    const res = await asUser(adminAId, () =>
      allocationsRoute.GET(new Request(`http://localhost/api/allocations?propertyId=${propertyBId}`))
    );
    expect(res.status).toBeGreaterThanOrEqual(403);
  });

  it("blocks creating an allocation under another enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      allocationsRoute.POST(
        new Request("http://localhost/api/allocations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyBId, code: "HACK", name: "Cross-tenant", chargeCodeId: chargeCodeAId,
          }),
        })
      )
    );
    expect(res.status).toBeGreaterThanOrEqual(403);
  });

  it("rejects a charge code from another enterprise on create", async () => {
    const res = await asUser(adminAId, () =>
      allocationsRoute.POST(
        new Request("http://localhost/api/allocations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId, code: "XCC", name: "Wrong Charge Code", chargeCodeId: chargeCodeBId,
          }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/enterprise/i);
  });

  it("blocks updating and deleting another enterprise's allocation", async () => {
    const putRes = await asUser(adminAId, () =>
      allocationIdRoute.PUT(
        new Request(`http://localhost/api/allocations/${allocationBId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Hijacked" }),
        }),
        { params: Promise.resolve({ id: allocationBId }) }
      )
    );
    expect(putRes.status).toBeGreaterThanOrEqual(403);

    const delRes = await asUser(adminAId, () =>
      allocationIdRoute.DELETE(
        new Request(`http://localhost/api/allocations/${allocationBId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: allocationBId }) }
      )
    );
    expect(delRes.status).toBeGreaterThanOrEqual(403);

    const stillThere = await prisma.allocation.findUnique({ where: { id: allocationBId } });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.name).toBe("Breakfast B");
  });

  it("rejects linking another property's allocation to a rate plan", async () => {
    const res = await asUser(adminAId, () =>
      ratePlanIdRoute.PUT(
        new Request(`http://localhost/api/rate-plans/${ratePlanAId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Best Available A", code: "BAR", priority: 10, isNegotiated: false,
            allocationIds: [allocationBId],
          }),
        }),
        { params: Promise.resolve({ id: ratePlanAId }) }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body.error)).toMatch(/belong/i);
  });

  it("rejects SELL_SEPARATE as a mode value (it is now an independent boolean, not a mode)", async () => {
    const res = await asUser(adminAId, () =>
      allocationsRoute.POST(
        new Request("http://localhost/api/allocations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId, code: "BADMODE", name: "Bad Mode", chargeCodeId: chargeCodeAId,
            mode: "SELL_SEPARATE",
          }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mode/i);
  });

  it("links a sell-separate allocation to a rate plan (sellSeparate no longer blocks packaging)", async () => {
    // A sell-separate allocation on property A.
    const sellSep = await prisma.allocation.create({
      data: {
        propertyId: propertyAId, code: "SS-A", name: "Sell-Separate A", chargeCodeId: chargeCodeAId,
        mode: "ADD_TO_RATE", sellSeparate: true,
        rates: { create: { adultPrice: 20, childPrice: 10, effectiveFrom: new Date("2020-01-01") } },
      },
    });
    const res = await asUser(adminAId, () =>
      ratePlanIdRoute.PUT(
        new Request(`http://localhost/api/rate-plans/${ratePlanAId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Best Available A", code: "BAR", priority: 10, isNegotiated: false,
            allocationIds: [sellSep.id],
          }),
        }),
        { params: Promise.resolve({ id: ratePlanAId }) }
      )
    );
    expect(res.status).toBe(200);
    const links = await prisma.ratePlanAllocation.findMany({ where: { ratePlanId: ratePlanAId } });
    expect(links.some((l) => l.allocationId === sellSep.id)).toBe(true);
  });

  it("allows the owning enterprise full CRUD on its own allocation", async () => {
    const putRes = await asUser(adminBId, () =>
      allocationIdRoute.PUT(
        new Request(`http://localhost/api/allocations/${allocationBId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Breakfast B Updated" }),
        }),
        { params: Promise.resolve({ id: allocationBId }) }
      )
    );
    expect(putRes.status).toBe(200);
    const body = await putRes.json();
    expect(body.name).toBe("Breakfast B Updated");
    expect(allocationAId).toBeDefined();
  });
});
