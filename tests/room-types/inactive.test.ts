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

const roomTypesIdRoute = await import("@/app/api/room-types/[id]/route");
const reservationsRoute = await import("@/app/api/reservations/route");
const roomsAvailableRoute = await import("@/app/api/rooms/available/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Deactivating a room type blocks new reservations and takes its rooms out of service", () => {
  let propertyId: string;
  let adminId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let roomId: string;
  let guestId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.upsert({
      where: { slug: "test-inactive-rt-enterprise" },
      update: {},
      create: { name: "Inactive RT Enterprise", slug: "test-inactive-rt-enterprise", type: "STANDARD" },
    });

    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id,
        name: "Inactive RT Property",
        code: `IRT-${Date.now()}`,
        legalName: "Inactive RT Property LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    roomTypeId = roomType.id;

    const ratePlan = await prisma.ratePlan.create({
      data: { propertyId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanId = ratePlan.id;

    const building = await prisma.building.create({ data: { propertyId, name: "Main" } });
    const floor = await prisma.floor.create({ data: { buildingId: building.id, name: "1st" } });
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId, floorId: floor.id, roomNumber: "101", status: "CLEAN" },
    });
    roomId = room.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id,
        email: `inactive-rt-admin-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "A",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Guest", lastName: "One" },
    });
    guestId = guest.upid;
  });

  it("deactivating the room type cascades its rooms to OUT_OF_SERVICE", async () => {
    const res = await asUser(adminId, () =>
      roomTypesIdRoute.PUT(
        new Request(`http://localhost/api/room-types/${roomTypeId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Standard", code: "STD", maxOccupancy: 2, isActive: false }),
        }),
        { params: Promise.resolve({ id: roomTypeId }) }
      )
    );
    expect(res.status).toBe(200);

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.status).toBe("OUT_OF_SERVICE");
    // The room row itself is preserved, not deleted — history stays intact.
    expect(room).not.toBeNull();
  });

  it("GET /api/rooms/available excludes the now-out-of-service room", async () => {
    const res = await asUser(adminId, () =>
      roomsAvailableRoute.GET(
        new Request(
          `http://localhost/api/rooms/available?propertyId=${propertyId}&roomTypeId=${roomTypeId}&checkInDate=2026-09-01&checkOutDate=2026-09-03`
        )
      )
    );
    const body = await res.json();
    expect(body.find((r: { id: string }) => r.id === roomId)).toBeUndefined();
  });

  it("POST /api/reservations 400s against the now-inactive room type", async () => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId,
            primaryGuestId: guestId,
            checkInDate: "2026-09-01",
            checkOutDate: "2026-09-03",
            roomTypeId,
            ratePlanId,
          }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/inactive/i);
  });

  it("re-activating the room type does not auto-restore its rooms", async () => {
    const res = await asUser(adminId, () =>
      roomTypesIdRoute.PUT(
        new Request(`http://localhost/api/room-types/${roomTypeId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Standard", code: "STD", maxOccupancy: 2, isActive: true }),
        }),
        { params: Promise.resolve({ id: roomTypeId }) }
      )
    );
    expect(res.status).toBe(200);

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.status).toBe("OUT_OF_SERVICE");
  });
});
