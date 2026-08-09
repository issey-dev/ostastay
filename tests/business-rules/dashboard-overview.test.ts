import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

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
const { requireSession } = await import("@/lib/scope");
const { buildDashboardOverview } = await import("@/lib/dashboard/overview");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { chargeCode, ensureChart } = await import("../helpers/charge-codes");

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
const BUSINESS_DATE = new Date(Date.UTC(2026, 8, 10));
const day = (offset: number) => new Date(BUSINESS_DATE.getTime() + offset * 86_400_000);

// The whole point of this suite: the dashboard is a composite of a dozen modules, so its
// endpoint has no single permission gate. Each SECTION is gated instead — and that has to
// hold on the DATA, not just on which tiles a page happens to render, or a user without
// REVENUE could read ADR straight off the API.
describe("Operations Dashboard — per-section permission gating", () => {
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let housekeeperId: string;
  let revenueOnlyId: string;
  let frontDeskId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Dashboard Co", slug: `test-dash-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;
    const roleIds = await ensureRoles(prisma, enterprise.id, SYSTEM_ROLE_DEFS, true);

    // A role that can see money but not the front desk — the sharpest test of the gate,
    // since ADR/RevPAR are derived from BOTH revenue and room-night counts.
    const revenueOnlyRole = await prisma.role.create({
      data: {
        enterpriseId: enterprise.id,
        name: "Revenue Analyst",
        isSystem: false,
        permissions: {
          create: [{ module: "REVENUE", canView: true, canCreate: false, canUpdate: false, canDelete: false }],
        },
      },
    });

    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id,
        name: "Dash Resort",
        code: `DASH-${uniq()}`,
        legalName: "Dash Resort Pvt Ltd",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        status: "ACTIVE",
        businessDate: BUSINESS_DATE,
      },
    });
    propertyId = property.id;

    // The canonical chart's own Room Revenue code, so the line buckets as ROOM exactly
    // the way a real Night Audit posting would.
    await ensureChart(enterprise.id);
    const roomCode = (await chargeCode(enterprise.id, "1000")).id;

    // 10 rooms: 6 clean, 2 dirty, 1 inspected, 1 out of order.
    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Deluxe", code: `DLX-${uniq()}`, maxOccupancy: 3 },
    });
    const ratePlan = await prisma.ratePlan.create({
      data: { propertyId, code: `BAR-${uniq()}`, name: "Best Available", chargeCodeId: roomCode },
    });
    const statuses = ["CLEAN", "CLEAN", "CLEAN", "CLEAN", "CLEAN", "CLEAN", "DIRTY", "DIRTY", "INSPECTED", "OUT_OF_ORDER"];
    const rooms = [];
    for (let i = 0; i < statuses.length; i++) {
      rooms.push(
        await prisma.room.create({
          data: { propertyId, roomTypeId: roomType.id, roomNumber: `10${i}`, status: statuses[i] },
        })
      );
    }

    // Four in-house stays covering the business date, each posting 200.00 of room revenue.
    const guests = [];
    for (let i = 0; i < 4; i++) {
      guests.push(
        await prisma.profile.create({
          data: { enterpriseId: enterprise.id, firstName: `Guest${i}`, lastName: "Test", profileType: "GUEST", nationality: "MV" },
        })
      );
    }
    for (let i = 0; i < 4; i++) {
      const reservation = await prisma.reservation.create({
        data: {
          confirmationNo: `DASH-${uniq()}-${i}`,
          propertyId,
          primaryGuestId: guests[i].upid,
          checkInDate: day(-2),
          checkOutDate: day(2),
          adults: 2,
          children: 1,
          status: "IN_HOUSE",
        },
      });
      await prisma.roomAssignment.create({
        data: { reservationId: reservation.id, roomId: rooms[i].id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, startDate: day(-2), endDate: day(2) },
      });
      const folio = await prisma.folio.create({ data: { reservationId: reservation.id, propertyId } });
      await prisma.folioLineItem.create({
        data: { folioId: folio.id, chargeCodeId: roomCode, date: BUSINESS_DATE, description: "Room", amount: 200 },
      });
    }

    const passwordHash = await bcrypt.hash("password123", 10);
    const mkUser = async (roleId: string, tag: string) =>
      (
        await prisma.user.create({
          data: {
            enterpriseId: enterprise.id,
            email: `${tag}-${uniq()}@dash.local`,
            passwordHash,
            firstName: tag,
            lastName: "User",
            scope: "ENTERPRISE",
            roles: { create: { roleId } },
          },
        })
      ).id;

    adminId = await mkUser(roleIds["Admin"], "admin");
    housekeeperId = await mkUser(roleIds["Housekeeping"], "hk");
    frontDeskId = await mkUser(roleIds["Front Desk"], "fd");
    revenueOnlyId = await mkUser(revenueOnlyRole.id, "rev");
  });

  const overviewFor = (userId: string) =>
    asUser(userId, async () => buildDashboardOverview(await requireSession(), propertyId));

  it("gives an Admin every section, with the metrics computed correctly", async () => {
    const o = await overviewFor(adminId);

    expect(o.occupancy).toBeDefined();
    expect(o.revenue).toBeDefined();
    expect(o.housekeeping).toBeDefined();
    expect(o.cashiering).toBeDefined();
    expect(o.debtors).toBeDefined();
    expect(o.maintenance).toBeDefined();
    expect(o.reservations).toBeDefined();
    expect(o.nightAudit).toBeDefined();
    expect(o.worklists).toBeDefined();
    expect(o.activity).toBeDefined();

    // 4 of 10 rooms sold.
    expect(o.occupancy!.totalRooms).toBe(10);
    expect(o.occupancy!.roomsSold).toBe(4);
    expect(o.occupancy!.occupancyPct).toBe(40);
    // 10 physical − 1 out of order = 9 sellable; 9 − 4 occupied = 5 vacant.
    expect(o.occupancy!.sellableRooms).toBe(9);
    expect(o.occupancy!.vacantReady + o.occupancy!.vacantDirty).toBe(5);
    expect(o.occupancy!.adults).toBe(8);
    expect(o.occupancy!.children).toBe(4);

    // 4 × 200 posted today, all of it ROOM.
    expect(o.revenue!.today.room).toBe(800);
    expect(o.revenue!.today.total).toBe(800);
    expect(o.revenue!.today.byBucket).toEqual([{ bucket: "ROOM", label: "Room", amount: 800 }]);
    // ADR = room revenue / rooms sold; RevPAR = room revenue / rooms available.
    expect(o.revenue!.adr).toBe(200);
    expect(o.revenue!.revpar).toBe(80);

    // 10 rooms, one of each of these statuses configured above.
    const mix = Object.fromEntries(o.housekeeping!.statusMix.map((s) => [s.status, s.count]));
    expect(mix).toMatchObject({ CLEAN: 6, DIRTY: 2, INSPECTED: 1, OUT_OF_ORDER: 1 });
  });

  it("gives a Housekeeping role its own section and nothing else", async () => {
    const o = await overviewFor(housekeeperId);

    expect(o.housekeeping).toBeDefined();
    expect(o.maintenance).toBeDefined(); // the role holds MAINTENANCE view

    // Everything the role cannot view must be ABSENT — not empty, not zeroed.
    expect(o.occupancy).toBeUndefined();
    expect(o.revenue).toBeUndefined();
    expect(o.trend).toBeUndefined();
    expect(o.cashiering).toBeUndefined();
    expect(o.debtors).toBeUndefined();
    expect(o.reservations).toBeUndefined();
    expect(o.profiles).toBeUndefined();
    expect(o.nightAudit).toBeUndefined();
    expect(o.worklists).toBeUndefined();
    expect(o.activity).toBeUndefined();
    expect(o.pos).toBeUndefined();
    expect(o.groups).toBeUndefined();

    // And the payload must not carry the numbers by another route either.
    expect(JSON.stringify(o)).not.toContain('"adr"');
    expect(JSON.stringify(o)).not.toContain('"occupancyPct"');
    expect(o.visibleSections.sort()).toEqual(["housekeeping", "maintenance"]);
  });

  it("gives a revenue-only role the money sections but no front-desk data", async () => {
    const o = await overviewFor(revenueOnlyId);

    expect(o.revenue).toBeDefined();
    expect(o.revenue!.adr).toBe(200);
    // The trend renders for a revenue holder, but its occupancy series stays null —
    // the room-night counts it needs are FRONT_DESK's to disclose, not REVENUE's.
    expect(o.trend?.hasRevenue).toBe(true);
    expect(o.trend?.hasOccupancy).toBe(false);
    expect(o.trend!.points.every((p) => p.roomsSold === null && p.occupancy === null)).toBe(true);

    expect(o.occupancy).toBeUndefined();
    expect(o.worklists).toBeUndefined();
    expect(o.housekeeping).toBeUndefined();
    expect(o.cashiering).toBeUndefined();
  });

  it("gives Front Desk occupancy and worklists but withholds revenue", async () => {
    const o = await overviewFor(frontDeskId);

    expect(o.occupancy).toBeDefined();
    expect(o.worklists).toBeDefined();
    expect(o.cashiering).toBeDefined();
    expect(o.trend?.hasOccupancy).toBe(true);

    // Front Desk holds no REVENUE — no ADR, no RevPAR, no posted amounts anywhere.
    expect(o.revenue).toBeUndefined();
    expect(o.trend?.hasRevenue).toBe(false);
    expect(o.trend!.points.every((p) => p.adr === null && p.roomRevenue === null && p.revpar === null)).toBe(true);
  });

  it("hides Spa and Excursions until the enterprise actually holds the add-on", async () => {
    // Front Desk holds SPA and EXCURSIONS view, but the enterprise has bought neither.
    const before = await overviewFor(frontDeskId);
    expect(before.spa).toBeUndefined();
    expect(before.excursions).toBeUndefined();

    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "SPA", enabled: true } });

    const after = await overviewFor(frontDeskId);
    expect(after.spa).toBeDefined();
    // Excursions is a separate purchase and stays hidden.
    expect(after.excursions).toBeUndefined();
  });

  it("keeps the trend window inside its bounds and marks the on-the-books tail", async () => {
    const ctx = await asUser(adminId, () => requireSession());
    const short = await asUser(adminId, () => buildDashboardOverview(ctx, propertyId, { trendDays: 2 }));
    const long = await asUser(adminId, () => buildDashboardOverview(ctx, propertyId, { trendDays: 999 }));

    // Clamped to [7, 60] history, always plus a 7-day forecast tail.
    expect(short.trendDays).toBe(7);
    expect(short.trend!.points).toHaveLength(7 + 7);
    expect(long.trendDays).toBe(60);

    const futures = short.trend!.points.filter((p) => p.future);
    expect(futures).toHaveLength(7);
    // Nothing is posted in the future, so no forecast point may claim revenue.
    expect(futures.every((p) => p.roomRevenue === null && p.totalRevenue === null)).toBe(true);
    // But rooms already on the books for those nights do show.
    expect(futures[0].roomsSold).toBe(4);
  });
});
