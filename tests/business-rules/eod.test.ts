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

const statusRoute = await import("@/app/api/eod/status/route");
const stepRoute = await import("@/app/api/eod/step/route");
const checkOutRoute = await import("@/app/api/reservations/[id]/check-out/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 8, 10)); // 2026-09-10

describe("End-of-Day wizard: steps, gating, idempotency", () => {
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let cashierUserId: string;
  let chargeableFolioId: string;
  let dueOutId: string;

  const getStatus = () =>
    asUser(adminId, () => statusRoute.GET(new Request(`http://localhost/api/eod/status?propertyId=${propertyId}`)));
  const step = (s: string) =>
    asUser(adminId, () =>
      stepRoute.POST(new Request("http://localhost/api/eod/step", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId, step: s }),
      }))
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "EOD Wizard", slug: `test-eodw-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({ data: { enterpriseId, name: "EODW Prop", code: `EW-${uniq()}`, legalName: "EW LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const roomA = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: `A${uniq().slice(-4)}`, status: "CLEAN" } });
    const roomB = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: `B${uniq().slice(-4)}`, status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    await prisma.chargeCode.create({ data: { enterpriseId, code: "ROOM", description: "Room Revenue" } });
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `ew-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "EW", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    const cashier = await prisma.user.create({ data: { enterpriseId, email: `ew-cash-${uniq()}@test.local`, passwordHash, firstName: "Cash", lastName: "EW", roleId: roleIds["Cashier"], scope: "PROPERTY", propertyId } });
    cashierUserId = cashier.id;
    await prisma.cashierShift.create({ data: { enterpriseId, userId: cashier.id, openingFloat: 300 } });
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Eod", lastName: "Guest" } });

    // Chargeable in-house stay (checks out after the business date).
    const chargeable = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `EW-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(Date.UTC(2026, 8, 8)), checkOutDate: new Date(Date.UTC(2026, 8, 12)), status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rt.id, roomId: roomA.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: new Date(Date.UTC(2026, 8, 8)), endDate: new Date(Date.UTC(2026, 8, 12)) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    chargeableFolioId = chargeable.folios[0].id;

    // Due-out stay (checkout == business date) that must be resolved first.
    const dueOut = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `EW-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(Date.UTC(2026, 8, 8)), checkOutDate: BIZ, status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rt.id, roomId: roomB.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: new Date(Date.UTC(2026, 8, 8)), endDate: BIZ } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
    });
    dueOutId = dueOut.id;
  });

  it("status reports the business date, steps, and the pending due-out", async () => {
    const res = await getStatus();
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(new Date(s.businessDate).getTime()).toBe(BIZ.getTime());
    expect(s.steps).toHaveLength(6);
    expect(s.steps.every((x: any) => !x.done)).toBe(true);
    expect(s.pendingDepartures.some((d: any) => d.id === dueOutId)).toBe(true);
    expect(s.openShifts.length).toBe(1);
  });

  it("departures step is blocked until the due-out is resolved", async () => {
    const blocked = await step("departures");
    expect(blocked.status).toBe(400);

    const co = await asUser(adminId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${dueOutId}/check-out`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      }), { params: Promise.resolve({ id: dueOutId }) })
    );
    expect(co.status).toBe(200);

    const ok = await step("departures");
    expect(ok.status).toBe(200);
    expect((await ok.json()).steps.find((x: any) => x.key === "departures").done).toBe(true);
  });

  it("cashier step force-closes the open shift at the expected drop", async () => {
    const res = await step("cashier");
    expect(res.status).toBe(200);
    const shift = await prisma.cashierShift.findFirst({ where: { userId: cashierUserId } });
    expect(shift!.closedAt).not.toBeNull();
    expect(shift!.closingDrop).toBe(300); // opening float, no cash movement
  });

  it("post step posts room charges once and rolls the business date; re-running is idempotent", async () => {
    const res = await step("post");
    expect(res.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId: chargeableFolioId, description: "Nightly Room Charge" } });
    expect(lines.length).toBe(1);
    expect(lines[0].amount).toBe(100);

    // Business date rolled forward.
    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(prop!.businessDate!.getTime()).toBe(BIZ.getTime() + 86_400_000);

    // Re-running the post step does not double-post.
    const again = await step("post");
    expect(again.status).toBe(200);
    const linesAfter = await prisma.folioLineItem.findMany({ where: { folioId: chargeableFolioId, description: "Nightly Room Charge" } });
    expect(linesAfter.length).toBe(1);
  });

  it("reports + finalize complete the run and set the force-logout watermark", async () => {
    expect((await step("registration")).status).toBe(200);
    expect((await step("reports")).status).toBe(200);
    const fin = await step("finalize");
    expect(fin.status).toBe(200);
    const finBody = await fin.json();
    expect(finBody.run.status).toBe("COMPLETED");

    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(prop!.eodSessionsInvalidAt).not.toBeNull();

    const run = await prisma.eodRun.findFirst({ where: { propertyId, businessDate: BIZ } });
    expect(run!.status).toBe("COMPLETED");
    expect(run!.finalizedAt).not.toBeNull();
  });
});
