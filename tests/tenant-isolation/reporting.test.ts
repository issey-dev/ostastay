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

const analyticsRoute = await import("@/app/api/analytics/route");
const frontOfficeSummaryRoute = await import("@/app/api/front-office/summary/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Phase 6 tenant isolation: analytics & front-office summary", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let noPermAId: string; // Housekeeping role — no REVENUE/FRONT_DESK permission

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-p6-enterprise-a" },
      update: {},
      create: { name: "P6 Enterprise A", slug: "test-p6-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-p6-enterprise-b" },
      update: {},
      create: { name: "P6 Enterprise B", slug: "test-p6-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "P6 Property A", code: `P6PA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "P6 Property B", code: `P6PB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p6-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const noPermA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p6-noperm-a-${Date.now()}@test.local`, passwordHash,
        firstName: "NoPerm", lastName: "A", roleId: roleIds["Housekeeping"], scope: "ENTERPRISE",
      },
    });
    noPermAId = noPermA.id;
  });

  // --- /api/analytics ---

  it("GET /api/analytics 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      analyticsRoute.GET(new Request(`http://localhost/api/analytics?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/analytics 403s for a role without REVENUE permission", async () => {
    const res = await asUser(noPermAId, () =>
      analyticsRoute.GET(new Request(`http://localhost/api/analytics?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/analytics succeeds for the actor's own property", async () => {
    const res = await asUser(adminAId, () =>
      analyticsRoute.GET(new Request(`http://localhost/api/analytics?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRooms).toBe(0);
  });

  // --- /api/front-office/summary ---

  it("GET /api/front-office/summary 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      frontOfficeSummaryRoute.GET(new Request(`http://localhost/api/front-office/summary?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/front-office/summary 403s for a role without FRONT_DESK permission", async () => {
    const res = await asUser(noPermAId, () =>
      frontOfficeSummaryRoute.GET(new Request(`http://localhost/api/front-office/summary?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/front-office/summary succeeds for the actor's own property", async () => {
    const res = await asUser(adminAId, () =>
      frontOfficeSummaryRoute.GET(new Request(`http://localhost/api/front-office/summary?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vacantRoomsCount).toBe(0);
  });
});
