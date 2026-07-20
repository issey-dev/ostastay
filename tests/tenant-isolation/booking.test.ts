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

const profilesRoute = await import("@/app/api/profiles/route");
const reservationsRoute = await import("@/app/api/reservations/route");
const groupsRoute = await import("@/app/api/groups/route");
const tapeChartRoute = await import("@/app/api/tape-chart/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Phase 3 tenant isolation: profiles, reservations, groups, tape-chart", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let housekeepingAId: string;
  let roomTypeAId: string;
  let ratePlanAId: string;
  let guestAId: string;
  let guestBId: string;

  beforeAll(async () => {
    // Reuses the same INTERNAL "Osta" enterprise row as tests/scope.test.ts (same slug) —
    // src/lib/scope.ts's getOstaEnterpriseId() caches the first INTERNAL enterprise id it
    // resolves for the lifetime of the test process.
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-p3-enterprise-a" },
      update: {},
      create: { name: "P3 Enterprise A", slug: "test-p3-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-p3-enterprise-b" },
      update: {},
      create: { name: "P3 Enterprise B", slug: "test-p3-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id,
        name: "P3 Property A",
        code: `P3PA-${Date.now()}`,
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
        name: "P3 Property B",
        code: `P3PB-${Date.now()}`,
        legalName: "Property B LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const roomTypeA = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    roomTypeAId = roomTypeA.id;

    // The availability guard requires at least one sellable room of the type — a
    // type with zero physical rooms is (correctly) never bookable.
    await prisma.room.create({
      data: { propertyId: propertyAId, roomTypeId: roomTypeAId, roomNumber: `B${Math.floor(Math.random() * 9000 + 1000)}` },
    });

    const ratePlanA = await prisma.ratePlan.create({
      data: { propertyId: propertyAId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanAId = ratePlanA.id;

    const passwordHash = await bcrypt.hash("password123", 10);

    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id,
        email: `p3-admin-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "A",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const housekeepingA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id,
        email: `p3-housekeeping-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "House",
        lastName: "Keeping",
        roleId: roleIds["Housekeeping"],
        scope: "ENTERPRISE",
      },
    });
    housekeepingAId = housekeepingA.id;

    const guestA = await prisma.profile.create({
      data: { enterpriseId: enterpriseA.id, profileType: "GUEST", firstName: "Guest", lastName: "A" },
    });
    guestAId = guestA.upid;

    const guestB = await prisma.profile.create({
      data: { enterpriseId: enterpriseB.id, profileType: "GUEST", firstName: "Guest", lastName: "B" },
    });
    guestBId = guestB.upid;
  });

  it("POST /api/profiles ignores a client-supplied enterpriseId and always uses the session's own", async () => {
    const res = await asUser(adminAId, () =>
      profilesRoute.POST(
        new Request("http://localhost/api/profiles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ firstName: "Sneaky", lastName: "Guest", enterpriseId: "some-other-enterprise-id" }),
        })
      )
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.enterpriseId).not.toBe("some-other-enterprise-id");
  });

  it("GET /api/profiles only ever returns the caller's own enterprise's rows", async () => {
    const res = await asUser(adminAId, () => profilesRoute.GET(new Request("http://localhost/api/profiles")));
    const body = await res.json();
    expect(body.every((p: { upid: string }) => p.upid !== guestBId)).toBe(true);
  });

  it("POST /api/reservations 403s creating under a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyBId,
            primaryGuestId: guestAId,
            checkInDate: "2026-08-01",
            checkOutDate: "2026-08-03",
            roomTypeId: roomTypeAId,
            ratePlanId: ratePlanAId,
          }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/reservations 404s when the guest profile belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId,
            primaryGuestId: guestBId,
            checkInDate: "2026-08-01",
            checkOutDate: "2026-08-03",
            roomTypeId: roomTypeAId,
            ratePlanId: ratePlanAId,
          }),
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/reservations succeeds for the actor's own property and guest", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId,
            primaryGuestId: guestAId,
            checkInDate: "2026-08-01",
            checkOutDate: "2026-08-03",
            roomTypeId: roomTypeAId,
            ratePlanId: ratePlanAId,
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.propertyId).toBe(propertyAId);
  });

  it("GET /api/reservations 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.GET(new Request(`http://localhost/api/reservations?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/groups 403s for a role without GROUP_BLOCKS permission", async () => {
    const res = await asUser(housekeepingAId, () =>
      groupsRoute.POST(
        new Request("http://localhost/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId,
            code: `GRP-${Date.now()}`,
            name: "Wedding Party",
            startDate: "2026-09-01",
            endDate: "2026-09-05",
          }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/groups 403s creating under a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      groupsRoute.POST(
        new Request("http://localhost/api/groups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyBId,
            code: `GRP-${Date.now()}`,
            name: "Wedding Party",
            startDate: "2026-09-01",
            endDate: "2026-09-05",
          }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/tape-chart 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      tapeChartRoute.GET(
        new Request(`http://localhost/api/tape-chart?propertyId=${propertyBId}&startDate=2026-08-01&endDate=2026-08-05`)
      )
    );
    expect(res.status).toBe(403);
  });
});
