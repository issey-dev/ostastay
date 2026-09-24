import { describe, it, expect } from "vitest";

// Cleaning the demo charge codes off older properties (owner, 2026-09-24 —
// src/lib/posting/demo-code-cleanup.ts): delete what is unused, deactivate what was posted
// to, keep what setup still points at, never touch a renamed code or a system code.

const { prisma } = await import("@/lib/db");
const { ensureChart } = await import("../helpers/charge-codes");
const { provisionOutletSubgroup } = await import("@/lib/posting/outlet-subgroup");
const { cleanupDemoChargeCodes } = await import("@/lib/posting/demo-code-cleanup");
const { SYSTEM_SEED_CODES } = await import("@/lib/posting/charge-tree");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("demo charge code cleanup", () => {
  it("deletes unused demo codes, deactivates posted ones, keeps used or renamed ones and every system code", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "Demo", slug: `test-demo-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({
      data: { enterpriseId: enterprise.id, name: "Old", code: `DC-${uniq()}`, legalName: "Old LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    const propertyId = property.id;
    await ensureChart({ propertyId });
    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Grill", code: "GRL", outletType: "RESTAURANT" } });
    await provisionOutletSubgroup(prisma, { enterpriseId: enterprise.id, propertyId, outletId: outlet.id, outletName: "Grill", outletType: "RESTAURANT" });
    const code = (c: string) => prisma.chargeCode.findUniqueOrThrow({ where: { propertyId_code: { propertyId, code: c } } });

    // 2003 was posted to; 5001 is a rate plan's code; 6001 was renamed by the property.
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1 } });
    await prisma.folioLineItem.create({ data: { folioId: folio.id, chargeCodeId: (await code("2003")).id, date: new Date(), description: "Dinner", amount: 40 } });
    await prisma.ratePlan.create({ data: { propertyId, code: "TRF", name: "With transfer", chargeCodeId: (await code("5001")).id } });
    await prisma.chargeCode.update({ where: { id: (await code("6001")).id }, data: { description: "Laundry & Pressing" } });

    const dry = await cleanupDemoChargeCodes(propertyId, { apply: false });
    expect(dry.deleted).toContain("2001 Breakfast");
    expect(await prisma.chargeCode.count({ where: { propertyId, code: "2001" } })).toBe(1); // dry run changes nothing

    const r = await cleanupDemoChargeCodes(propertyId, { apply: true });
    expect(r.deactivated).toEqual(["2003 Dinner"]);
    expect(r.kept).toEqual([{ code: "5001 Airport Transfer", usedBy: ["1 rate plan(s)"] }]);
    expect(r.outletsUnlinked).toEqual(["Grill"]);

    const left = await prisma.chargeCode.findMany({ where: { propertyId }, select: { code: true, isActive: true } });
    const byCode = new Map(left.map((c) => [c.code, c]));
    expect(byCode.has("2001")).toBe(false);
    expect(byCode.has("2901")).toBe(false);
    expect(byCode.get("2003")?.isActive).toBe(false);
    expect(byCode.has("5001")).toBe(true);
    expect(byCode.has("6001")).toBe(true);
    for (const s of SYSTEM_SEED_CODES) expect(byCode.has(s.code), s.code).toBe(true);
    // 29RV emptied → gone; 20RV still holds the posted 2003 → stays.
    expect(await prisma.chargeSubgroup.count({ where: { propertyId, code: "29RV" } })).toBe(0);
    expect(await prisma.chargeSubgroup.count({ where: { propertyId, code: "20RV" } })).toBe(1);

    // Running it again finds nothing more to do.
    const again = await cleanupDemoChargeCodes(propertyId, { apply: true });
    expect(again.deleted).toEqual([]);
    expect(again.deactivated).toEqual([]);
  });
});
