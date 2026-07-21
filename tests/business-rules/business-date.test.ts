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
const { resolveBusinessDate, nextBusinessDate, serverToday } = await import("@/lib/business-date");

const checkInRoute = await import("@/app/api/reservations/[id]/check-in/route");
const checkOutRoute = await import("@/app/api/reservations/[id]/check-out/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 86_400_000;
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

describe("Business date: helpers, checkout gating", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let roomId: string;
  let ratePlanId: string;
  let adminId: string;
  let guestId: string;

  const checkOut = (id: string, early?: boolean) =>
    asUser(adminId, () =>
      checkOutRoute.POST(
        new Request(`http://localhost/api/reservations/${id}/check-out`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(early === undefined ? {} : { early }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );

  const mkInHouse = async (checkOutDate: Date) => {
    const res = await prisma.reservation.create({
      data: {
        propertyId,
        confirmationNo: `BD-${uniq()}`,
        primaryGuestId: guestId,
        checkInDate: new Date(checkOutDate.getTime() - 2 * DAY),
        checkOutDate,
        status: "IN_HOUSE",
        adults: 1,
        assignments: { create: { roomTypeId, roomId, ratePlanId, startDate: new Date(checkOutDate.getTime() - 2 * DAY), endDate: checkOutDate } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
    });
    return res.id;
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Biz Date", slug: `test-bizdate-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({
      data: { enterpriseId, name: "BD Property", code: `BD-${uniq()}`, legalName: "BD LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    propertyId = property.id;
    const roomType = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    roomTypeId = roomType.id;
    const room = await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: `B${Math.floor(Math.random() * 9000 + 1000)}`, status: "CLEAN" } });
    roomId = room.id;
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    ratePlanId = ratePlan.id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `bd-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "BD", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Biz", lastName: "Date" } });
    guestId = guest.upid;
  });

  it("helpers: resolveBusinessDate falls back to server date, nextBusinessDate adds a day", () => {
    expect(resolveBusinessDate({ businessDate: null }).getTime()).toBe(serverToday().getTime());
    const d = new Date(Date.UTC(2026, 5, 1));
    expect(resolveBusinessDate({ businessDate: d }).getTime()).toBe(d.getTime());
    expect(nextBusinessDate(d).getTime()).toBe(d.getTime() + DAY);
  });

  it("blocks checkout before the checkout date unless early, then allows early", async () => {
    // Business date is well before checkout — a normal checkout must be refused.
    const bizDate = utcMidnight(new Date());
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: bizDate } });
    const resId = await mkInHouse(new Date(bizDate.getTime() + 3 * DAY)); // due out in 3 days

    const normal = await checkOut(resId);
    expect(normal.status).toBe(400);
    const body = await normal.json();
    expect(body.earlyCheckoutRequired).toBe(true);

    const early = await checkOut(resId, true);
    expect(early.status).toBe(200);
    expect((await prisma.reservation.findUnique({ where: { id: resId } }))!.status).toBe("CHECKED_OUT");
  });

  it("allows a normal checkout when due out (business date == checkout date) and when overdue", async () => {
    const bizDate = utcMidnight(new Date());

    // Due out exactly today.
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: bizDate } });
    const dueId = await mkInHouse(bizDate);
    const due = await checkOut(dueId);
    expect(due.status).toBe(200);

    // Overdue (business date past the checkout date) — still allowed without early flag.
    const overdueId = await mkInHouse(new Date(bizDate.getTime() - 2 * DAY));
    const overdue = await checkOut(overdueId);
    expect(overdue.status).toBe(200);
  });
});
