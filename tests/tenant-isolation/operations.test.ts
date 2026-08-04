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
const housekeepingMaintenanceRoute = await import("@/app/api/housekeeping/maintenance/route");
const housekeepingTasksRoute = await import("@/app/api/housekeeping/tasks/route");
const maintenanceRoute = await import("@/app/api/maintenance/route");
const maintenanceIdRoute = await import("@/app/api/maintenance/[id]/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Phase 5 tenant isolation: housekeeping & maintenance", () => {
  let propertyAId: string;
  let propertyBId: string;
  let roomAId: string;
  let roomA2Id: string;
  let roomBId: string;
  let roomANoHKId: string; // room whose RoomType has housekeepingEnabled: false
  let adminAId: string;
  let noPermAId: string; // Reservations role — no HOUSEKEEPING/MAINTENANCE permission
  let attendantAId: string; // Housekeeping-role user in enterprise A
  let attendantBId: string; // Housekeeping-role user in enterprise B

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-p5-enterprise-a" },
      update: {},
      create: { name: "P5 Enterprise A", slug: "test-p5-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-p5-enterprise-b" },
      update: {},
      create: { name: "P5 Enterprise B", slug: "test-p5-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "P5 Property A", code: `P5PA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "P5 Property B", code: `P5PB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const buildingA = await prisma.building.create({ data: { propertyId: propertyAId, name: "Main" } });
    const floorA = await prisma.floor.create({ data: { buildingId: buildingA.id, name: "1" } });
    const buildingB = await prisma.building.create({ data: { propertyId: propertyBId, name: "Main" } });
    const floorB = await prisma.floor.create({ data: { buildingId: buildingB.id, name: "1" } });

    const roomTypeA = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    const roomTypeB = await prisma.roomType.create({
      data: { propertyId: propertyBId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });

    const roomA = await prisma.room.create({
      data: { propertyId: propertyAId, roomTypeId: roomTypeA.id, floorId: floorA.id, roomNumber: "101" },
    });
    roomAId = roomA.id;
    const roomA2 = await prisma.room.create({
      data: { propertyId: propertyAId, roomTypeId: roomTypeA.id, floorId: floorA.id, roomNumber: "102" },
    });
    roomA2Id = roomA2.id;
    const roomB = await prisma.room.create({
      data: { propertyId: propertyBId, roomTypeId: roomTypeB.id, floorId: floorB.id, roomNumber: "201" },
    });
    roomBId = roomB.id;

    const roomTypeANoHK = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "No Housekeeping", code: "NOHK", maxOccupancy: 2, housekeepingEnabled: false },
    });
    const roomANoHK = await prisma.room.create({
      data: { propertyId: propertyAId, roomTypeId: roomTypeANoHK.id, floorId: floorA.id, roomNumber: "103" },
    });
    roomANoHKId = roomANoHK.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p5-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const noPermA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p5-nohk-a-${Date.now()}@test.local`, passwordHash,
        firstName: "NoHousekeeping", lastName: "A", roles: { create: { roleId: roleIds["Reservations"] } }, scope: "ENTERPRISE",
      },
    });
    noPermAId = noPermA.id;

    const attendantA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p5-attendant-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Attendant", lastName: "A", roles: { create: { roleId: roleIds["Housekeeping"] } }, scope: "ENTERPRISE",
      },
    });
    attendantAId = attendantA.id;

    const attendantB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `p5-attendant-b-${Date.now()}@test.local`, passwordHash,
        firstName: "Attendant", lastName: "B", roles: { create: { roleId: roleIds["Housekeeping"] } }, scope: "ENTERPRISE",
      },
    });
    attendantBId = attendantB.id;
  });

  // --- /api/housekeeping ---

  it("GET /api/housekeeping 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.GET(new Request(`http://localhost/api/housekeeping?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/housekeeping succeeds for the actor's own property", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.GET(new Request(`http://localhost/api/housekeeping?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((r: any) => r.id)).toContain(roomAId);
  });

  it("PATCH /api/housekeeping 403s for a role without HOUSEKEEPING permission", async () => {
    const res = await asUser(noPermAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, status: "DIRTY" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/housekeeping (single room) 403s when the room belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomBId, status: "DIRTY" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/housekeeping (single room) succeeds for the actor's own room", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, status: "DIRTY" }),
        })
      )
    );
    expect(res.status).toBe(200);
  });

  it("PATCH /api/housekeeping (bulk) 403s when one roomId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomIds: [roomAId, roomBId], status: "CLEAN" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/housekeeping rejects assigning an attendant from a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, assignedAttendantId: attendantBId }),
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it("PATCH /api/housekeeping succeeds assigning an attendant from the same enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.PATCH(
        new Request("http://localhost/api/housekeeping", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, assignedAttendantId: attendantAId }),
        })
      )
    );
    expect(res.status).toBe(200);
  });

  // --- /api/housekeeping/maintenance ---

  it("POST /api/housekeeping/maintenance 403s when one roomId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingMaintenanceRoute.POST(
        new Request("http://localhost/api/housekeeping/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomIds: [roomAId, roomBId], issueType: "HVAC", description: "AC broken" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/housekeeping/maintenance succeeds for the actor's own rooms", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingMaintenanceRoute.POST(
        new Request("http://localhost/api/housekeeping/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomIds: [roomAId, roomA2Id], issueType: "HVAC", description: "AC broken" }),
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
  });

  // --- /api/housekeeping/tasks ---

  it("POST /api/housekeeping/tasks 403s when roomId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingTasksRoute.POST(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomBId, notes: "Extra towels" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/housekeeping/tasks succeeds and PATCH completes it for the same enterprise", async () => {
    const createRes = await asUser(adminAId, () =>
      housekeepingTasksRoute.POST(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, notes: "Extra towels" }),
        })
      )
    );
    expect(createRes.status).toBe(201);
    const task = await createRes.json();

    const patchRes = await asUser(adminAId, () =>
      housekeepingTasksRoute.PATCH(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: task.id, status: "COMPLETED" }),
        })
      )
    );
    expect(patchRes.status).toBe(200);
  });

  it("PATCH /api/housekeeping/tasks 403s against a different enterprise's task", async () => {
    const foreignTask = await prisma.housekeepingTask.create({
      data: { roomId: roomBId, taskType: "SPECIAL_REQUEST", notes: "Foreign task" },
    });
    const res = await asUser(adminAId, () =>
      housekeepingTasksRoute.PATCH(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: foreignTask.id, status: "COMPLETED" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  // --- /api/maintenance ---

  it("GET /api/maintenance requires propertyId — an omitted filter can no longer leak every enterprise's rows", async () => {
    const res = await asUser(adminAId, () =>
      maintenanceRoute.GET(new Request("http://localhost/api/maintenance"))
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/maintenance 403s when propertyId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      maintenanceRoute.GET(new Request(`http://localhost/api/maintenance?propertyId=${propertyBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/maintenance 403s when roomId belongs to a different enterprise", async () => {
    const res = await asUser(adminAId, () =>
      maintenanceRoute.POST(
        new Request("http://localhost/api/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomBId, description: "Leaking faucet" }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/maintenance succeeds for the actor's own room; GET then returns only that enterprise's rows", async () => {
    const postRes = await asUser(adminAId, () =>
      maintenanceRoute.POST(
        new Request("http://localhost/api/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomAId, description: "Leaking faucet" }),
        })
      )
    );
    expect(postRes.status).toBe(201);

    const getRes = await asUser(adminAId, () =>
      maintenanceRoute.GET(new Request(`http://localhost/api/maintenance?propertyId=${propertyAId}`))
    );
    expect(getRes.status).toBe(200);
    const rows = await getRes.json();
    expect(rows.every((r: any) => r.room.propertyId === propertyAId)).toBe(true);
  });

  // The body-based collection PATCH/DELETE were removed when the maintenance API
  // was unified onto the RESTful [id] route — same isolation guarantees, new shape.
  it("PATCH /api/maintenance/[id] (full fields) 403s against a different enterprise's ticket", async () => {
    const foreignTicket = await prisma.roomMaintenance.create({
      data: { roomId: roomBId, description: "Foreign ticket" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${foreignTicket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "RESOLVED", priority: "HIGH" }),
        }),
        { params: Promise.resolve({ id: foreignTicket.id }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/maintenance/[id] (full fields) succeeds for the actor's own ticket", async () => {
    const ticket = await prisma.roomMaintenance.create({
      data: { roomId: roomAId, description: "Squeaky door" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "RESOLVED", priority: "HIGH", description: "Squeaky door - fixed" }),
        }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priority).toBe("HIGH");
    expect(body.description).toBe("Squeaky door - fixed");
  });

  it("PATCH /api/maintenance/[id] rejects invalid status/priority with 400", async () => {
    const ticket = await prisma.roomMaintenance.create({
      data: { roomId: roomAId, description: "Validation target" },
    });
    const badStatus = await asUser(adminAId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "DONE" }),
        }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(badStatus.status).toBe(400);
  });

  it("DELETE /api/maintenance/[id] 403s against a different enterprise's ticket", async () => {
    const foreignTicket = await prisma.roomMaintenance.create({
      data: { roomId: roomBId, description: "Foreign ticket to delete" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.DELETE(
        new Request(`http://localhost/api/maintenance/${foreignTicket.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: foreignTicket.id }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/maintenance/[id] succeeds for the actor's own ticket", async () => {
    const ticket = await prisma.roomMaintenance.create({
      data: { roomId: roomAId, description: "To be deleted" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.DELETE(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(res.status).toBe(200);
  });

  // --- /api/maintenance/[id] ---

  it("PATCH /api/maintenance/[id] 403s against a different enterprise's ticket", async () => {
    const foreignTicket = await prisma.roomMaintenance.create({
      data: { roomId: roomBId, description: "Foreign ticket" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${foreignTicket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "RESOLVED" }),
        }),
        { params: Promise.resolve({ id: foreignTicket.id }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("PATCH /api/maintenance/[id] succeeds for the actor's own ticket", async () => {
    const ticket = await prisma.roomMaintenance.create({
      data: { roomId: roomAId, description: "Own ticket" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.PATCH(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "RESOLVED" }),
        }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(res.status).toBe(200);
  });

  it("DELETE /api/maintenance/[id] 403s against a different enterprise's ticket", async () => {
    const foreignTicket = await prisma.roomMaintenance.create({
      data: { roomId: roomBId, description: "Foreign ticket" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.DELETE(
        new Request(`http://localhost/api/maintenance/${foreignTicket.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: foreignTicket.id }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /api/maintenance/[id] succeeds for the actor's own ticket", async () => {
    const ticket = await prisma.roomMaintenance.create({
      data: { roomId: roomAId, description: "Own ticket to delete" },
    });
    const res = await asUser(adminAId, () =>
      maintenanceIdRoute.DELETE(
        new Request(`http://localhost/api/maintenance/${ticket.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: ticket.id }) }
      )
    );
    expect(res.status).toBe(200);
  });

  // --- RoomType.housekeepingEnabled: rooms of such a type shouldn't present
  // housekeeping/maintenance workflows ---

  it("GET /api/housekeeping excludes rooms whose room type has housekeepingEnabled: false", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingRoute.GET(new Request(`http://localhost/api/housekeeping?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((r: any) => r.id)).not.toContain(roomANoHKId);
  });

  it("POST /api/housekeeping/tasks 400s for a room whose room type has housekeepingEnabled: false", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingTasksRoute.POST(
        new Request("http://localhost/api/housekeeping/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomANoHKId, notes: "Extra towels" }),
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/housekeeping/maintenance 400s when one room's type has housekeepingEnabled: false", async () => {
    const res = await asUser(adminAId, () =>
      housekeepingMaintenanceRoute.POST(
        new Request("http://localhost/api/housekeeping/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomIds: [roomAId, roomANoHKId], issueType: "HVAC", description: "AC broken" }),
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/maintenance 400s for a room whose room type has housekeepingEnabled: false", async () => {
    const res = await asUser(adminAId, () =>
      maintenanceRoute.POST(
        new Request("http://localhost/api/maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roomId: roomANoHKId, description: "Leaking faucet" }),
        })
      )
    );
    expect(res.status).toBe(400);
  });
});
