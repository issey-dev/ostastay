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
const availabilityRoute = await import("@/app/api/availability/route");
const restrictionsRoute = await import("@/app/api/availability/restrictions/route");
const reservationsRoute = await import("@/app/api/reservations/route");

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

// One property, room type STD (2 rooms), a BASE rate plan, an admin, and a guest.
async function setup() {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: "Avail Test", slug: `test-av-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `AV-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const std = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", baseOccupancy: 2, maxOccupancy: 3 } });
  await prisma.room.createMany({
    data: [
      { propertyId: property.id, roomTypeId: std.id, roomNumber: "101", status: "AVAILABLE" },
      { propertyId: property.id, roomTypeId: std.id, roomNumber: "102", status: "AVAILABLE" },
    ],
  });
  const basePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BASE", name: "Base Rate", isLocked: true, priority: 999 } });

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `av-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "AV", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Av", lastName: "Guest" },
  });

  return { adminId: admin.id, propertyId: property.id, stdId: std.id, basePlanId: basePlan.id, guestUpid: guest.upid };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const setRestriction = (method: "POST" | "DELETE", body: object): Promise<Response> => {
  const req = new Request("http://localhost/api/availability/restrictions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return method === "POST" ? restrictionsRoute.POST(req) : restrictionsRoute.DELETE(req);
};

const book = (ctx: Ctx, body: object) =>
  reservationsRoute.POST(
    new Request("http://localhost/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: ctx.propertyId,
        primaryGuestId: ctx.guestUpid,
        roomTypeId: ctx.stdId,
        ratePlanId: ctx.basePlanId,
        adults: 2,
        children: 0,
        ...body,
      }),
    })
  );

const grid = (ctx: Ctx, params: Record<string, string>) =>
  availabilityRoute.GET(
    new Request(
      `http://localhost/api/availability?${new URLSearchParams({ propertyId: ctx.propertyId, ...params }).toString()}`
    )
  );

describe("Availability grid + Stop Sale restrictions", () => {
  it("hard-blocks a booking whose night is closed for its room type, and permits it once reopened", async () => {
    const ctx = await setup();
    // Close STD on Aug 2 (a night of an Aug 1→3 stay).
    const closeRes = await asUser(ctx.adminId, () =>
      setRestriction("POST", { propertyId: ctx.propertyId, roomTypeIds: [ctx.stdId], startDate: "2026-08-02" })
    );
    expect(closeRes.status).toBe(200);

    const blocked = await asUser(ctx.adminId, () =>
      book(ctx, { checkInDate: "2026-08-01", checkOutDate: "2026-08-03" })
    );
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/Stop Sale/i);

    // Reopen and confirm the same booking now succeeds.
    await asUser(ctx.adminId, () =>
      setRestriction("DELETE", { propertyId: ctx.propertyId, roomTypeIds: [ctx.stdId], startDate: "2026-08-02" })
    );
    const ok = await asUser(ctx.adminId, () =>
      book(ctx, { checkInDate: "2026-08-01", checkOutDate: "2026-08-03" })
    );
    expect(ok.status).toBe(201);
  });

  it("blocks a booking on a property-wide closure", async () => {
    const ctx = await setup();
    await asUser(ctx.adminId, () =>
      setRestriction("POST", { propertyId: ctx.propertyId, startDate: "2026-08-01" })
    );
    const blocked = await asUser(ctx.adminId, () =>
      book(ctx, { checkInDate: "2026-08-01", checkOutDate: "2026-08-03" })
    );
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/property-wide/i);
  });

  it("does not block when only the checkout date is closed (departure day is not a night)", async () => {
    const ctx = await setup();
    await asUser(ctx.adminId, () =>
      setRestriction("POST", { propertyId: ctx.propertyId, roomTypeIds: [ctx.stdId], startDate: "2026-08-03" })
    );
    const ok = await asUser(ctx.adminId, () =>
      book(ctx, { checkInDate: "2026-08-01", checkOutDate: "2026-08-03" })
    );
    expect(ok.status).toBe(201);
  });

  it("reports availability, occupancy, arrivals/departures, pax, and closed flags per cell", async () => {
    const ctx = await setup();
    // One reservation: STD, Aug 1→3, 2 adults + 1 child.
    await asUser(ctx.adminId, () =>
      book(ctx, { checkInDate: "2026-08-01", checkOutDate: "2026-08-03", adults: 2, children: 1 })
    );
    // Close STD on Aug 4.
    await asUser(ctx.adminId, () =>
      setRestriction("POST", { propertyId: ctx.propertyId, roomTypeIds: [ctx.stdId], startDate: "2026-08-04" })
    );

    const res = await asUser(ctx.adminId, () => grid(ctx, { startDate: "2026-08-01", days: "4" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.rows.find((r: { roomTypeId: string }) => r.roomTypeId === ctx.stdId);
    // Columns: Aug 1,2,3,4.
    // Aug 1 (index 0): occupied 1 room, available 1, arrival 1, 2 adults / 1 child.
    expect(row.cells[0].occupancy).toBe(1);
    expect(row.cells[0].available).toBe(1);
    expect(row.cells[0].arrivals).toBe(1);
    expect(row.cells[0].adults).toBe(2);
    expect(row.cells[0].children).toBe(1);
    // Aug 3 (index 2): guest departs, no longer in-house — departure counted, back to 2 available.
    expect(row.cells[2].departures).toBe(1);
    expect(row.cells[2].occupancy).toBe(0);
    expect(row.cells[2].available).toBe(2);
    // Aug 4 (index 3): closed flag set.
    expect(row.cells[3].closed).toBe(true);
    // House mirrors the single room type's totals.
    expect(body.house.cells[0].occupancy).toBe(1);
    expect(body.house.capacity).toBe(2);
  });

  it("counts a DEFINITE group block against availability and reports it under Group Blocks", async () => {
    const ctx = await setup();
    // DEFINITE block holding 1 STD room for the nights of Aug 1-2 (endDate exclusive).
    await prisma.groupBlock.create({
      data: {
        propertyId: ctx.propertyId, code: `B-${uniq()}`, name: "Def",
        startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 3)),
        totalRoomsHeld: 1, status: "DEFINITE",
        roomHolds: { create: [{ roomTypeId: ctx.stdId, quantity: 1 }] },
      },
    });

    const res = await asUser(ctx.adminId, () => grid(ctx, { startDate: "2026-08-01", days: "3" }));
    const body = await res.json();
    const row = body.rows.find((r: { roomTypeId: string }) => r.roomTypeId === ctx.stdId);
    // Aug 1-2: 1 held → available 1, Group Blocks 1.
    expect(row.cells[0].groupBlocks).toBe(1);
    expect(row.cells[0].available).toBe(1);
    // Aug 3: block endDate is exclusive, so nothing held that night.
    expect(row.cells[2].groupBlocks).toBe(0);
    expect(row.cells[2].available).toBe(2);
    // House reflects the hold too.
    expect(body.house.cells[0].groupBlocks).toBe(1);
  });

  it("ignores a TENTATIVE group block on the availability grid", async () => {
    const ctx = await setup();
    await prisma.groupBlock.create({
      data: {
        propertyId: ctx.propertyId, code: `B-${uniq()}`, name: "Tent",
        startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 3)),
        totalRoomsHeld: 1, status: "TENTATIVE",
        roomHolds: { create: [{ roomTypeId: ctx.stdId, quantity: 1 }] },
      },
    });

    const res = await asUser(ctx.adminId, () => grid(ctx, { startDate: "2026-08-01", days: "3" }));
    const body = await res.json();
    const row = body.rows.find((r: { roomTypeId: string }) => r.roomTypeId === ctx.stdId);
    // Tentative holds nothing here → full availability, zero Group Blocks.
    expect(row.cells[0].groupBlocks).toBe(0);
    expect(row.cells[0].available).toBe(2);
  });
});
