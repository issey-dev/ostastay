import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const roomMoveRoute = await import("@/app/api/reservations/[id]/room-move/route");
const reassignRoute = await import("@/app/api/reservations/assignments/[id]/reassign/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const key = (x: Date) => x.toISOString().slice(0, 10);

describe("Moving a guest who has several room segments", () => {
  let propertyId: string;
  let adminId: string;
  let typeId: string;
  let ratePlanId: string;
  let guestId: string;
  const rooms: Record<string, string> = {};

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "RM", slug: `test-rm-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id, name: "P", code: `RM-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00", businessDate: d("2026-08-03"),
      },
    });
    propertyId = property.id;
    const type = await prisma.roomType.create({ data: { propertyId, code: "DLX", name: "Deluxe", maxOccupancy: 3, baseOccupancy: 2 } });
    typeId = type.id;
    for (const n of ["101", "102", "103", "104"]) rooms[n] = (await prisma.room.create({ data: { propertyId, roomTypeId: typeId, roomNumber: n } })).id;
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR", priority: 1 } })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId: enterprise.id, firstName: "Seg", lastName: "Guest" } })).upid;
    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id, email: `rm-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "RM", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  // In house since 1 Aug; today is 3 Aug. Segment 1: 1-5 Aug in room 101; segment 2: 5-8 Aug in room 102.
  const makeStay = async () => {
    const res = await prisma.reservation.create({
      data: { propertyId, confirmationNo: `RM-${uniq()}`, primaryGuestId: guestId, checkInDate: d("2026-08-01"), checkOutDate: d("2026-08-08"), adults: 1, status: "IN_HOUSE", checkedInAt: new Date() },
    });
    const a1 = await prisma.roomAssignment.create({ data: { reservationId: res.id, roomTypeId: typeId, roomId: rooms["101"], ratePlanId, startDate: d("2026-08-01"), endDate: d("2026-08-05") } });
    const a2 = await prisma.roomAssignment.create({ data: { reservationId: res.id, roomTypeId: typeId, roomId: rooms["102"], ratePlanId, startDate: d("2026-08-05"), endDate: d("2026-08-08") } });
    return { res, a1, a2 };
  };

  it("moves only today's segment and leaves the later booked segment alone", async () => {
    const { res, a2 } = await makeStay();
    const out = await asUser(adminId, () =>
      roomMoveRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newRoomId: rooms["103"], newRoomTypeId: typeId, reason: "A/C" }) }), { params: Promise.resolve({ id: res.id }) })
    );
    expect(out.status).toBe(200);
    const segs = (await prisma.roomAssignment.findMany({ where: { reservationId: res.id }, orderBy: { startDate: "asc" } })).map((s) => ({ from: key(s.startDate), to: key(s.endDate), room: s.roomId }));
    expect(segs).toEqual([
      { from: "2026-08-01", to: "2026-08-03", room: rooms["101"] }, // the nights already spent
      { from: "2026-08-03", to: "2026-08-05", room: rooms["103"] }, // today until where that segment ended
      { from: "2026-08-05", to: "2026-08-08", room: rooms["102"] }, // the later booked segment, untouched
    ]);
    expect((await prisma.roomAssignment.findUniqueOrThrow({ where: { id: a2.id } })).roomId).toBe(rooms["102"]);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).hasScheduledRoomMove).toBe(true);
  });

  it("refuses a room that is taken during the part of the stay being moved", async () => {
    const { res } = await makeStay();
    const other = await prisma.reservation.create({
      data: { propertyId, confirmationNo: `RM-${uniq()}`, primaryGuestId: guestId, checkInDate: d("2026-08-04"), checkOutDate: d("2026-08-06"), adults: 1, status: "RESERVED" },
    });
    await prisma.roomAssignment.create({ data: { reservationId: other.id, roomTypeId: typeId, roomId: rooms["104"], ratePlanId, startDate: d("2026-08-04"), endDate: d("2026-08-06") } });
    const out = await asUser(adminId, () =>
      roomMoveRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newRoomId: rooms["104"], newRoomTypeId: typeId, reason: "x" }) }), { params: Promise.resolve({ id: res.id }) })
    );
    expect(out.status).toBe(409);
  });

  it("a Tape Chart reassignment of one segment changes only that segment and refreshes the room-move flag", async () => {
    const res = await prisma.reservation.create({
      data: { propertyId, confirmationNo: `RM-${uniq()}`, primaryGuestId: guestId, checkInDate: d("2026-09-01"), checkOutDate: d("2026-09-06"), adults: 1, status: "RESERVED", hasScheduledRoomMove: false },
    });
    const a1 = await prisma.roomAssignment.create({ data: { reservationId: res.id, roomTypeId: typeId, roomId: rooms["101"], ratePlanId, startDate: d("2026-09-01"), endDate: d("2026-09-03") } });
    const a2 = await prisma.roomAssignment.create({ data: { reservationId: res.id, roomTypeId: typeId, roomId: rooms["101"], ratePlanId, startDate: d("2026-09-03"), endDate: d("2026-09-06") } });
    const out = await asUser(adminId, () =>
      reassignRoute.PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: rooms["102"] }) }), { params: Promise.resolve({ id: a2.id }) })
    );
    expect(out.status).toBe(200);
    expect((await prisma.roomAssignment.findUniqueOrThrow({ where: { id: a1.id } })).roomId).toBe(rooms["101"]);
    expect((await prisma.roomAssignment.findUniqueOrThrow({ where: { id: a2.id } })).roomId).toBe(rooms["102"]);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: res.id } })).hasScheduledRoomMove).toBe(true);
  });
});
