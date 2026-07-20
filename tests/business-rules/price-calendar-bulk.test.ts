import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import { addDays, format } from "date-fns";
import { MAX_PRICE_CALENDAR_RANGE_DAYS } from "@/lib/price-calendar";

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
const priceCalendarRoute = await import("@/app/api/price-calendar/route");
const priceCalendarBulkRoute = await import("@/app/api/price-calendar/bulk/route");

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
    data: { name: "Price Calendar Test", slug: `test-pc-bulk-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `PCB-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 } });
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "Best Available Rate" } });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `pcb-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "PCB", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  return { adminId: admin.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id };
}

describe("Price Calendar single-room-type bulk update (/api/price-calendar)", () => {
  it("rejects an inverted date range instead of silently updating nothing", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-08-10", endDate: "2026-08-01", price: 100 }),
      }))
    );
    expect(res.status).toBe(400);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(0);
  });

  it("a valid range writes exactly the expected number of days", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-08-01", endDate: "2026-08-05", price: 100 }),
      }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedDays).toBe(5);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(5);
  });

  it("accepts a same-day range (minimum 1 day)", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-08-01", endDate: "2026-08-01", price: 100 }),
      }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedDays).toBe(1);
  });

  it("accepts a range right up to the 10-year cap and rejects one day over it", async () => {
    const ctx = await setup();
    const start = new Date(2026, 0, 1);
    const atCapEnd = format(addDays(start, MAX_PRICE_CALENDAR_RANGE_DAYS - 1), "yyyy-MM-dd");
    const overCapEnd = format(addDays(start, MAX_PRICE_CALENDAR_RANGE_DAYS), "yyyy-MM-dd");

    const withinCap = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-01-01", endDate: atCapEnd, price: 100 }),
      }))
    );
    expect(withinCap.status).toBe(200);

    const overCap = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-01-01", endDate: overCapEnd, price: 100 }),
      }))
    );
    expect(overCap.status).toBe(400);
    const body = await overCap.json();
    expect(body.error).toMatch(/10 years/);
  });

  it("rejects a negative price", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarRoute.POST(new Request("http://localhost/api/price-calendar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeId: ctx.roomTypeId, startDate: "2026-08-01", endDate: "2026-08-05", price: -50 }),
      }))
    );
    expect(res.status).toBe(400);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(0);
  });
});

describe("Price Calendar multi-room-type bulk update (/api/price-calendar/bulk)", () => {
  it("rejects an inverted date range instead of silently reporting success with zero rows updated", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-10", endDate: "2026-08-01", price: 100 }),
      }))
    );
    expect(res.status).toBe(400);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(0);
  });

  it("rejects a range over 10 years but accepts one within it", async () => {
    const ctx = await setup();
    const overCap = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-01", endDate: "2038-08-01", price: 100 }),
      }))
    );
    expect(overCap.status).toBe(400);

    // A 6-year range (would have been rejected under the old 2-year cap) now succeeds.
    const withinCap = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-01", endDate: "2032-08-01", price: 100 }),
      }))
    );
    expect(withinCap.status).toBe(201);
  });

  it("rejects a negative price", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-01", endDate: "2026-08-05", price: -10 }),
      }))
    );
    expect(res.status).toBe(400);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(0);
  });

  it("rejects a negative extra adult/child price even when the base price is valid", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-01", endDate: "2026-08-05", price: 100, extraAdultPrice: -5 }),
      }))
    );
    expect(res.status).toBe(400);
  });

  it("a valid range writes exactly the expected number of rows", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      priceCalendarBulkRoute.POST(new Request("http://localhost/api/price-calendar/bulk", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ratePlanId: ctx.ratePlanId, roomTypeIds: [ctx.roomTypeId], startDate: "2026-08-01", endDate: "2026-08-05", price: 100 }),
      }))
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toMatch(/5 price records/);
    const rows = await prisma.priceCalendar.findMany({ where: { ratePlanId: ctx.ratePlanId } });
    expect(rows).toHaveLength(5);
  });
});
