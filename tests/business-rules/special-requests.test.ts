import { describe, it, expect, vi } from "vitest";
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
const reservationsRoute = await import("@/app/api/reservations/route");
const reservationRoute = await import("@/app/api/reservations/[id]/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

async function setup() {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: "SpecialReq Test", slug: `test-sr-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `SR-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 3 } });
  await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: "101", status: "AVAILABLE" } });
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "BAR" } });
  await prisma.systemCode.createMany({
    data: [
      { enterpriseId: enterprise.id, category: "SPECIAL_REQUEST", code: "HIGH_FLOOR", value: "High Floor" },
      { enterpriseId: enterprise.id, category: "SPECIAL_REQUEST", code: "EARLY_CHECKIN", value: "Early Check-in" },
      { enterpriseId: enterprise.id, category: "SPECIAL_REQUEST", code: "RETIRED", value: "Retired option", isActive: false },
    ],
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `sr-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "SR", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
    },
  });
  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Req", lastName: "Guest" },
  });
  return { adminId: admin.id, propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, guestId: guest.upid };
}

const reservationBody = (ctx: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown>) => ({
  propertyId: ctx.propertyId,
  primaryGuestId: ctx.guestId,
  checkInDate: "2026-09-01T00:00:00.000Z",
  checkOutDate: "2026-09-03T00:00:00.000Z",
  adults: 2, children: 0, infants: 0, mealPlan: "NONE",
  assignments: [{
    roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, roomId: null,
    startDate: "2026-09-01T00:00:00.000Z", endDate: "2026-09-03T00:00:00.000Z", overrideRate: null,
  }],
  ...extra,
});

describe("Reservation special requests (SPECIAL_REQUEST LOV join rows)", () => {
  it("creates a reservation with special requests, deduped and persisted", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      reservationsRoute.POST(new Request("http://localhost/api/reservations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(reservationBody(ctx, { specialRequestCodes: ["HIGH_FLOOR", "EARLY_CHECKIN", "HIGH_FLOOR"] })),
      }))
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.specialRequests.map((s: { code: string }) => s.code).sort()).toEqual(["EARLY_CHECKIN", "HIGH_FLOOR"]);

    const rows = await prisma.reservationSpecialRequest.findMany({ where: { reservationId: body.id } });
    expect(rows).toHaveLength(2);
  });

  it("rejects unknown and inactive codes", async () => {
    const ctx = await setup();
    for (const code of ["NOT_REAL", "RETIRED"]) {
      const res = await asUser(ctx.adminId, () =>
        reservationsRoute.POST(new Request("http://localhost/api/reservations", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(reservationBody(ctx, { specialRequestCodes: [code] })),
        }))
      );
      expect(res.status).toBe(400);
    }
    expect(await prisma.reservation.count({ where: { propertyId: ctx.propertyId } })).toBe(0);
  });

  it("PUT replaces the set when sent, and leaves it untouched when omitted", async () => {
    const ctx = await setup();
    const created = await asUser(ctx.adminId, () =>
      reservationsRoute.POST(new Request("http://localhost/api/reservations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(reservationBody(ctx, { specialRequestCodes: ["HIGH_FLOOR"] })),
      }))
    ).then(r => r.json());

    // Replace HIGH_FLOOR with EARLY_CHECKIN.
    const put1 = await asUser(ctx.adminId, () =>
      reservationRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(reservationBody(ctx, { specialRequestCodes: ["EARLY_CHECKIN"] })),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(put1.status).toBe(200);
    let rows = await prisma.reservationSpecialRequest.findMany({ where: { reservationId: created.id } });
    expect(rows.map(r => r.code)).toEqual(["EARLY_CHECKIN"]);

    // Omitting the field entirely keeps the existing set (older-client behavior).
    const put2 = await asUser(ctx.adminId, () =>
      reservationRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(reservationBody(ctx, {})),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(put2.status).toBe(200);
    rows = await prisma.reservationSpecialRequest.findMany({ where: { reservationId: created.id } });
    expect(rows.map(r => r.code)).toEqual(["EARLY_CHECKIN"]);
  });

  it("PUT without a status field succeeds (status is lifecycle-managed elsewhere)", async () => {
    const ctx = await setup();
    const created = await asUser(ctx.adminId, () =>
      reservationsRoute.POST(new Request("http://localhost/api/reservations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(reservationBody(ctx, {})),
      }))
    ).then(r => r.json());

    const put = await asUser(ctx.adminId, () =>
      reservationRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(reservationBody(ctx, { remarks: "no status sent" })),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(put.status).toBe(200);
    const updated = await prisma.reservation.findUnique({ where: { id: created.id } });
    expect(updated?.status).toBe("RESERVED");
    expect(updated?.remarks).toBe("no status sent");

    // A status CHANGE attempt is still rejected.
    const putBad = await asUser(ctx.adminId, () =>
      reservationRoute.PUT(
        new Request(`http://localhost/api/reservations/${created.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(reservationBody(ctx, { status: "CHECKED_OUT" })),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(putBad.status).toBe(400);
  });
});
