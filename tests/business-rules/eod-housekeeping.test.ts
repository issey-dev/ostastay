import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { applyEodHousekeepingShift } = await import("@/lib/eod-housekeeping");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 6, 22)); // 2026-07-22

// Runs the shift the same way Night Audit does — inside a transaction.
const runShift = (propertyId: string, mode: string, targetStatus?: string) =>
  prisma.$transaction((tx) => applyEodHousekeepingShift(tx, { propertyId, auditDate: BIZ, mode, targetStatus }));

describe("EOD housekeeping auto-status shift", () => {
  let enterpriseId: string;
  let rtId: string;      // housekeeping-enabled room type
  let pseudoRtId: string; // housekeepingEnabled but pseudo (no floor) — off-board
  let ratePlanId: string;
  let floorId: string;
  let guestId: string;

  let propertyId: string;

  const room = async (status: string, opts: { floor?: boolean; roomTypeId?: string } = {}) =>
    prisma.room.create({
      data: {
        propertyId,
        roomTypeId: opts.roomTypeId ?? rtId,
        roomNumber: `R${uniq().slice(-6)}`,
        status,
        floorId: opts.floor === false ? null : floorId,
      },
    });

  const statusOf = async (id: string) => (await prisma.room.findUnique({ where: { id } }))!.status;

  beforeAll(async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "HKShift", slug: `test-hk-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({ data: { enterpriseId, name: "HK Prop", code: `HK-${uniq()}`, legalName: "HK LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const building = await prisma.building.create({ data: { propertyId, name: "Main" } });
    floorId = (await prisma.floor.create({ data: { buildingId: building.id, name: "L1" } })).id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2, isPseudo: false, housekeepingEnabled: true } })).id;
    pseudoRtId = (await prisma.roomType.create({ data: { propertyId, name: "Day", code: "DAY", maxOccupancy: 2, isPseudo: true, housekeepingEnabled: true } })).id;
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "In", lastName: "House" } })).upid;
  });

  // Occupies a room with an IN_HOUSE reservation whose assignment spans BIZ.
  const occupy = async (roomId: string) => {
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `HK-${uniq()}`, primaryGuestId: guestId,
        checkInDate: BIZ, checkOutDate: new Date(BIZ.getTime() + 2 * 86_400_000), status: "IN_HOUSE", adults: 1, checkedInAt: BIZ,
        assignments: { create: { roomTypeId: rtId, roomId, ratePlanId, startDate: BIZ, endDate: new Date(BIZ.getTime() + 2 * 86_400_000) } },
      },
    });
    return res;
  };

  it("STEP_DOWN moves vacant rooms one status down, occupied → Dirty, OOO/OOS untouched", async () => {
    const inspected = await room("INSPECTED");
    const clean = await room("CLEAN");
    const dirty = await room("DIRTY");
    const ooo = await room("OUT_OF_ORDER");
    const oos = await room("OUT_OF_SERVICE");
    const occInspected = await room("INSPECTED");
    await occupy(occInspected.id);

    const res = await runShift(propertyId, "STEP_DOWN");

    expect(await statusOf(inspected.id)).toBe("CLEAN");   // one down
    expect(await statusOf(clean.id)).toBe("DIRTY");        // one down
    expect(await statusOf(dirty.id)).toBe("DIRTY");        // floor
    expect(await statusOf(ooo.id)).toBe("OUT_OF_ORDER");   // admin hold untouched
    expect(await statusOf(oos.id)).toBe("OUT_OF_SERVICE"); // admin hold untouched
    expect(await statusOf(occInspected.id)).toBe("DIRTY"); // occupied always dirty
    expect(res.occupiedToDirty).toBe(1);
    // vacant shifted = inspected + clean (dirty stays, not counted as a change)
    expect(res.vacantShifted).toBe(2);
  });

  it("SET_STATUS sets all vacant rooms to the target, occupied → Dirty, OOO/OOS untouched", async () => {
    const inspected = await room("INSPECTED");
    const clean = await room("CLEAN");
    const dirty = await room("DIRTY");
    const ooo = await room("OUT_OF_ORDER");
    const occ = await room("CLEAN");
    await occupy(occ.id);

    await runShift(propertyId, "SET_STATUS", "INSPECTED");

    expect(await statusOf(inspected.id)).toBe("INSPECTED");
    expect(await statusOf(clean.id)).toBe("INSPECTED");
    expect(await statusOf(dirty.id)).toBe("INSPECTED");
    expect(await statusOf(ooo.id)).toBe("OUT_OF_ORDER"); // untouched
    expect(await statusOf(occ.id)).toBe("DIRTY");        // occupied always dirty
  });

  it("OFF is a no-op and does not touch any room", async () => {
    const inspected = await room("INSPECTED");
    const occ = await room("CLEAN");
    await occupy(occ.id);

    const res = await runShift(propertyId, "OFF");

    expect(await statusOf(inspected.id)).toBe("INSPECTED");
    expect(await statusOf(occ.id)).toBe("CLEAN"); // untouched even though occupied
    expect(res).toEqual({ occupiedToDirty: 0, vacantShifted: 0 });
  });

  it("skips off-board rooms (pseudo/day-use with no floor)", async () => {
    const pseudo = await room("INSPECTED", { floor: false, roomTypeId: pseudoRtId });

    await runShift(propertyId, "SET_STATUS", "DIRTY");

    expect(await statusOf(pseudo.id)).toBe("INSPECTED"); // off the housekeeping board — untouched
  });

  it("SET_STATUS with an invalid target leaves vacant rooms alone", async () => {
    const clean = await room("CLEAN");

    const res = await runShift(propertyId, "SET_STATUS", "OUT_OF_ORDER");

    expect(await statusOf(clean.id)).toBe("CLEAN");
    expect(res.vacantShifted).toBe(0);
  });
});
