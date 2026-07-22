import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { getReport } = await import("@/lib/reports/registry");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const BIZ = D(2026, 6, 15); // 2026-07-15
const fakeCtx: any = { userId: "u", enterpriseId: "e", scope: "PROPERTY" };

async function run(key: string, params: Record<string, unknown>, propertyId: string) {
  return getReport(key)!.run({ ctx: fakeCtx, propertyId, params });
}

describe("Reporting engine — Reservations reports", () => {
  let propertyId: string;
  let rtId: string;
  let ratePlanId: string;
  let guestId: string;
  let methodId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({ data: { name: "RRep", slug: `test-rrep-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: ent.id, name: "RR Prop", code: `RR-${uniq()}`, legalName: "RR LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    // 2 sellable rooms + 1 out-of-order (excluded from availability).
    const roomA = await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "1", status: "CLEAN" } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "2", status: "CLEAN" } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "3", status: "OUT_OF_ORDER" } });
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId: ent.id, profileType: "GUEST", firstName: "Res", lastName: "Guest" } })).upid;
    methodId = (await prisma.paymentMethod.create({ data: { enterpriseId: ent.id, name: "Cash", type: "CASH" } })).id;

    // In-house reservation occupying the night of BIZ (1 of 2 sellable sold).
    await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `RR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: BIZ, checkOutDate: D(2026, 6, 17), status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rtId, roomId: roomA.id, ratePlanId, startDate: BIZ, endDate: D(2026, 6, 17) } },
      },
    });

    // A cancelled reservation stamped on BIZ.
    await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `RR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: D(2026, 6, 20), checkOutDate: D(2026, 6, 22), status: "CANCELLED", adults: 1,
        cancelledAt: BIZ, cancellationReason: "Guest changed plans",
      },
    });

    // A future reservation with a deposit.
    const dep = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `RR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: D(2026, 6, 18), checkOutDate: D(2026, 6, 20), status: "RESERVED", adults: 1,
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    const shift = await prisma.cashierShift.create({ data: { enterpriseId: ent.id, userId: "sys", propertyId, businessDate: BIZ, openingFloat: 0 } });
    await prisma.payment.create({ data: { folioId: dep.folios[0].id, paymentMethodId: methodId, shiftId: shift.id, amount: 200, depositPurpose: "DEPOSIT" } });
  });

  it("Availability computes sold vs available, excluding out-of-order rooms", async () => {
    const res = await run("res-availability", { range: { from: BIZ, to: BIZ }, roomTypeIds: [] }, propertyId);
    const grp = res.groups![0];
    expect(grp.label).toContain("2 room(s)"); // OOO room excluded
    const night = grp.rows[0] as any;
    expect(night.total).toBe(2);
    expect(night.sold).toBe(1);
    expect(night.available).toBe(1);
    expect(night.occPct).toBe(50);
  });

  it("Cancellations & No-Shows lists the cancelled reservation with its reason", async () => {
    const res = await run("res-cancellations", { range: { from: BIZ, to: BIZ }, kinds: [] }, propertyId);
    expect(res.rows).toHaveLength(1);
    expect(res.rows![0].kind).toBe("Cancelled");
    expect(res.rows![0].reason).toBe("Guest changed plans");
  });

  it("Reservations with Deposits shows the held deposit", async () => {
    const res = await run("res-deposits", { range: { from: D(2026, 6, 18), to: D(2026, 6, 18) } }, propertyId);
    expect(res.rows).toHaveLength(1);
    expect(res.rows![0].deposit).toBe(200);
    expect(res.totals!.deposit).toBe(200);
  });
});
