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
const { createSession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createReservation } = await import("@/lib/reservations/create-reservation");

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// A booking may not arrive before the property's BUSINESS date (app-owner bug report,
// 2026-08-03: "arrival date cannot be less than current business date, currently it is
// allowing me to select any date"). Such a booking could never be checked in and Night
// Audit would never see it — a permanent phantom arrival.
//
// Asserted at the SERVICE, not through the date picker: the picker is a convenience, and
// any direct API call would bypass it. Business date, not the server's calendar date.
describe("Arrival cannot predate the business date", () => {
  let propertyId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let guestUpid: string;
  let userId: string;
  const stamp = Date.now();
  const BUSINESS = utc(2026, 8, 10);

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const ent = await prisma.enterprise.create({
      data: { name: `Floor ${stamp}`, slug: `test-floor-${stamp}`, type: "STANDARD" },
    });
    await prisma.enterpriseLicense.create({ data: { enterpriseId: ent.id, tier: "STANDARD", maxProperties: 1 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId: ent.id,
        name: "Floor Property",
        code: `FLR-${stamp}`,
        legalName: "Floor LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        status: "ACTIVE",
        // Deliberately in the FUTURE relative to the server's real date, so a pass here
        // cannot be an accident of "today".
        businessDate: BUSINESS,
      },
    });
    propertyId = property.id;

    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    roomTypeId = rt.id;
    await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: "101", status: "AVAILABLE" } });
    const rp = await prisma.ratePlan.create({
      data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true },
    });
    ratePlanId = rp.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId: ent.id, firstName: "Floor", lastName: "Guest", profileType: "GUEST" },
    });
    guestUpid = guest.upid;

    const user = await prisma.user.create({
      data: {
        enterpriseId: ent.id,
        email: `floor-${stamp}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Floor",
        lastName: "User",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    userId = user.id;

    cookieJar.clear();
    await createSession(userId);
  });

  const book = async (checkIn: Date, checkOut: Date) => {
    const ctx = await requireSession();
    return createReservation(ctx, {
      propertyId,
      primaryGuestId: guestUpid,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomTypeId,
      ratePlanId,
      adults: 1,
    });
  };

  it("refuses an arrival BEFORE the business date", async () => {
    const result = await book(utc(2026, 8, 9), utc(2026, 8, 12));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      // Names the actual floor, so the desk knows what to pick instead.
      expect(result.error).toMatch(/2026-08-10/);
      expect(result.error).toMatch(/business date/i);
    }
  });

  it("refuses an arrival well in the past, not merely the day before", async () => {
    const result = await book(utc(2026, 1, 1), utc(2026, 1, 3));
    expect(result.ok).toBe(false);
  });

  it("accepts an arrival ON the business date — today is bookable", async () => {
    const result = await book(BUSINESS, utc(2026, 8, 13));
    expect(result.ok).toBe(true);
  });

  it("accepts a future arrival", async () => {
    const result = await book(utc(2026, 9, 1), utc(2026, 9, 4));
    expect(result.ok).toBe(true);
  });

  it("measures against the BUSINESS date, not the server's calendar date", async () => {
    // The server's real date is well before this property's business date, so an arrival
    // that is "in the future" by wall clock is still refused when it predates the
    // property's operational day. This is the whole point of the rule.
    const serverFuture = utc(2026, 8, 5); // after "real" today, before the business date
    const result = await book(serverFuture, utc(2026, 8, 20));
    expect(result.ok).toBe(false);
  });

  it("EXEMPTS the channel path — an OTA booking that arrives late must not be refused", async () => {
    const ctx = await requireSession();
    // A booking can reach us after its own arrival date: a webhook outage, a poller
    // running behind, an OTA booking made for today on a property whose business date
    // has not rolled. The channel already confirmed that stay to the guest, so refusing
    // it would turn a real paid booking into a FAILED conversion. This flag is set ONLY
    // by src/lib/channels/inbound/convert.ts — never from a staff-facing route.
    const result = await createReservation(ctx, {
      propertyId,
      primaryGuestId: guestUpid,
      checkInDate: utc(2026, 8, 1), // nine days before the business date
      checkOutDate: utc(2026, 8, 14),
      roomTypeId,
      ratePlanId,
      adults: 1,
      allowPastArrival: true,
      // convert.ts sets BOTH flags; the earlier bookings in this file already occupy the
      // single room, so without this the assertion would be measuring the overbooking
      // guard rather than the arrival floor.
      acknowledgeOverbook: true,
    });
    expect(result.ok).toBe(true);
  });
});
