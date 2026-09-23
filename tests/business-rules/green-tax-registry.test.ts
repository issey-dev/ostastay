import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { assignRegistrationNumbers } = await import("@/lib/guest-registration");
const { stayHours, meetsMinStay, zonedInstant } = await import("@/lib/green-tax-sheet");
const { registerOverview, removeRegistration, closeGap, fileMonth, GreenTaxError } = await import("@/lib/green-tax-registry");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));

describe("Green Tax 12-hour rule", () => {
  const maldives = { timeZone: "Indian/Maldives", checkInTime: "14:00", checkOutTime: "12:00" };
  const stay = (over: Partial<Parameters<typeof stayHours>[0]> = {}) => ({
    status: "IN_HOUSE", checkInDate: D(2026, 7, 1), checkOutDate: D(2026, 7, 2), checkedInAt: null, checkedOutAt: null, ...over,
  });

  it("converts property wall-clock times in the property's zone", () => {
    expect(zonedInstant(D(2026, 7, 1), "14:00", "Indian/Maldives").toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("ACTUAL measures from the actual check-in (to actual check-out once checked out)", () => {
    // Checked in 22:00 local (17:00Z), booked out next day 12:00 local → 14 h.
    expect(stayHours(stay({ checkedInAt: D(2026, 7, 1, 17) }), maldives, "ACTUAL")).toBe(14);
    // ...but actually left at 06:00 local (01:00Z) → 8 h, under the rule.
    const early = stay({ status: "CHECKED_OUT", checkedInAt: D(2026, 7, 1, 17), checkedOutAt: D(2026, 7, 2, 1) });
    expect(meetsMinStay(early, maldives, "ACTUAL")).toBe(false);
    // Exactly 12 h counts.
    expect(meetsMinStay(stay({ status: "CHECKED_OUT", checkedInAt: D(2026, 7, 1, 17), checkedOutAt: D(2026, 7, 2, 5) }), maldives, "ACTUAL")).toBe(true);
  });

  it("STANDARD measures standard check-in to standard check-out, ignoring actual times", () => {
    const early = stay({ status: "CHECKED_OUT", checkedInAt: D(2026, 7, 1, 17), checkedOutAt: D(2026, 7, 2, 1) });
    expect(stayHours(early, maldives, "STANDARD")).toBe(22); // 14:00 → 12:00 next day
    expect(meetsMinStay(stay({ checkOutDate: D(2026, 7, 1) }), maldives, "STANDARD")).toBe(false); // same-day
  });
});

describe("Green Tax register — corrections and filing", () => {
  let enterpriseId: string;
  let propertyId: string;
  let rtId: string;
  let ratePlanId: string;
  const user = "u-gtx";

  // One guest per reservation; checkedInAt orders the numbers.
  const mkStay = async (arrive: Date, nights: number, opts: { checkedInAt?: Date; status?: string } = {}) => {
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: `G${uniq().slice(-4)}`, lastName: "Test" } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: `R${uniq().slice(-6)}`, status: "CLEAN" } });
    const out = new Date(arrive.getTime() + nights * 86_400_000);
    return prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `GT-${uniq()}`, primaryGuestId: guest.upid, checkInDate: arrive, checkOutDate: out,
        status: opts.status ?? "IN_HOUSE", adults: 1, checkedInAt: opts.checkedInAt ?? new Date(arrive.getTime() + 15 * 3_600_000),
        assignments: { create: { roomTypeId: rtId, roomId: room.id, ratePlanId, startDate: arrive, endDate: out } },
      },
    });
  };
  const numbers = async () =>
    (await prisma.guestRegistration.findMany({ where: { propertyId }, orderBy: { registrationNo: "asc" }, select: { registrationNo: true, reservationId: true } }));
  const setBusinessDate = (d: Date) => prisma.property.update({ where: { id: propertyId }, data: { businessDate: d } });

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({ data: { name: "GTX", slug: `test-gtx-${uniq()}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    const p = await prisma.property.create({ data: { enterpriseId, name: "GTX Prop", code: `GTX-${uniq()}`, legalName: "GTX LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "12:00", businessDate: D(2026, 0, 10) } });
    propertyId = p.id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } })).id;
  });

  it("EOD skips a stay planned under 12 hours", async () => {
    const day = D(2026, 0, 5);
    const ok = await mkStay(day, 1, { checkedInAt: D(2026, 0, 5, 14) }); // 22 h
    const late = await mkStay(day, 1, { checkedInAt: D(2026, 0, 6, 1) }); // arrives 01:00 next day → 11 h to 12:00
    await assignRegistrationNumbers(propertyId, day);
    const rows = await numbers();
    expect(rows.map((r) => r.reservationId)).toEqual([ok.id]);
    expect(rows.some((r) => r.reservationId === late.id)).toBe(false);
  });

  it("removing a number renumbers every later guest down by one and logs it", async () => {
    // Four more January guests → Reg Nos 2..5.
    for (let d = 6; d <= 9; d++) {
      await mkStay(D(2026, 0, d), 2);
      await assignRegistrationNumbers(propertyId, D(2026, 0, d));
    }
    expect((await numbers()).map((r) => r.registrationNo)).toEqual([1, 2, 3, 4, 5]);
    const third = (await prisma.guestRegistration.findFirstOrThrow({ where: { propertyId, registrationNo: 3 } }));

    await expect(removeRegistration({ propertyId, registrationId: third.id, reason: "x", userId: user })).rejects.toThrow(/reason/);
    const c = await removeRegistration({ propertyId, registrationId: third.id, reason: "Guest was moved to a PM room", userId: user });

    expect((await numbers()).map((r) => r.registrationNo)).toEqual([1, 2, 3, 4]);
    expect(c).toMatchObject({ action: "REMOVE", registrationNo: 3, shiftFrom: 4, shiftTo: 5 });
    const seq = await prisma.propertySequence.findFirstOrThrow({ where: { propertyId, sequenceType: "GUEST_REG_NO" } });
    expect(seq.currentValue).toBe(4); // the next arrival gets 5
  });

  it("finds and closes a gap (a registration lost with a deleted booking)", async () => {
    const second = await prisma.guestRegistration.findFirstOrThrow({ where: { propertyId, registrationNo: 2 }, select: { reservationId: true } });
    await prisma.reservation.delete({ where: { id: second.reservationId } }).catch(async () => {
      // Reservations with dependants can't be hard-deleted in every setup — drop the row instead.
      await prisma.guestRegistration.deleteMany({ where: { propertyId, registrationNo: 2 } });
    });
    const ov = await registerOverview(propertyId, 2026);
    expect(ov.gaps).toEqual([{ registrationNo: 2, locked: false }]);

    await closeGap({ propertyId, year: 2026, registrationNo: 2, reason: "Booking deleted in error", userId: user });
    expect((await numbers()).map((r) => r.registrationNo)).toEqual([1, 2, 3]);
    await expect(closeGap({ propertyId, year: 2026, registrationNo: 2, reason: "again please", userId: user })).rejects.toThrow(/not a gap/);
  });

  it("flags a short actual stay, and files months only once over, in order and clean", async () => {
    // A January guest who checked out after 6 hours — numbered at EOD, flagged afterwards.
    const shortStay = await mkStay(D(2026, 0, 20), 3, { checkedInAt: D(2026, 0, 20, 14) });
    await assignRegistrationNumbers(propertyId, D(2026, 0, 20));
    await prisma.reservation.update({ where: { id: shortStay.id }, data: { status: "CHECKED_OUT", checkedOutAt: D(2026, 0, 20, 20), checkOutDate: D(2026, 0, 21) } });
    // A February arrival.
    await mkStay(D(2026, 1, 3), 2);
    await assignRegistrationNumbers(propertyId, D(2026, 1, 3));

    const ov = await registerOverview(propertyId, 2026);
    const flagged = ov.exceptions.find((e) => e.reservationId === shortStay.id)!;
    expect(flagged.issues.map((i) => i.code)).toEqual(["SHORT_STAY"]);

    await expect(fileMonth({ propertyId, year: 2026, month: 1, userId: user })).rejects.toThrow(/isn't over/);
    await setBusinessDate(D(2026, 2, 1));
    await expect(fileMonth({ propertyId, year: 2026, month: 2, userId: user })).rejects.toThrow(/January 2026 first/);
    await expect(fileMonth({ propertyId, year: 2026, month: 1, userId: user })).rejects.toThrow(/flagged/);

    await removeRegistration({ propertyId, registrationId: flagged.registrationId, reason: "Checked out after 6 hours", userId: user });
    const jan = await fileMonth({ propertyId, year: 2026, month: 1, userId: user });
    expect(jan.month).toBe(1);
    await expect(fileMonth({ propertyId, year: 2026, month: 1, userId: user })).rejects.toThrow(/already filed/);
  });

  it("refuses any correction that would renumber a filed month", async () => {
    const ov = await registerOverview(propertyId, 2026);
    const janLast = ov.months[0].lastNo!;
    expect(ov.lockedThrough).toBe(janLast);

    // A January guest found wrong after filing — refused.
    const janReg = await prisma.guestRegistration.findFirstOrThrow({ where: { propertyId, registrationNo: 1 } });
    const refused = removeRegistration({ propertyId, registrationId: janReg.id, reason: "Found after filing", userId: user });
    await expect(refused).rejects.toBeInstanceOf(GreenTaxError);
    await expect(refused).rejects.toThrow(/filed with MIRA/);
    expect((await numbers()).map((r) => r.registrationNo)).toEqual(Array.from({ length: ov.total }, (_, i) => i + 1));

    // A February guest (unfiled, above the lock) can still be corrected.
    const febReg = await prisma.guestRegistration.findFirstOrThrow({ where: { propertyId, registrationNo: ov.lastNo } });
    expect(febReg.registrationNo).toBeGreaterThan(janLast);
    await removeRegistration({ propertyId, registrationId: febReg.id, reason: "Guest was in a PM room", userId: user });
  });
});
