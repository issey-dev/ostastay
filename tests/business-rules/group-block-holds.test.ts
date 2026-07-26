import { describe, it, expect, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { findTypeAvailabilityConflicts } = await import("@/lib/availability");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// One property, one room type with 3 sellable physical rooms.
async function setup() {
  const enterprise = await prisma.enterprise.create({ data: { name: "GB", slug: `gb-${uniq()}`, type: "STANDARD" } });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `GB-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: "Standard", code: "STD", baseOccupancy: 2, maxOccupancy: 3 },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `10${i}`, status: "CLEAN" } });
  }
  return { property, roomType };
}

const seg = (roomTypeId: string) => ({ roomTypeId, startDate: new Date("2026-08-02"), endDate: new Date("2026-08-03") });

describe("Group block holds deduct from availability (src/lib/availability.ts)", () => {
  it("blocks a normal booking that would oversell into held rooms, but the block's own pickup draws from the hold", async () => {
    const { property, roomType } = await setup();
    // Hold 2 of the 3 rooms for the block span.
    const block = await prisma.groupBlock.create({
      data: {
        propertyId: property.id, code: `B-${uniq()}`, name: "Blk",
        startDate: new Date("2026-08-01"), endDate: new Date("2026-08-05"),
        totalRoomsHeld: 2, status: "TENTATIVE",
        roomHolds: { create: [{ roomTypeId: roomType.id, quantity: 2 }] },
      },
    });

    const twoRooms = [seg(roomType.id), seg(roomType.id)];

    // Capacity 3, 2 outstanding held → only 1 sellable. Two rooms oversells.
    expect((await findTypeAvailabilityConflicts({ propertyId: property.id, segments: twoRooms })).length).toBeGreaterThan(0);
    // One room is fine.
    expect((await findTypeAvailabilityConflicts({ propertyId: property.id, segments: [seg(roomType.id)] })).length).toBe(0);
    // A pickup of THIS block ignores its own hold → 2 rooms fit within capacity 3.
    expect((await findTypeAvailabilityConflicts({ propertyId: property.id, segments: twoRooms, excludeGroupBlockId: block.id })).length).toBe(0);
  });

  it("a cancelled block holds nothing", async () => {
    const { property, roomType } = await setup();
    await prisma.groupBlock.create({
      data: {
        propertyId: property.id, code: `B-${uniq()}`, name: "Blk",
        startDate: new Date("2026-08-01"), endDate: new Date("2026-08-05"),
        totalRoomsHeld: 3, status: "CANCELLED",
        roomHolds: { create: [{ roomTypeId: roomType.id, quantity: 3 }] },
      },
    });
    // Despite a hold of 3, a cancelled block releases inventory — all 3 rooms bookable.
    const threeRooms = [seg(roomType.id), seg(roomType.id), seg(roomType.id)];
    expect((await findTypeAvailabilityConflicts({ propertyId: property.id, segments: threeRooms })).length).toBe(0);
  });
});
