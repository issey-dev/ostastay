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

const housekeepingRoute = await import("@/app/api/housekeeping/route");
const tasksRoute = await import("@/app/api/housekeeping/tasks/route");

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

describe("Housekeeping lifecycle coupling", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let floorId: string;
  let adminId: string;

  const patchRoom = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      )
    );

  const patchTask = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      tasksRoute.PATCH(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      )
    );

  const makeRoom = async (status = "DIRTY") => {
    return prisma.room.create({
      data: {
        propertyId,
        roomTypeId,
        floorId,
        roomNumber: `HK${Math.floor(Math.random() * 90000 + 10000)}`,
        status,
      },
    });
  };

  const makeTask = async (roomId: string, taskType = "CHECKOUT") => {
    return prisma.housekeepingTask.create({
      data: { roomId, taskType, status: "PENDING", priority: "NORMAL", scheduledDate: new Date() },
    });
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "HK Lifecycle", slug: `test-hk-lifecycle-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "HK Property",
        code: `HK-${uniq()}`,
        legalName: "HK LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const building = await prisma.building.create({ data: { propertyId, name: "Main" } });
    const floor = await prisma.floor.create({ data: { buildingId: building.id, name: "1" } });
    floorId = floor.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2, housekeepingEnabled: true },
    });
    roomTypeId = roomType.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `hk-admin-${uniq()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "HK",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("completing a CHECKOUT task flips a DIRTY room to CLEAN", async () => {
    const room = await makeRoom("DIRTY");
    const task = await makeTask(room.id, "CHECKOUT");

    const res = await patchTask({ taskId: task.id, status: "COMPLETED" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roomStatusUpdated).toBe(true);

    const after = await prisma.room.findUnique({ where: { id: room.id } });
    expect(after?.status).toBe("CLEAN");
  });

  it("completing a SPECIAL_REQUEST task never touches room status", async () => {
    const room = await makeRoom("DIRTY");
    const task = await makeTask(room.id, "SPECIAL_REQUEST");

    const res = await patchTask({ taskId: task.id, status: "COMPLETED" });
    expect(res.status).toBe(200);
    expect((await res.json()).roomStatusUpdated).toBe(false);

    const after = await prisma.room.findUnique({ where: { id: room.id } });
    expect(after?.status).toBe("DIRTY");
  });

  it("marking a room CLEAN auto-completes its open cleaning tasks but not special requests", async () => {
    const room = await makeRoom("DIRTY");
    const checkoutTask = await makeTask(room.id, "CHECKOUT");
    const specialTask = await makeTask(room.id, "SPECIAL_REQUEST");

    const res = await patchRoom({ roomId: room.id, status: "CLEAN" });
    expect(res.status).toBe(200);

    const checkoutAfter = await prisma.housekeepingTask.findUnique({ where: { id: checkoutTask.id } });
    const specialAfter = await prisma.housekeepingTask.findUnique({ where: { id: specialTask.id } });
    expect(checkoutAfter?.status).toBe("COMPLETED");
    expect(checkoutAfter?.completedAt).not.toBeNull();
    expect(specialAfter?.status).toBe("PENDING");
  });

  it("bulk-marking rooms INSPECTED completes their cleaning tasks", async () => {
    const roomA = await makeRoom("DIRTY");
    const roomB = await makeRoom("DIRTY");
    const taskA = await makeTask(roomA.id, "CHECKOUT");
    const taskB = await makeTask(roomB.id, "CLEANING");

    const res = await patchRoom({ roomIds: [roomA.id, roomB.id], status: "INSPECTED" });
    expect(res.status).toBe(200);

    const tasks = await prisma.housekeepingTask.findMany({ where: { id: { in: [taskA.id, taskB.id] } } });
    expect(tasks.every((t) => t.status === "COMPLETED")).toBe(true);
  });

  it("rejects invalid room and task statuses with 400", async () => {
    const room = await makeRoom("CLEAN");
    const badRoom = await patchRoom({ roomId: room.id, status: "SPARKLING" });
    expect(badRoom.status).toBe(400);

    const task = await makeTask(room.id, "CHECKOUT");
    const badTask = await patchTask({ taskId: task.id, status: "DONE" });
    expect(badTask.status).toBe(400);
  });
});
