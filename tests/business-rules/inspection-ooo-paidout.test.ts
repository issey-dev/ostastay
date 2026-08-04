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
const { expectedCashForShift } = await import("@/lib/shift-summary");

const reservationsRoute = await import("@/app/api/reservations/route");
const checkInRoute = await import("@/app/api/reservations/[id]/check-in/route");
const maintenanceRoute = await import("@/app/api/maintenance/route");
const maintenanceIdRoute = await import("@/app/api/maintenance/[id]/route");
const paidOutRoute = await import("@/app/api/cashiering/paid-out/route");
const openShiftRoute = await import("@/app/api/cashiering/open/route");
const availableRoomsRoute = await import("@/app/api/rooms/available/route");

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

describe("Inspection gate, out-of-order lifecycle, paid-outs", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let adminId: string;
  let guestId: string;

  const makeRoom = (status = "CLEAN") =>
    prisma.room.create({
      data: { propertyId, roomTypeId, roomNumber: `IG${Math.floor(Math.random() * 90000 + 10000)}`, status },
    });

  const bookAndGetId = async (roomId: string, checkInDate: string, checkOutDate: string) => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId,
            primaryGuestId: guestId,
            roomTypeId,
            ratePlanId: undefined,
            roomId,
            checkInDate,
            checkOutDate,
            adults: 1,
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  };

  const checkIn = (id: string) =>
    asUser(adminId, () =>
      checkInRoute.POST(new Request(`http://localhost/api/reservations/${id}/check-in`, { method: "POST" }), {
        params: Promise.resolve({ id }),
      })
    );

  let ratePlanId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Inspection Gate", slug: `test-inspection-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Gate Property",
        code: `IG-${uniq()}`,
        legalName: "Gate LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Suite", code: "STE", maxOccupancy: 4 },
    });
    roomTypeId = roomType.id;

    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    ratePlanId = ratePlan.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `ig-admin-${uniq()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "IG",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Gate", lastName: "Guest" },
    });
    guestId = guest.upid;
  });

  it("inspection gate off: CLEAN room checks in; gate on: only INSPECTED does", async () => {
    // Gate off — CLEAN room is fine.
    const roomA = await makeRoom("CLEAN");
    await prisma.roomAssignment.deleteMany({ where: { roomId: roomA.id } });
    const resA = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId, roomTypeId, ratePlanId, roomId: roomA.id,
            checkInDate: "2026-11-01", checkOutDate: "2026-11-02", adults: 1,
          }),
        })
      )
    );
    const idA = (await resA.json()).id;
    // Early check-in is blocked now, so advance the business date to the arrival window
    // (covers both 2026-11-01 and 2026-11-05 check-ins in this test).
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: new Date(Date.UTC(2026, 10, 5)) } });
    expect((await checkIn(idA)).status).toBe(200);

    // Gate on — a CLEAN room now blocks; an INSPECTED one passes.
    await prisma.property.update({ where: { id: propertyId }, data: { requireInspectionOnCheckIn: true } });

    const roomB = await makeRoom("CLEAN");
    const resB = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId, roomTypeId, ratePlanId, roomId: roomB.id,
            checkInDate: "2026-11-05", checkOutDate: "2026-11-06", adults: 1,
          }),
        })
      )
    );
    const idB = (await resB.json()).id;
    const blocked = await checkIn(idB);
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/inspected/i);

    await prisma.room.update({ where: { id: roomB.id }, data: { status: "INSPECTED" } });
    expect((await checkIn(idB)).status).toBe(200);

    await prisma.property.update({ where: { id: propertyId }, data: { requireInspectionOnCheckIn: false } });
  });

  it("a ticket with takeOutOfOrder pulls the room from sale; resolving returns it DIRTY", async () => {
    const room = await makeRoom("CLEAN");

    const create = await asUser(adminId, () =>
      maintenanceRoute.POST(
        new Request("http://localhost/api/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId: room.id,
            issueType: "PLUMBING",
            description: "Burst pipe",
            priority: "HIGH",
            takeOutOfOrder: true,
            expectedReturn: "2026-12-01",
          }),
        })
      )
    );
    expect(create.status).toBe(201);
    const ticket = await create.json();

    const afterCreate = await prisma.room.findUnique({ where: { id: room.id } });
    expect(afterCreate?.status).toBe("OUT_OF_ORDER");
    expect(afterCreate?.oooReason).toBe("Burst pipe");
    expect(afterCreate?.oooExpectedReturn).not.toBeNull();

    // OOO room is excluded from availability.
    const avail = await asUser(adminId, () =>
      availableRoomsRoute.GET(
        new Request(
          `http://localhost/api/rooms/available?propertyId=${propertyId}&roomTypeId=${roomTypeId}&checkInDate=2026-11-20&checkOutDate=2026-11-21`
        )
      )
    );
    const availRooms = await avail.json();
    expect(availRooms.some((r: any) => r.id === room.id)).toBe(false);

    // Resolve via the RESTful route — room returns to service as DIRTY, metadata cleared.
    const resolve = await asUser(adminId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "RESOLVED" }),
        }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(resolve.status).toBe(200);

    const afterResolve = await prisma.room.findUnique({ where: { id: room.id } });
    expect(afterResolve?.status).toBe("DIRTY");
    expect(afterResolve?.oooReason).toBeNull();
    expect(afterResolve?.oooExpectedReturn).toBeNull();
  });

  it("paid-outs require an open shift, then reduce expected cash", async () => {
    // No shift yet — rejected.
    const rejected = await asUser(adminId, () =>
      paidOutRoute.POST(
        new Request("http://localhost/api/cashiering/paid-out", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 20, reason: "Taxi reimbursement" }),
        })
      )
    );
    expect(rejected.status).toBe(400);

    await asUser(adminId, () =>
      openShiftRoute.POST(
        new Request("http://localhost/api/cashiering/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ openingFloat: "100" }),
        })
      )
    );

    const ok = await asUser(adminId, () =>
      paidOutRoute.POST(
        new Request("http://localhost/api/cashiering/paid-out", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 20, reason: "Taxi reimbursement" }),
        })
      )
    );
    expect(ok.status).toBe(201);

    // Math: float 100, no payments, 20 paid out → expected 80.
    expect(expectedCashForShift(100, [], [{ amount: 20 }])).toBe(80);

    const invalid = await asUser(adminId, () =>
      paidOutRoute.POST(
        new Request("http://localhost/api/cashiering/paid-out", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: -5, reason: "nope" }),
        })
      )
    );
    expect(invalid.status).toBe(400);
  });
});
