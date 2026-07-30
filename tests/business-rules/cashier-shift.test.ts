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

const lineItemsRoute = await import("@/app/api/folios/[id]/line-items/route");
const paymentsRoute = await import("@/app/api/folios/[id]/payments/route");
const statusRoute = await import("@/app/api/cashiering/status/route");
const ensureRoute = await import("@/app/api/cashiering/ensure/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, propertyId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  cookieJar.set("current_property_id", propertyId);
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 2, 10)); // 2026-03-10

describe("Cashier shift: per-user/property, auto-open, charge attribution", () => {
  let enterpriseId: string;
  let propertyId: string;
  let userId: string;
  let folioId: string;
  let roomCodeId: string;
  let fbCodeId: string;
  let cashMethodId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "CShift", slug: `test-cshift-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const roleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const property = await prisma.property.create({ data: { enterpriseId, name: "CS Prop", code: `CS-${uniq()}`, legalName: "CS LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: "201", status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    roomCodeId = (await customChargeCode(enterpriseId, { code: `ROOM-${uniq()}`, description: "Room", subgroupCode: "10RV" })).id;
    fbCodeId = (await customChargeCode(enterpriseId, { code: `FB-${uniq()}`, description: "Food", subgroupCode: "20RV" })).id;
    cashMethodId = (await prisma.paymentMethod.create({ data: { enterpriseId, name: "Cash", type: "CASH" } })).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const user = await prisma.user.create({ data: { enterpriseId, email: `cs-${uniq()}@test.local`, passwordHash, firstName: "Front", lastName: "Desk", roleId: roleIds["Front Desk"] ?? roleIds["Admin"], scope: "PROPERTY", propertyId } });
    userId = user.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "In", lastName: "House" } });
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `CS-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: BIZ, checkOutDate: new Date(BIZ.getTime() + 2 * 86_400_000), status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rt.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: BIZ, endDate: new Date(BIZ.getTime() + 2 * 86_400_000) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    folioId = res.folios[0].id;
  });

  const postCharge = (chargeCodeId: string, amount: number) =>
    asUser(userId, propertyId, () =>
      lineItemsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/line-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeCodeId, amount }) }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );
  const postPayment = (amount: number) =>
    asUser(userId, propertyId, () =>
      paymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/payments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentMethodId: cashMethodId, amount }) }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );

  it("ensure auto-opens one shift for the (user, property), idempotently", async () => {
    const r1 = await asUser(userId, propertyId, () => ensureRoute.POST());
    expect(r1.status).toBe(200);
    await asUser(userId, propertyId, () => ensureRoute.POST());
    const shifts = await prisma.cashierShift.findMany({ where: { userId, propertyId, closedAt: null } });
    expect(shifts).toHaveLength(1);
    expect(shifts[0].businessDate?.getTime()).toBe(BIZ.getTime());
    expect(shifts[0].openingFloat).toBe(0);
  });

  it("A12: concurrent ensure calls never open two drawers for one (user, property)", async () => {
    // Fresh user so no shift exists yet, then race two opens.
    const passwordHash = await bcrypt.hash("password123", 10);
    const roleIds2 = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const racer = await prisma.user.create({ data: { enterpriseId, email: `cs-race-${uniq()}@test.local`, passwordHash, firstName: "Race", lastName: "Er", roleId: roleIds2["Front Desk"] ?? roleIds2["Admin"], scope: "PROPERTY", propertyId } });

    await Promise.all([
      asUser(racer.id, propertyId, () => ensureRoute.POST()),
      asUser(racer.id, propertyId, () => ensureRoute.POST()),
    ]);

    const open = await prisma.cashierShift.findMany({ where: { userId: racer.id, propertyId, closedAt: null } });
    expect(open).toHaveLength(1);
  });

  it("attributes charges and payments to the open shift, grouped by charge code", async () => {
    expect((await postCharge(roomCodeId, 100)).status).toBe(201);
    expect((await postCharge(roomCodeId, 50)).status).toBe(201);
    expect((await postCharge(fbCodeId, 30)).status).toBe(201);
    expect((await postPayment(120)).status).toBe(201);

    const shift = await prisma.cashierShift.findFirst({ where: { userId, propertyId, closedAt: null } });
    const lines = await prisma.folioLineItem.findMany({ where: { shiftId: shift!.id } });
    expect(lines).toHaveLength(3);
    const payments = await prisma.payment.findMany({ where: { shiftId: shift!.id } });
    expect(payments).toHaveLength(1);

    const res = await asUser(userId, propertyId, () => statusRoute.GET());
    const body = await res.json();
    expect(body.data.hasActiveShift).toBe(true);
    const byCode = body.data.summary.postingsByChargeCode as any[];
    const room = byCode.find((r) => r.category === "ROOM");
    expect(room.total).toBe(150); // 100 + 50
    expect(room.count).toBe(2);
    expect(body.data.summary.chargesTotal).toBe(180); // 150 room + 30 F&B
    expect(body.data.summary.paymentSummary[0].net).toBe(120);
    expect(body.data.summary.paymentsNet).toBe(120);
  });
});
