import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { validateRollTarget, daysBetween, findRollBlockers } = await import("@/lib/business-date-roll");
const rollRoute = await import("@/app/api/eod/roll-forward/route");

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Skipping the business date over a CLOSED period, without an End-of-Day per day
// (app-owner request, 2026-08-03). The rule: forward only, and only when the period
// holds no reservations or activity — a skipped day is never audited, so anything left
// inside the range would be silently stepped over.
describe("Business-date roll-forward", () => {
  let propertyId: string;
  let enterpriseId: string;
  let auditorId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let guestUpid: string;
  const stamp = Date.now();
  const BUSINESS = utc(2026, 8, 1);

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const ent = await prisma.enterprise.create({
      data: { name: `Roll ${stamp}`, slug: `test-roll-${stamp}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Roll Property",
        code: `ROLL-${stamp}`,
        legalName: "Roll LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        status: "ACTIVE",
        businessDate: BUSINESS,
      },
    });
    propertyId = property.id;

    const rt = await prisma.roomType.create({
      data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 },
    });
    roomTypeId = rt.id;
    const rp = await prisma.ratePlan.create({
      data: { propertyId, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });
    ratePlanId = rp.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId, firstName: "Roll", lastName: "Guest", profileType: "GUEST" },
    });
    guestUpid = guest.upid;

    const auditor = await prisma.user.create({
      data: {
        enterpriseId,
        email: `roll-${stamp}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Night",
        lastName: "Auditor",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    auditorId = auditor.id;
  });

  afterEach(async () => {
    // Every test starts from the same business date and an empty property.
    await prisma.reservation.deleteMany({ where: { propertyId } });
    await prisma.cashierShift.deleteMany({ where: { propertyId } });
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: BUSINESS } });
    await destroySession();
    cookieJar.clear();
  });

  const makeReservation = (status: string, checkIn: Date, checkOut: Date) =>
    prisma.reservation.create({
      data: {
        confirmationNo: `ROLL-${status}-${Math.random().toString(36).slice(2, 9)}`,
        propertyId,
        primaryGuestId: guestUpid,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: 1,
        status,
        assignments: { create: { roomTypeId, ratePlanId, startDate: checkIn, endDate: checkOut } },
      },
    });

  // ---------------------------------------------------------------------------
  // The direction rule — pure, so it is asserted directly.
  // ---------------------------------------------------------------------------

  it("only ever moves forward", () => {
    expect(validateRollTarget(BUSINESS, utc(2026, 8, 5))).toBeNull();
    // Backwards would retro-date every posting stamped with the business date.
    expect(validateRollTarget(BUSINESS, utc(2026, 7, 30))).toMatch(/only move forward/i);
    expect(validateRollTarget(BUSINESS, BUSINESS)).toMatch(/already set/i);
    expect(daysBetween(BUSINESS, utc(2026, 8, 11))).toBe(10);
  });

  // ---------------------------------------------------------------------------
  // The activity rule
  // ---------------------------------------------------------------------------

  it("allows the roll when the period is genuinely empty", async () => {
    expect(await findRollBlockers(propertyId, BUSINESS, utc(2026, 8, 11))).toEqual([]);
  });

  it("blocks on arrivals due inside the period, and names them", async () => {
    await makeReservation("RESERVED", utc(2026, 8, 4), utc(2026, 8, 6));
    const blockers = await findRollBlockers(propertyId, BUSINESS, utc(2026, 8, 11));
    expect(blockers.map((b) => b.kind)).toContain("ARRIVALS");
    expect(blockers.find((b) => b.kind === "ARRIVALS")!.message).toMatch(/due to arrive/i);
  });

  it("blocks on in-house guests — their nightly charges would never post", async () => {
    await makeReservation("IN_HOUSE", utc(2026, 7, 30), utc(2026, 8, 3));
    const kinds = (await findRollBlockers(propertyId, BUSINESS, utc(2026, 8, 11))).map((b) => b.kind);
    expect(kinds).toContain("IN_HOUSE");
    expect(kinds).toContain("DEPARTURES");
  });

  it("blocks on an open cashier shift", async () => {
    await prisma.cashierShift.create({
      data: { enterpriseId, propertyId, userId: auditorId, businessDate: BUSINESS, openingFloat: 0 },
    });
    const kinds = (await findRollBlockers(propertyId, BUSINESS, utc(2026, 8, 11))).map((b) => b.kind);
    expect(kinds).toContain("OPEN_SHIFT");
  });

  it("ignores activity ON the target day — that day gets worked normally", async () => {
    // Arriving on the reopening date is exactly the expected case.
    await makeReservation("RESERVED", utc(2026, 8, 11), utc(2026, 8, 13));
    expect(await findRollBlockers(propertyId, BUSINESS, utc(2026, 8, 11))).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // The route
  // ---------------------------------------------------------------------------

  it("previews, then rolls, and refuses to roll while blocked", async () => {
    cookieJar.clear();
    await createSession(auditorId);

    const preview = await rollRoute.GET(
      new Request(`http://localhost/api/eod/roll-forward?propertyId=${propertyId}&to=2026-08-11`)
    );
    expect(preview.status).toBe(200);
    const pv = await preview.json();
    expect(pv).toMatchObject({ from: "2026-08-01", to: "2026-08-11", days: 10, canRoll: true });

    // A booking lands in the range: the POST re-checks rather than trusting the preview.
    const blocker = await makeReservation("RESERVED", utc(2026, 8, 4), utc(2026, 8, 6));
    const refused = await rollRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, to: "2026-08-11" }),
      })
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).blockers.map((b: { kind: string }) => b.kind)).toContain("ARRIVALS");
    // Nothing moved.
    expect(iso((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).businessDate!)).toBe("2026-08-01");

    // Clear it and the same request succeeds.
    await prisma.reservation.delete({ where: { id: blocker.id } });
    const ok = await rollRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, to: "2026-08-11" }),
      })
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, from: "2026-08-01", to: "2026-08-11", days: 10 });
    expect(iso((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).businessDate!)).toBe("2026-08-11");

    // And it is logged in the property's own trail.
    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId, entityType: "Property", entityId: propertyId },
      orderBy: { createdAt: "desc" },
    });
    expect(trail!.description).toMatch(/Rolled the business date forward 10 days/);
  });

  it("refuses a backwards target through the route", async () => {
    cookieJar.clear();
    await createSession(auditorId);
    const res = await rollRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, to: "2026-07-20" }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only move forward/i);
  });
});
