import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/tenant-isolation/booking.test.ts — lets the
// real route handlers' calls into src/lib/scope.ts run under Vitest.
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
const { assignmentsAreContiguous, detectScheduledRoomMove } = await import("@/lib/reservation-assignments");

const reservationsRoute = await import("@/app/api/reservations/route");
const reservationDetailRoute = await import("@/app/api/reservations/[id]/route");

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
// The real client always sends full ISO datetime strings for assignment dates (see
// booking-form.tsx's handleSubmit) — POST passes body.assignments straight into
// Prisma's nested create without a `new Date()` wrap, so a plain "yyyy-MM-dd" string
// is rejected as an incomplete ISO-8601 DateTime. Match that shape here.
const iso = (d: string) => new Date(d).toISOString();

describe("assignmentsAreContiguous / detectScheduledRoomMove (src/lib/reservation-assignments.ts)", () => {
  it("a single segment is trivially contiguous", () => {
    expect(assignmentsAreContiguous([{ startDate: "2026-08-01", endDate: "2026-08-03" }])).toBe(true);
  });

  it("back-to-back segments (next start === prev end) are contiguous", () => {
    expect(assignmentsAreContiguous([
      { startDate: "2026-08-01", endDate: "2026-08-03" },
      { startDate: "2026-08-03", endDate: "2026-08-05" },
    ])).toBe(true);
  });

  it("a gap between segments is not contiguous", () => {
    expect(assignmentsAreContiguous([
      { startDate: "2026-08-01", endDate: "2026-08-03" },
      { startDate: "2026-08-04", endDate: "2026-08-06" },
    ])).toBe(false);
  });

  it("detects a room move only when both adjacent rooms are set and differ", () => {
    expect(detectScheduledRoomMove([
      { startDate: "2026-08-01", endDate: "2026-08-03", roomId: "A" },
      { startDate: "2026-08-03", endDate: "2026-08-05", roomId: "B" },
    ])).toBe(true);
    expect(detectScheduledRoomMove([
      { startDate: "2026-08-01", endDate: "2026-08-03", roomId: "A" },
      { startDate: "2026-08-03", endDate: "2026-08-05", roomId: "A" },
    ])).toBe(false);
    expect(detectScheduledRoomMove([
      { startDate: "2026-08-01", endDate: "2026-08-03", roomId: null },
      { startDate: "2026-08-03", endDate: "2026-08-05", roomId: "B" },
    ])).toBe(false);
  });
});

describe("Reservation API: segment contiguity, scheduled room move, accompanying-guest cap", () => {
  let propertyId: string;
  let adminId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let roomAId: string;
  let roomBId: string;
  let guestId: string;
  let accompanyingId1: string;
  let accompanyingId2: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Segments Test", slug: `test-segments-${uniq()}`, type: "STANDARD" },
    });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id, name: "P", code: `SEG-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      // Pinned so the arrival floor (createReservation) is deterministic rather than
      // measured against the real wall-clock date.
      businessDate: new Date(Date.UTC(2026, 0, 1)),
      },
    });
    propertyId = property.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", baseOccupancy: 2, maxOccupancy: 4 },
    });
    roomTypeId = roomType.id;

    const roomA = await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: `A${Math.floor(Math.random() * 9000 + 1000)}` } });
    roomAId = roomA.id;
    const roomB = await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: `B${Math.floor(Math.random() * 9000 + 1000)}` } });
    roomBId = roomB.id;

    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    ratePlanId = ratePlan.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id,
        email: `seg-admin-${uniq()}@test.local`,
        passwordHash, firstName: "Admin", lastName: "Seg",
        roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Primary", lastName: "Guest" } });
    guestId = guest.upid;
    const accompanying1 = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Plus", lastName: "One" } });
    accompanyingId1 = accompanying1.upid;
    const accompanying2 = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Plus", lastName: "Two" } });
    accompanyingId2 = accompanying2.upid;
  });

  it("POST rejects split-stay segments that leave a gap between them", async () => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId,
            checkInDate: "2026-08-01", checkOutDate: "2026-08-06",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: "2026-08-01", endDate: "2026-08-03" },
              { roomTypeId, ratePlanId, roomId: roomBId, startDate: "2026-08-04", endDate: "2026-08-06" },
            ],
          }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/back-to-back/i);
  });

  it("POST tags hasScheduledRoomMove=true when contiguous segments use different rooms", async () => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId,
            checkInDate: "2026-08-01", checkOutDate: "2026-08-05",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-08-01"), endDate: iso("2026-08-03") },
              { roomTypeId, ratePlanId, roomId: roomBId, startDate: iso("2026-08-03"), endDate: iso("2026-08-05") },
            ],
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasScheduledRoomMove).toBe(true);
  });

  it("POST leaves hasScheduledRoomMove=false when segments reuse the same room", async () => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId,
            checkInDate: "2026-09-01", checkOutDate: "2026-09-05",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-09-01"), endDate: iso("2026-09-03") },
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-09-03"), endDate: iso("2026-09-05") },
            ],
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasScheduledRoomMove).toBe(false);
  });

  it("POST rejects accompanying guests beyond adults + children - 1", async () => {
    const res = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId,
            checkInDate: "2026-10-01", checkOutDate: "2026-10-03",
            adults: 2, children: 0, // pax = 2, minus primary's own slot -> max 1 accompanying
            accompanyingGuestIds: [accompanyingId1, accompanyingId2],
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: "2026-10-01", endDate: "2026-10-03" },
            ],
          }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/accompanying guest/i);
  });

  it("PUT re-validates contiguity and recomputes hasScheduledRoomMove", async () => {
    const createRes = await asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, primaryGuestId: guestId,
            checkInDate: "2026-11-01", checkOutDate: "2026-11-03",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-11-01"), endDate: iso("2026-11-03") },
            ],
          }),
        })
      )
    );
    const created = await createRes.json();
    expect(created.hasScheduledRoomMove).toBe(false);

    // Editing in a gapped second segment must 400.
    const gappedRes = await asUser(adminId, () =>
      reservationDetailRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primaryGuestId: guestId,
            checkInDate: "2026-11-01", checkOutDate: "2026-11-06",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-11-01"), endDate: iso("2026-11-03") },
              { roomTypeId, ratePlanId, roomId: roomBId, startDate: iso("2026-11-04"), endDate: iso("2026-11-06") },
            ],
          }),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(gappedRes.status).toBe(400);

    // A contiguous edit with a different room on segment 2 must tag the move.
    const fixedRes = await asUser(adminId, () =>
      reservationDetailRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primaryGuestId: guestId,
            checkInDate: "2026-11-01", checkOutDate: "2026-11-05",
            adults: 1, children: 0,
            assignments: [
              { roomTypeId, ratePlanId, roomId: roomAId, startDate: iso("2026-11-01"), endDate: iso("2026-11-03") },
              { roomTypeId, ratePlanId, roomId: roomBId, startDate: iso("2026-11-03"), endDate: iso("2026-11-05") },
            ],
          }),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(fixedRes.status).toBe(200);
    const updated = await fixedRes.json();
    expect(updated.hasScheduledRoomMove).toBe(true);
  });
});
