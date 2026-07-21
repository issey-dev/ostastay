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

const groupIdRoute = await import("@/app/api/groups/[id]/route");
const pickupRoute = await import("@/app/api/groups/[id]/pickup/route");
const reservationsRoute = await import("@/app/api/reservations/route");

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

describe("Group block editing & pickup rate choice", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let specialRatePlanId: string;
  let adminId: string;
  let groupId: string;

  const putGroup = (id: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      groupIdRoute.PUT(
        new Request(`http://localhost/api/groups/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) }
      )
    );

  const pickup = (id: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      pickupRoute.POST(
        new Request(`http://localhost/api/groups/${id}/pickup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Pick",
            lastName: `Up-${uniq()}`,
            roomTypeId,
            checkInDate: "2026-10-01",
            checkOutDate: "2026-10-03",
            adults: 1,
            ...body,
          }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Group Edit", slug: `test-group-edit-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Group Property",
        code: `GE-${uniq()}`,
        legalName: "Group LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Twin", code: "TWN", maxOccupancy: 2 },
    });
    roomTypeId = roomType.id;
    // Plenty of rooms so pickups never hit the availability guard here.
    for (let i = 0; i < 5; i++) {
      await prisma.room.create({
        data: { propertyId, roomTypeId, roomNumber: `G${i}${Math.floor(Math.random() * 900 + 100)}`, status: "CLEAN" },
      });
    }

    const defaultPlan = await prisma.ratePlan.create({
      data: { propertyId, code: "BAR", name: "Best Available Rate", priority: 1 },
    });
    ratePlanId = defaultPlan.id;
    const specialPlan = await prisma.ratePlan.create({
      data: { propertyId, code: "GRP", name: "Group Rate", priority: 5 },
    });
    specialRatePlanId = specialPlan.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `ge-admin-${uniq()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "GE",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const group = await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `GRP-${uniq()}`,
        name: "Conference Block",
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-05"),
        totalRoomsHeld: 3,
        status: "TENTATIVE",
      },
    });
    groupId = group.id;
  });

  it("edits status, cutoff, and rooms held", async () => {
    const res = await putGroup(groupId, { status: "DEFINITE", cutoffDate: "2026-09-25", totalRoomsHeld: 4 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("DEFINITE");
    expect(body.totalRoomsHeld).toBe(4);
    expect(new Date(body.cutoffDate).toISOString().slice(0, 10)).toBe("2026-09-25");
  });

  it("pickup honours a requested rate plan and meal plan", async () => {
    const res = await pickup(groupId, { ratePlanId: specialRatePlanId, mealPlanCode: "BB" });
    expect(res.status).toBe(200);
    const body = await res.json();
    const assignment = await prisma.roomAssignment.findFirst({ where: { reservationId: body.id } });
    expect(assignment?.ratePlanId).toBe(specialRatePlanId);
    const reservation = await prisma.reservation.findUnique({ where: { id: body.id } });
    expect(reservation?.mealPlan).toBe("BB");
  });

  it("rejects shrinking rooms held below active pickups", async () => {
    const res = await putGroup(groupId, { totalRoomsHeld: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/picked up/i);
  });

  it("rejects cancelling a block with active pickups, allows it once they're gone", async () => {
    const blocked = await putGroup(groupId, { status: "CANCELLED" });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/active pickup/i);

    await prisma.reservation.updateMany({ where: { groupBlockId: groupId }, data: { status: "CANCELLED" } });
    const allowed = await putGroup(groupId, { status: "CANCELLED" });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).status).toBe("CANCELLED");
  });

  it("a cancelled block rejects further pickups", async () => {
    const res = await pickup(groupId, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cancelled/i);
  });

  it("reservations list filters by status and search", async () => {
    const search = await asUser(adminId, () =>
      reservationsRoute.GET(
        new Request(`http://localhost/api/reservations?propertyId=${propertyId}&status=CANCELLED&search=Pick`)
      )
    );
    expect(search.status).toBe(200);
    const rows = await search.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.status === "CANCELLED")).toBe(true);

    const none = await asUser(adminId, () =>
      reservationsRoute.GET(
        new Request(`http://localhost/api/reservations?propertyId=${propertyId}&search=zzz-no-such-guest`)
      )
    );
    expect(await none.json()).toHaveLength(0);
  });
});
