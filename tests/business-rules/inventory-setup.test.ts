import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Hub › property › Rooms & Inventory (2026-09-24): room type codes unique per property,
// friendly 409s for duplicate room numbers, licence cap + inactive type on room EDIT,
// history-safe transactional deletes of room types / buildings / floors / rooms, and
// re-activating a room type bringing back the rooms its deactivation took out of service.
// Plus the shared list editor: a deleted option can be restored / re-added.

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

const roomTypesRoute = await import("@/app/api/room-types/route");
const roomTypeIdRoute = await import("@/app/api/room-types/[id]/route");
const roomsRoute = await import("@/app/api/rooms/route");
const roomIdRoute = await import("@/app/api/rooms/[id]/route");
const buildingIdRoute = await import("@/app/api/buildings/[id]/route");
const floorIdRoute = await import("@/app/api/floors/[id]/route");
const systemCodesRoute = await import("@/app/api/settings/system-codes/route");

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

let adminId: string;
let enterpriseId: string;

async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(adminId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const json = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makeProperty() {
  const property = await prisma.property.create({
    data: {
      enterpriseId,
      name: "Inventory Setup",
      code: `INV-${uniq()}`,
      legalName: "Inventory Setup LLC",
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      businessDate: new Date(Date.UTC(2026, 8, 1)),
    },
  });
  const building = await prisma.building.create({ data: { propertyId: property.id, name: "Main" } });
  const floor = await prisma.floor.create({ data: { buildingId: building.id, name: "1st" } });
  return { propertyId: property.id, buildingId: building.id, floorId: floor.id };
}

async function bookRoom(propertyId: string, roomTypeId: string, roomId: string | null) {
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: `BAR-${uniq()}`, name: "BAR" } });
  const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G", lastName: "T" } });
  const start = new Date(Date.UTC(2026, 8, 10));
  return prisma.reservation.create({
    data: {
      propertyId,
      confirmationNo: `INV-${uniq()}`,
      primaryGuestId: guest.upid,
      checkInDate: start,
      checkOutDate: new Date(start.getTime() + 2 * DAY),
      status: "CONFIRMED",
      adults: 1,
      children: 0,
      assignments: { create: { roomTypeId, roomId, ratePlanId: ratePlan.id, startDate: start, endDate: new Date(start.getTime() + 2 * DAY) } },
    },
  });
}

beforeAll(async () => {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.upsert({
    where: { slug: "test-inventory-setup" },
    update: {},
    create: { name: "Inventory Setup Ent", slug: "test-inventory-setup", type: "STANDARD" },
  });
  enterpriseId = enterprise.id;
  const admin = await prisma.user.create({
    data: {
      enterpriseId,
      email: `inv-admin-${uniq()}@test.local`,
      passwordHash: await bcrypt.hash("password123", 10),
      firstName: "Admin",
      lastName: "Inv",
      roles: { create: { roleId: roleIds["Admin"] } },
      scope: "ENTERPRISE",
    },
  });
  adminId = admin.id;
});

describe("Room type codes and occupancy", () => {
  it("refuses a duplicate code in the same property with a 409 (case-insensitive), allows it in another", async () => {
    const a = await makeProperty();
    const b = await makeProperty();
    const create = (propertyId: string, code: string) =>
      asAdmin(() => roomTypesRoute.POST(json("/api/room-types", "POST", { propertyId, name: `Type ${code}`, code, maxOccupancy: 2 })));

    expect((await create(a.propertyId, "DLX")).status).toBe(201);
    const dup = await create(a.propertyId, "dlx");
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/DLX.*already used/);
    expect((await create(b.propertyId, "DLX")).status).toBe(201);

    // Renaming another type onto the code is refused too; re-saving a type with its own code is fine.
    const std = await (await create(a.propertyId, "STD")).json();
    const rename = await asAdmin(() =>
      roomTypeIdRoute.PUT(json(`/api/room-types/${std.id}`, "PUT", { name: "Standard", code: "DLX", maxOccupancy: 2 }), ctx(std.id))
    );
    expect(rename.status).toBe(409);
    const same = await asAdmin(() =>
      roomTypeIdRoute.PUT(json(`/api/room-types/${std.id}`, "PUT", { name: "Standard 2", code: "STD", maxOccupancy: 2 }), ctx(std.id))
    );
    expect(same.status).toBe(200);
  });

  it("refuses base occupancy above max occupancy", async () => {
    const { propertyId } = await makeProperty();
    const res = await asAdmin(() =>
      roomTypesRoute.POST(json("/api/room-types", "POST", { propertyId, name: "Twin", code: "TWN", maxOccupancy: 2, baseOccupancy: 3 }))
    );
    expect(res.status).toBe(400);
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Single", code: "SGL", maxOccupancy: 3, baseOccupancy: 3 } });
    // Lowering max below the stored base is caught even when base isn't sent.
    const put = await asAdmin(() =>
      roomTypeIdRoute.PUT(json(`/api/room-types/${rt.id}`, "PUT", { name: "Single", code: "SGL", maxOccupancy: 1 }), ctx(rt.id))
    );
    expect(put.status).toBe(400);
    expect((await put.json()).error).toMatch(/Base occupancy/);
  });
});

describe("Rooms: duplicate numbers, inactive types and the licence cap on edit", () => {
  it("returns a friendly 409 for a duplicate room number on create and edit", async () => {
    const { propertyId, floorId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const post = (roomNumber: string) =>
      asAdmin(() => roomsRoute.POST(json("/api/rooms", "POST", { propertyId, roomTypeId: rt.id, floorId, roomNumber })));

    expect((await post("101")).status).toBe(201);
    const dup = await post(" 101 ");
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/Room 101 already exists/);

    const r102 = await (await post("102")).json();
    const put = await asAdmin(() =>
      roomIdRoute.PUT(json(`/api/rooms/${r102.id}`, "PUT", { roomTypeId: rt.id, floorId, roomNumber: "101" }), ctx(r102.id))
    );
    expect(put.status).toBe(409);
  });

  it("blocks moving a room onto an inactive room type, but lets a room already in one be edited", async () => {
    const { propertyId, floorId } = await makeProperty();
    const active = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const inactive = await prisma.roomType.create({ data: { propertyId, name: "Old", code: "OLD", maxOccupancy: 2, isActive: false } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: active.id, floorId, roomNumber: "201" } });
    const legacy = await prisma.room.create({ data: { propertyId, roomTypeId: inactive.id, floorId, roomNumber: "202" } });

    const move = await asAdmin(() =>
      roomIdRoute.PUT(json(`/api/rooms/${room.id}`, "PUT", { roomTypeId: inactive.id, floorId, roomNumber: "201" }), ctx(room.id))
    );
    expect(move.status).toBe(400);
    expect((await move.json()).error).toMatch(/inactive/i);

    const rename = await asAdmin(() =>
      roomIdRoute.PUT(json(`/api/rooms/${legacy.id}`, "PUT", { roomTypeId: inactive.id, floorId, roomNumber: "202A" }), ctx(legacy.id))
    );
    expect(rename.status).toBe(200);
  });

  it("applies the room licence cap when a room moves from a pseudo type to a real one", async () => {
    const { propertyId, floorId } = await makeProperty();
    const real = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const pm = await prisma.roomType.create({ data: { propertyId, name: "PM", code: "PM", maxOccupancy: 2, isPseudo: true } });
    await prisma.room.create({ data: { propertyId, roomTypeId: real.id, floorId, roomNumber: "301" } });
    const pmRoom = await prisma.room.create({ data: { propertyId, roomTypeId: pm.id, roomNumber: "PM1" } });
    await prisma.propertyLicenseAllowance.create({ data: { propertyId, maxRooms: 1 } });

    const res = await asAdmin(() =>
      roomIdRoute.PUT(json(`/api/rooms/${pmRoom.id}`, "PUT", { roomTypeId: real.id, floorId, roomNumber: "PM1" }), ctx(pmRoom.id))
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/license allows up to 1 room/);

    // Same rule when a whole pseudo type with rooms is switched to a real one.
    const flip = await asAdmin(() =>
      roomTypeIdRoute.PUT(json(`/api/room-types/${pm.id}`, "PUT", { name: "PM", code: "PM", maxOccupancy: 2, isPseudo: false }), ctx(pm.id))
    );
    expect(flip.status).toBe(403);
  });
});

describe("Deletes are history-safe and all-or-nothing", () => {
  it("refuses to delete a room type with reservations and leaves its rooms in place", async () => {
    const { propertyId, floorId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 2 } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId, roomNumber: "401" } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId, roomNumber: "402" } });
    // An unassigned booking (room type only) — the old code deleted the rooms, then the
    // room type delete hit the RESTRICT and 500'd with the rooms already gone.
    await bookRoom(propertyId, rt.id, null);

    const res = await asAdmin(() => roomTypeIdRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx(rt.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/has reservations — make it inactive instead/);
    expect(await prisma.room.count({ where: { roomTypeId: rt.id } })).toBe(2);
    expect(await prisma.roomType.count({ where: { id: rt.id } })).toBe(1);
  });

  it("refuses a room type held by a group block", async () => {
    const { propertyId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Block", code: "BLK", maxOccupancy: 2 } });
    await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `G-${uniq()}`,
        name: "Wedding",
        startDate: new Date(Date.UTC(2026, 9, 1)),
        endDate: new Date(Date.UTC(2026, 9, 3)),
        roomHolds: { create: { roomTypeId: rt.id, quantity: 2 } },
      },
    });
    const res = await asAdmin(() => roomTypeIdRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx(rt.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/group blocks/);
  });

  it("deletes an unused room type together with its rooms", async () => {
    const { propertyId, floorId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Spare", code: "SPR", maxOccupancy: 2 } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId, roomNumber: "501" } });
    const res = await asAdmin(() => roomTypeIdRoute.DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx(rt.id)));
    expect(res.status).toBe(204);
    expect(await prisma.room.count({ where: { roomTypeId: rt.id } })).toBe(0);
  });

  it("refuses to delete a booked room, and a floor/building containing one; deletes empty ones", async () => {
    const { propertyId, buildingId, floorId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const booked = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId, roomNumber: "601" } });
    await bookRoom(propertyId, rt.id, booked.id);

    const del = (route: { DELETE: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> }, id: string) =>
      asAdmin(() => route.DELETE(new Request("http://localhost/x", { method: "DELETE" }), ctx(id)));

    const roomRes = await del(roomIdRoute, booked.id);
    expect(roomRes.status).toBe(409);
    expect((await roomRes.json()).error).toMatch(/Room 601 has reservations — set it Out of Service instead/);

    const floorRes = await del(floorIdRoute, floorId);
    expect(floorRes.status).toBe(409);
    expect((await floorRes.json()).error).toMatch(/601/);

    const buildingRes = await del(buildingIdRoute, buildingId);
    expect(buildingRes.status).toBe(409);
    expect(await prisma.room.count({ where: { id: booked.id } })).toBe(1);
    expect(await prisma.floor.count({ where: { id: floorId } })).toBe(1);

    // An empty floor/building with an unbooked room goes, room and all.
    const spareBuilding = await prisma.building.create({ data: { propertyId, name: "Annex" } });
    const spareFloor = await prisma.floor.create({ data: { buildingId: spareBuilding.id, name: "G" } });
    const spareRoom = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId: spareFloor.id, roomNumber: "A1" } });
    expect((await del(buildingIdRoute, spareBuilding.id)).status).toBe(204);
    expect(await prisma.room.count({ where: { id: spareRoom.id } })).toBe(0);
    expect(await prisma.floor.count({ where: { id: spareFloor.id } })).toBe(0);
  });
});

describe("Re-activating a room type restores the rooms its deactivation took out of service", () => {
  it("restores CLEAN→DIRTY and OUT_OF_ORDER→OUT_OF_ORDER, leaves unrelated OOS rooms and manual changes alone", async () => {
    const { propertyId, floorId } = await makeProperty();
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Villa", code: "VIL", maxOccupancy: 2 } });
    const mk = (roomNumber: string, status: string) =>
      prisma.room.create({ data: { propertyId, roomTypeId: rt.id, floorId, roomNumber, status } });
    const clean = await mk("V1", "CLEAN");
    const ooo = await mk("V2", "OUT_OF_ORDER");
    const alreadyOos = await mk("V3", "OUT_OF_SERVICE");
    const manual = await mk("V4", "INSPECTED");

    const put = (isActive: boolean) =>
      asAdmin(() =>
        roomTypeIdRoute.PUT(json(`/api/room-types/${rt.id}`, "PUT", { name: "Villa", code: "VIL", maxOccupancy: 2, isActive }), ctx(rt.id))
      );

    expect((await put(false)).status).toBe(200);
    const after = await prisma.room.findMany({ where: { roomTypeId: rt.id } });
    expect(after.every((r) => r.status === "OUT_OF_SERVICE")).toBe(true);
    expect(after.find((r) => r.id === alreadyOos.id)?.statusBeforeTypeDeactivation).toBeNull();

    // Someone manually changes V4 while the type is inactive — it is no longer "OOS because
    // of the deactivation", so re-activation must not touch it.
    const patch = await asAdmin(() =>
      roomsRoute.PATCH(json("/api/rooms", "PATCH", { id: manual.id, status: "OUT_OF_SERVICE" }))
    );
    expect(patch.status).toBe(200);

    const res = await put(true);
    expect(res.status).toBe(200);
    expect((await res.json()).restoredRooms).toBe(2);

    const byId = new Map((await prisma.room.findMany({ where: { roomTypeId: rt.id } })).map((r) => [r.id, r]));
    expect(byId.get(clean.id)?.status).toBe("DIRTY");
    expect(byId.get(ooo.id)?.status).toBe("OUT_OF_ORDER");
    expect(byId.get(alreadyOos.id)?.status).toBe("OUT_OF_SERVICE");
    expect(byId.get(manual.id)?.status).toBe("OUT_OF_SERVICE");
    expect([...byId.values()].every((r) => r.statusBeforeTypeDeactivation === null)).toBe(true);
  });
});

describe("Shared list editor: deleted options can come back", () => {
  it("re-adding a deleted code restores it; an active duplicate is still refused", async () => {
    const { propertyId } = await makeProperty();
    const post = (code: string, value: string) =>
      asAdmin(() =>
        systemCodesRoute.POST(json("/api/settings/system-codes", "POST", { category: "ROOM_VIEW", propertyId, code, value, sortOrder: 1 }))
      );

    const created = await (await post("SEA", "Sea view")).json();
    expect((await post("SEA", "Again")).status).toBe(400);

    // Delete = switch off.
    const off = await asAdmin(() => systemCodesRoute.PUT(json("/api/settings/system-codes", "PUT", { id: created.id, isActive: false })));
    expect(off.status).toBe(200);

    // The manager sees it with includeInactive=1; pickers don't.
    const list = (inactive: boolean) =>
      asAdmin(async () =>
        (await systemCodesRoute.GET(
          new Request(`http://localhost/api/settings/system-codes?category=ROOM_VIEW&propertyId=${propertyId}${inactive ? "&includeInactive=1" : ""}`)
        )).json()
      );
    expect((await list(false)).map((c: { code: string }) => c.code)).not.toContain("SEA");
    expect((await list(true)).find((c: { code: string }) => c.code === "SEA")?.isActive).toBe(false);

    const again = await post("SEA", "Ocean view");
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.restored).toBe(true);
    expect(body.id).toBe(created.id);
    expect(body.value).toBe("Ocean view");
    expect(body.isActive).toBe(true);
  });
});
