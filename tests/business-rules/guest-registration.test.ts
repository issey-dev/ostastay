import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { assignRegistrationNumbers } = await import("@/lib/guest-registration");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Guest Registration No (Green Tax) assignment at EOD", () => {
  let propertyId: string;
  let rtId: string;
  let pseudoRtId: string;
  let ratePlanId: string;
  let guestId: string;
  let accId: string;
  const BIZ = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15

  const mkArrival = async (checkedInAt: Date, roomTypeId: string, accompanying: string[] = []) => {
    const room = await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: `R${uniq().slice(-5)}`, status: "CLEAN" } });
    return prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `GR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: BIZ, checkOutDate: new Date(BIZ.getTime() + 2 * 86_400_000), status: "IN_HOUSE", adults: 1, checkedInAt,
        assignments: { create: { roomTypeId, roomId: room.id, ratePlanId, startDate: BIZ, endDate: new Date(BIZ.getTime() + 2 * 86_400_000) } },
        accompanyingGuests: accompanying.length ? { create: accompanying.map((p) => ({ profileId: p })) } : undefined,
      },
    });
  };

  beforeAll(async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "GuestReg", slug: `test-greg-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "GR Prop", code: `GR-${uniq()}`, legalName: "GR LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2, isPseudo: false } })).id;
    pseudoRtId = (await prisma.roomType.create({ data: { propertyId, name: "Day Use", code: "DAY", maxOccupancy: 2, isPseudo: true } })).id;
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Prim", lastName: "Ary" } })).upid;
    accId = (await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Acc", lastName: "Omp" } })).upid;
  });

  it("numbers arrivals in check-in order (primary then accompanying), skips pseudo/day-use, is idempotent", async () => {
    const early = await mkArrival(new Date(Date.UTC(2026, 5, 15, 9, 0)), rtId, [accId]); // primary + 1 accompanying
    const late = await mkArrival(new Date(Date.UTC(2026, 5, 15, 16, 0)), rtId); // primary only
    const dayUse = await mkArrival(new Date(Date.UTC(2026, 5, 15, 11, 0)), pseudoRtId); // excluded

    const res = await assignRegistrationNumbers(propertyId, BIZ);
    expect(res.assigned).toBe(3); // early primary + early accompanying + late primary

    const rows = await prisma.guestRegistration.findMany({ where: { propertyId }, orderBy: { registrationNo: "asc" } });
    expect(rows.map((r) => r.registrationNo)).toEqual([1, 2, 3]);
    // Early reservation's primary is #1, its accompanying #2, late reservation's primary #3.
    expect(rows[0]).toMatchObject({ reservationId: early.id, isPrimary: true, registrationNo: 1 });
    expect(rows[1]).toMatchObject({ reservationId: early.id, isPrimary: false, registrationNo: 2 });
    expect(rows[2]).toMatchObject({ reservationId: late.id, isPrimary: true, registrationNo: 3 });
    // The pseudo/day-use arrival was excluded.
    expect(rows.some((r) => r.reservationId === dayUse.id)).toBe(false);

    // Re-running assigns nothing new (idempotent).
    const again = await assignRegistrationNumbers(propertyId, BIZ);
    expect(again.assigned).toBe(0);
    expect(await prisma.guestRegistration.count({ where: { propertyId } })).toBe(3);
  });

  it("resets the sequence at the start of a new year", async () => {
    const nextYear = new Date(Date.UTC(2027, 0, 3)); // 2027-01-03
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: `NY${uniq().slice(-4)}`, status: "CLEAN" } });
    await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `GR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: nextYear, checkOutDate: new Date(nextYear.getTime() + 2 * 86_400_000), status: "IN_HOUSE", adults: 1, checkedInAt: nextYear,
        assignments: { create: { roomTypeId: rtId, roomId: room.id, ratePlanId, startDate: nextYear, endDate: new Date(nextYear.getTime() + 2 * 86_400_000) } },
      },
    });

    const res = await assignRegistrationNumbers(propertyId, nextYear);
    expect(res.year).toBe(2027);
    const row = await prisma.guestRegistration.findFirst({ where: { propertyId, year: 2027 } });
    expect(row!.registrationNo).toBe(1); // reset for the new year
  });
});
