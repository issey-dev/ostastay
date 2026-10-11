import { describe, it, expect } from "vitest";

// The starter room features every property gets (owner-approved list, 2026-10-11 —
// src/lib/properties/default-room-features.ts): additive, re-runnable, and never overwrites
// what a property has already renamed or switched off.

const { prisma } = await import("@/lib/db");
const { DEFAULT_ROOM_FEATURES, ensureDefaultRoomFeatures } = await import("@/lib/properties/default-room-features");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function makeProperty() {
  const enterprise = await prisma.enterprise.create({ data: { name: "RF", slug: `test-rf-${uniq()}`, type: "STANDARD" } });
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: "RF", code: `RF-${uniq()}`, legalName: "RF LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
  });
  return { enterpriseId: enterprise.id, propertyId: property.id };
}

describe("default room features", () => {
  it("has no duplicate (category, code) in the list", () => {
    const keys = DEFAULT_ROOM_FEATURES.map(([c, code]) => `${c}:${code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives a property the full list, and a second run adds nothing", async () => {
    const ids = await makeProperty();
    expect(await ensureDefaultRoomFeatures(prisma, ids)).toBe(DEFAULT_ROOM_FEATURES.length);
    expect(await prisma.systemCode.count({ where: { propertyId: ids.propertyId } })).toBe(DEFAULT_ROOM_FEATURES.length);
    expect(await ensureDefaultRoomFeatures(prisma, ids)).toBe(0);
  });

  it("never overwrites a renamed or deactivated code, and sorts new ones after existing", async () => {
    const ids = await makeProperty();
    await prisma.systemCode.create({ data: { ...ids, category: "ROOM_VIEW", code: "OCEAN", value: "Sea view", sortOrder: 5, isActive: false } });
    await prisma.systemCode.create({ data: { ...ids, category: "BED_TYPE", code: "CUSTOM", value: "Hammock", sortOrder: 0 } });

    const added = await ensureDefaultRoomFeatures(prisma, ids);
    expect(added).toBe(DEFAULT_ROOM_FEATURES.length - 1); // OCEAN already there; CUSTOM is not in the list

    const ocean = await prisma.systemCode.findFirstOrThrow({ where: { propertyId: ids.propertyId, category: "ROOM_VIEW", code: "OCEAN" } });
    expect(ocean).toMatchObject({ value: "Sea view", isActive: false, sortOrder: 5 });
    expect(await prisma.systemCode.count({ where: { propertyId: ids.propertyId, category: "ROOM_VIEW", code: "OCEAN" } })).toBe(1);

    const beach = await prisma.systemCode.findFirstOrThrow({ where: { propertyId: ids.propertyId, category: "ROOM_VIEW", code: "BEACH" } });
    expect(beach.sortOrder).toBeGreaterThan(5);
    const single = await prisma.systemCode.findFirstOrThrow({ where: { propertyId: ids.propertyId, category: "BED_TYPE", code: "SINGLE" } });
    expect(single.sortOrder).toBeGreaterThan(0);
  });

  it("only touches the property it is given", async () => {
    const a = await makeProperty();
    const b = await makeProperty();
    await ensureDefaultRoomFeatures(prisma, a);
    expect(await prisma.systemCode.count({ where: { propertyId: b.propertyId } })).toBe(0);
  });
});
