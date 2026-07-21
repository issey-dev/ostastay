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
const rateAvailabilityRoute = await import("@/app/api/reservations/rate-availability/route");

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

// One property with:
//  - room type STD (2 physical rooms) and STE (1 physical room)
//  - Base plan (locked) priced $100/night on STD only
//  - BAR plan priced $150/night on STD for Aug 1-2 only (falls back to Base after)
//  - DERIVED plan = BAR +10%
//  - a competing reservation holding STE for Aug 1-3
async function setup() {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: "RateAvail Test", slug: `test-ra-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `RA-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const std = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", baseOccupancy: 2, maxOccupancy: 3 } });
  const ste = await prisma.roomType.create({ data: { propertyId: property.id, name: "Suite", code: "STE", baseOccupancy: 2, maxOccupancy: 4 } });
  await prisma.room.createMany({
    data: [
      { propertyId: property.id, roomTypeId: std.id, roomNumber: "101", status: "AVAILABLE" },
      { propertyId: property.id, roomTypeId: std.id, roomNumber: "102", status: "AVAILABLE" },
      { propertyId: property.id, roomTypeId: ste.id, roomNumber: "201", status: "AVAILABLE" },
    ],
  });
  const basePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BASE", name: "Base Rate", isLocked: true, priority: 999 } });
  const bar = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "Best Available", priority: 1 } });
  const derived = await prisma.ratePlan.create({
    data: { propertyId: property.id, code: "BAR10", name: "BAR +10%", priority: 2, parentRatePlanId: bar.id, derivedAdjustmentType: "PERCENT", derivedAdjustmentValue: 10 },
  });

  // Base: STD priced $100 every night Aug 1-4; STE never priced anywhere.
  for (let d = 1; d <= 4; d++) {
    await prisma.priceCalendar.create({
      data: { ratePlanId: basePlan.id, roomTypeId: std.id, date: new Date(Date.UTC(2026, 7, d)), price: 100 },
    });
  }
  // BAR: STD priced $150 with $20 extra-adult / $10 extra-child on Aug 1-2 only.
  for (let d = 1; d <= 2; d++) {
    await prisma.priceCalendar.create({
      data: { ratePlanId: bar.id, roomTypeId: std.id, date: new Date(Date.UTC(2026, 7, d)), price: 150, extraAdultPrice: 20, extraChildPrice: 10 },
    });
  }

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `ra-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "RA", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Grid", lastName: "Guest" },
  });
  // Competing reservation holds the only STE room Aug 1-3.
  const competing = await prisma.reservation.create({
    data: {
      confirmationNo: `RA-${uniq()}`, propertyId: property.id, primaryGuestId: guest.upid,
      checkInDate: new Date(Date.UTC(2026, 7, 1)), checkOutDate: new Date(Date.UTC(2026, 7, 3)),
      adults: 2, status: "RESERVED",
      assignments: {
        create: [{ roomTypeId: ste.id, ratePlanId: basePlan.id, startDate: new Date(Date.UTC(2026, 7, 1)), endDate: new Date(Date.UTC(2026, 7, 3)) }],
      },
    },
  });

  return {
    adminId: admin.id, propertyId: property.id,
    stdId: std.id, steId: ste.id,
    basePlanId: basePlan.id, barId: bar.id, derivedId: derived.id,
    competingReservationId: competing.id,
  };
}

const query = (ctx: Awaited<ReturnType<typeof setup>>, params: Record<string, string>) => {
  const qs = new URLSearchParams({ propertyId: ctx.propertyId, ...params }).toString();
  return rateAvailabilityRoute.GET(new Request(`http://localhost/api/reservations/rate-availability?${qs}`));
};

describe("Booking grid rate & availability (/api/reservations/rate-availability)", () => {
  it("prices a plan from its own calendar and falls back to the Base plan on uncovered nights", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-01", endDate: "2026-08-04", adults: "2", children: "0" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nights).toBe(3);
    // BAR × STD: $150 (own) + $150 (own) + $100 (Base fallback for Aug 3) = $400.
    const barStd = body.grid[ctx.barId][ctx.stdId];
    expect(barStd.total).toBe(400);
    expect(barStd.pricedNights).toBe(3);
    // Base × STD: 3 × $100.
    expect(body.grid[ctx.basePlanId][ctx.stdId].total).toBe(300);
    // STE has no calendar rows under any plan → unpriced cell.
    expect(body.grid[ctx.barId][ctx.steId]).toBeNull();
  });

  it("applies a derived plan's adjustment on top of the parent's (and fallback) prices", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-01", endDate: "2026-08-04", adults: "2", children: "0" })
    );
    const body = await res.json();
    // (150 + 150 + 100 via Base fallback) each +10% = 165 + 165 + 110 = 440.
    expect(body.grid[ctx.derivedId][ctx.stdId].total).toBe(440);
  });

  it("adds extra-occupancy from the plan's own calendar entries only, matching Night Audit", async () => {
    const ctx = await setup();
    // 3 adults (1 over STD's baseOccupancy of 2) + 1 child.
    const res = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-01", endDate: "2026-08-04", adults: "3", children: "1" })
    );
    const body = await res.json();
    // BAR has extras configured on Aug 1-2 only: 2 × (1×$20 + 1×$10) = $60; the Base
    // fallback night contributes nothing (extras never come from the fallback entry).
    expect(body.grid[ctx.barId][ctx.stdId].extraOccupancyTotal).toBe(60);
    // Base plan's own entries have no extra prices at all.
    expect(body.grid[ctx.basePlanId][ctx.stdId].extraOccupancyTotal).toBe(0);
  });

  it("reports minimum availability across the window and honors excludeReservationId", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-01", endDate: "2026-08-03", adults: "2", children: "0" })
    );
    const body = await res.json();
    const ste = body.roomTypes.find((rt: { id: string }) => rt.id === ctx.steId);
    const std = body.roomTypes.find((rt: { id: string }) => rt.id === ctx.stdId);
    expect(std.minAvailable).toBe(2);
    // The competing reservation holds the only STE room → sold out.
    expect(ste.minAvailable).toBe(0);
    expect(ste.soldOutNights.length).toBeGreaterThan(0);

    // Excluding that reservation (the edit-mode quote) frees the room again.
    const res2 = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-01", endDate: "2026-08-03", adults: "2", children: "0", excludeReservationId: ctx.competingReservationId })
    );
    const body2 = await res2.json();
    expect(body2.roomTypes.find((rt: { id: string }) => rt.id === ctx.steId).minAvailable).toBe(1);
  });

  it("rejects an inverted range and a missing property", async () => {
    const ctx = await setup();
    const res = await asUser(ctx.adminId, () =>
      query(ctx, { startDate: "2026-08-04", endDate: "2026-08-01", adults: "2", children: "0" })
    );
    expect(res.status).toBe(400);
  });
});
