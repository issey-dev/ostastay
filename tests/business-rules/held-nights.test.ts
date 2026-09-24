import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// A late arrival's HELD nights (owner, 2026-09-24 — src/lib/reservations/held-nights.ts):
// under no-show "hold one night" a guest can check in after the audit of their arrival
// night already ran. That night is charged at check-in at the booked rate (no Green Tax —
// they weren't staying), or waived with a reason by someone who may void.

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
const { ensureChart } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");
const runRoute = await import("@/app/api/night-audit/run/route");
const checkInRoute = await import("@/app/api/reservations/[id]/check-in/route");
const { heldNights } = await import("@/lib/reservations/held-nights");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

describe("heldNights (pure)", () => {
  it("lists the audited nights before today, never past departure or an advance bill", () => {
    const r = { checkInDate: D("2026-09-10"), checkOutDate: D("2026-09-14") };
    expect(heldNights(r, D("2026-09-10"))).toEqual([]);
    expect(heldNights(r, D("2026-09-12")).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-10", "2026-09-11"]);
    expect(heldNights({ ...r, checkOutDate: D("2026-09-11") }, D("2026-09-12"))).toHaveLength(1);
    expect(heldNights({ ...r, advanceBilledThrough: D("2026-09-10") }, D("2026-09-12")).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-11"]);
  });
});

describe("Checking in a late arrival's held night", () => {
  let enterpriseId: string;
  let adminId: string;
  let deskId: string;
  let guestId: string;

  // Business date 2026-09-10, "hold one night", Green Tax on (so a held night that levied it
  // would show), no Service Charge / GST to keep amounts plain. One held arrival for the
  // 10th, in a room at 100 a night; the 10th's audit then runs with the guest not arrived.
  async function heldArrival(name: string) {
    const property = await prisma.property.create({
      data: {
        enterpriseId, name, code: `HN-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00", businessDate: D("2026-09-10"),
      },
    });
    await ensureChart({ propertyId: property.id });
    await setPropertySettings(property.id, {
      noShowTiming: "SECOND_AUDIT", tgstEnabled: false, serviceChargeEnabled: false,
      greenTaxEnabled: true, greenTaxAdultAmount: 6, greenTaxChildAmount: 0,
    });
    const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `H${uniq().slice(-5)}`, status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "BAR" } });
    const r = await prisma.reservation.create({
      data: {
        propertyId: property.id, primaryGuestId: guestId, confirmationNo: `HN${uniq()}`, status: "RESERVED", adults: 1,
        checkInDate: D("2026-09-10"), checkOutDate: D("2026-09-12"),
        assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: D("2026-09-10"), endDate: D("2026-09-12") } },
      },
    });
    const audited = await asUser(adminId, () =>
      runRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: property.id, confirmed: true, reason: "test" }),
      }))
    );
    expect(audited.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).businessDate).toEqual(D("2026-09-11"));
    return { propertyId: property.id, reservation: r };
  }

  const checkIn = (userId: string, id: string, body?: object) =>
    asUser(userId, () =>
      checkInRoute.POST(
        new Request(`http://localhost/api/reservations/${id}/check-in`, {
          method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
        }),
        { params: Promise.resolve({ id }) }
      )
    );
  const lines = (reservationId: string) =>
    prisma.folioLineItem.findMany({ where: { folio: { reservationId }, isVoid: false }, include: { chargeCode: true } });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "HN", slug: `test-hn-${uniq()}`, type: "STANDARD" } })).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `hn-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    deskId = (await prisma.user.create({
      data: { enterpriseId, email: `hn-desk-${uniq()}@test.local`, passwordHash, firstName: "D", lastName: "D", roles: { create: { roleId: roleIds["Front Desk"] } }, scope: "ENTERPRISE" },
    })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Late", lastName: "Guest" } })).upid;
  });

  it("asks first: a late arrival is never checked in without a decision on the held night", async () => {
    const { reservation } = await heldArrival("Ask");
    const peek = await asUser(deskId, () =>
      checkInRoute.GET(new Request(`http://localhost/api/reservations/${reservation.id}/check-in`), { params: Promise.resolve({ id: reservation.id }) })
    );
    expect(await peek.json()).toEqual({ heldNights: ["2026-09-10"], canWaiveHeldNights: false });

    const res = await checkIn(deskId, reservation.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("HELD_NIGHTS");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("RESERVED");
  });

  it("charges the held night at the booked rate, dated today, with no Green Tax", async () => {
    const { propertyId, reservation } = await heldArrival("Charge");
    const res = await checkIn(deskId, reservation.id, { heldNights: "CHARGE" });
    expect(res.status).toBe(200);
    const posted = await lines(reservation.id);
    expect(posted).toHaveLength(1);
    expect(posted[0].amount).toBe(100);
    expect(posted[0].chargeCode.code).toBe("1000");
    expect(posted[0].date).toEqual(D("2026-09-11"));
    expect(posted[0].description).toContain("held night 10 Sept");
    // The arrival date is left as booked.
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).checkInDate).toEqual(D("2026-09-10"));

    // Contrast: the night the guest actually stays is audited as usual, Green Tax and all.
    const audited = await asUser(adminId, () =>
      runRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId, confirmed: true, reason: "test" }),
      }))
    );
    expect(audited.status).toBe(200);
    const after = await lines(reservation.id);
    expect(after.filter((l) => l.chargeCode.code === "8500").map((l) => l.amount)).toEqual([6]);
  });

  it("waives only with the right to void, and a reason", async () => {
    const { reservation } = await heldArrival("Waive");
    expect((await checkIn(deskId, reservation.id, { heldNights: "WAIVE", waiveReason: "Flight delayed" })).status).toBe(403);
    expect((await checkIn(adminId, reservation.id, { heldNights: "WAIVE" })).status).toBe(400);

    const res = await checkIn(adminId, reservation.id, { heldNights: "WAIVE", waiveReason: "Flight delayed" });
    expect(res.status).toBe(200);
    expect(await lines(reservation.id)).toHaveLength(0);
    const log = await prisma.userActivityLog.findFirst({ where: { entityId: reservation.id, action: "HELD_NIGHTS_WAIVED" } });
    expect(log?.description).toContain("Flight delayed");
  });
});
