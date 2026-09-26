import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// "Copy from another property" (Hub Setup Phase 5 — src/lib/property-copy.ts). The owner's
// rules: an item the target already has is warned about and SKIPPED, never overwritten;
// what an item needs comes along; every copied row belongs to the TARGET property.

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
const { customChargeCode, ensureChart } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");
const { previewCopy, runCopy } = await import("@/lib/property-copy");
const { getPropertySettings } = await import("@/lib/property-settings");
const copyRoute = await import("@/app/api/properties/[id]/copy/route");
const { provisionOutletSubgroup } = await import("@/lib/posting/outlet-subgroup");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

describe("Copy from another property", () => {
  let enterpriseId: string;
  let adminId: string;
  let lagoonAdminId: string;
  let adminRoleId: string;

  const makeProperty = (name: string, ent = enterpriseId) =>
    prisma.property.create({
      data: { enterpriseId: ent, name, code: `PC-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "PC", slug: `test-pc-${uniq()}`, type: "STANDARD" } })).id;
    // The Spa and Excursions sections are copied only where the enterprise has the add-on.
    await prisma.enterpriseAddonAccess.createMany({
      data: [{ enterpriseId, module: "SPA", enabled: true }, { enterpriseId, module: "EXCURSIONS", enabled: true }],
    });
    adminRoleId = roleIds["Admin"];
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `pc-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    const lagoon = await makeProperty("Lagoon");
    lagoonAdminId = (await prisma.user.create({
      data: { enterpriseId, email: `pc-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: lagoon.id },
    })).id;
  });

  it("copies dropdown list options and skips — never overwrites — one the target already has", async () => {
    const [a, b] = [await makeProperty("A"), await makeProperty("B")];
    await prisma.systemCode.createMany({
      data: [
        { enterpriseId, propertyId: a.id, category: "SPECIAL_REQUEST", code: "SUNSET", value: "Sunset dinner" },
        { enterpriseId, propertyId: a.id, category: "SPECIAL_REQUEST", code: "COT", value: "Baby cot" },
        { enterpriseId, propertyId: b.id, category: "SPECIAL_REQUEST", code: "COT", value: "Cot (B's own wording)" },
      ],
    });

    const preview = await previewCopy("lists", a.id, b.id);
    expect(preview.find((i) => i.key === "SPECIAL_REQUEST:COT")?.exists).toBe(true);
    expect(preview.find((i) => i.key === "SPECIAL_REQUEST:SUNSET")?.exists).toBe(false);

    const report = await runCopy("lists", a.id, b.id, ["SPECIAL_REQUEST:SUNSET", "SPECIAL_REQUEST:COT"]);
    expect(report.copied.map((i) => i.key)).toEqual(["SPECIAL_REQUEST:SUNSET"]);
    expect(report.skipped.map((i) => i.key)).toEqual(["SPECIAL_REQUEST:COT"]);

    const cot = await prisma.systemCode.findFirstOrThrow({ where: { propertyId: b.id, category: "SPECIAL_REQUEST", code: "COT" } });
    expect(cot.value).toBe("Cot (B's own wording)");
  });

  it("copies a charge code with everything it needs, all owned by the target property", async () => {
    const [a, b] = [await makeProperty("ChartA"), await makeProperty("ChartB")];
    await ensureChart({ propertyId: a.id });
    // A custom group + subgroup + tax profile + a generate, none of which B has.
    const group = await prisma.chargeGroup.create({ data: { enterpriseId, propertyId: a.id, code: "WELL", name: "Wellness", reportBucket: "OTHER" } });
    const sub = await prisma.chargeSubgroup.create({ data: { enterpriseId, propertyId: a.id, chargeGroupId: group.id, code: "WL01", name: "Yoga" } });
    const profile = await prisma.taxProfile.create({
      data: { enterpriseId, propertyId: a.id, name: "Wellness tax", rates: { create: { name: "GST", ratePercent: 17, effectiveFrom: new Date("2026-01-01") } } },
    });
    const yoga = await prisma.chargeCode.create({
      data: { enterpriseId, propertyId: a.id, code: "YOGA", description: "Yoga class", chargeSubgroupId: sub.id, useDefaultTax: false, taxProfileId: profile.id },
    });
    const levy = await customChargeCode({ propertyId: a.id }, { code: "YOGALEVY", description: "Yoga levy" });
    await prisma.chargeCodeGenerate.create({
      data: { enterpriseId, propertyId: a.id, generatorCodeId: yoga.id, generatedCodeId: levy.id, method: "PERCENT", value: 5 },
    });

    const report = await runCopy("charge-codes", a.id, b.id, ["YOGA"]);
    expect(report.copied.map((i) => i.key)).toEqual(["YOGA"]);
    const pulled = report.pulled.map((i) => i.key);
    expect(pulled).toEqual(expect.arrayContaining(["WELL", "WL01", "Wellness tax", "YOGALEVY"]));

    const copied = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId: b.id, code: "YOGA" } },
      include: { chargeSubgroup: { include: { chargeGroup: true } }, taxProfile: { include: { rates: true } }, generatesFrom: { include: { generatedCode: true } } },
    });
    expect(copied.chargeSubgroup.propertyId).toBe(b.id);
    expect(copied.chargeSubgroup.chargeGroup.propertyId).toBe(b.id);
    expect(copied.taxProfile?.propertyId).toBe(b.id);
    expect(copied.taxProfile?.rates[0].ratePercent).toBe(17);
    expect(copied.generatesFrom).toHaveLength(1);
    expect(copied.generatesFrom[0].generatedCode.propertyId).toBe(b.id);
    expect(copied.generatesFrom[0].value).toBe(5);

    // Copying again changes nothing — it is all already there.
    const again = await runCopy("charge-codes", a.id, b.id, ["YOGA"]);
    expect(again.copied).toHaveLength(0);
    expect(again.skipped.map((i) => i.key)).toEqual(["YOGA"]);
  });

  it("copies a payment method and pulls along the charge code it posts to", async () => {
    const [a, b] = [await makeProperty("PayA"), await makeProperty("PayB")];
    const code = await customChargeCode({ propertyId: a.id }, { code: "9101", description: "Amex" });
    await prisma.paymentMethod.create({ data: { enterpriseId, propertyId: a.id, name: "Amex", type: "CARD", chargeCodeId: code.id } });

    const report = await runCopy("payment-methods", a.id, b.id, ["Amex"]);
    expect(report.copied.map((i) => i.key)).toEqual(["Amex"]);
    expect(report.pulled.map((i) => i.key)).toContain("9101");
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { propertyId: b.id, name: "Amex" }, include: { chargeCode: true } });
    expect(method.chargeCode?.propertyId).toBe(b.id);
  });

  it("copies stationery wording only into fields the target left empty", async () => {
    const [a, b] = [await makeProperty("DocA"), await makeProperty("DocB")];
    await setPropertySettings(a.id, { invoiceFooterText: "A footer", receiptTerms: "A receipt terms" });
    await setPropertySettings(b.id, { receiptTerms: "B's own receipt terms" });

    const report = await runCopy("stationery", a.id, b.id, ["invoiceFooterText", "receiptTerms"]);
    expect(report.copied.map((i) => i.key)).toEqual(["invoiceFooterText"]);
    expect(report.skipped.map((i) => i.key)).toEqual(["receiptTerms"]);
    const bSettings = await getPropertySettings(b.id);
    expect(bSettings.invoiceFooterText).toBe("A footer");
    expect(bSettings.receiptTerms).toBe("B's own receipt terms");
  });

  it("copies a meal plan with the allocations it includes, and their charge codes", async () => {
    const [a, b] = [await makeProperty("MealA"), await makeProperty("MealB")];
    const code = await customChargeCode({ propertyId: a.id }, { code: "2201", description: "Breakfast revenue" });
    const bf = await prisma.allocation.create({
      data: {
        propertyId: a.id, code: "BF", name: "Breakfast", chargeCodeId: code.id,
        rates: {
          create: [
            { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") },
            { adultPrice: 12, childPrice: 6, effectiveFrom: new Date("2026-07-01"), effectiveTo: null },
          ],
        },
      },
    });
    const bb = await prisma.mealPlan.create({ data: { propertyId: a.id, code: "BB", name: "Bed & Breakfast" } });
    await prisma.mealPlanAllocation.create({ data: { mealPlanId: bb.id, allocationId: bf.id } });

    const report = await runCopy("meal-plans", a.id, b.id, ["BB"]);
    expect(report.copied.map((i) => i.key)).toEqual(["BB"]);
    expect(report.pulled.map((i) => i.key)).toEqual(expect.arrayContaining(["BF", "2201"]));
    const plan = await prisma.mealPlan.findUniqueOrThrow({
      where: { propertyId_code: { propertyId: b.id, code: "BB" } },
      include: {
        allocationLinks: {
          include: { allocation: { include: { chargeCode: true, rates: { orderBy: { effectiveFrom: "asc" } } } } },
        },
      },
    });
    expect(plan.allocationLinks[0].allocation.propertyId).toBe(b.id);
    expect(plan.allocationLinks[0].allocation.chargeCode.propertyId).toBe(b.id);
    // The pulled-along allocation brings its dated price rows — otherwise it posts nothing.
    expect(
      plan.allocationLinks[0].allocation.rates.map((r) => [r.adultPrice, r.childPrice, r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null])
    ).toEqual([
      [10, 5, "2026-01-01", "2026-06-30"],
      [12, 6, "2026-07-01", null],
    ]);
  });

  it("copies a room type (never its rooms) and brings the room-feature options it uses", async () => {
    const [a, b] = [await makeProperty("RoomA"), await makeProperty("RoomB")];
    await prisma.systemCode.create({ data: { enterpriseId, propertyId: a.id, category: "ROOM_VIEW", code: "OCEAN", value: "Ocean view" } });
    const rt = await prisma.roomType.create({
      data: { propertyId: a.id, code: "WV", name: "Water Villa", maxOccupancy: 3, features: { create: { category: "ROOM_VIEW", code: "OCEAN" } } },
    });
    await prisma.room.create({ data: { propertyId: a.id, roomTypeId: rt.id, roomNumber: "101", status: "AVAILABLE" } });

    const report = await runCopy("room-types", a.id, b.id, ["WV"]);
    expect(report.copied.map((i) => i.key)).toEqual(["WV"]);
    expect(report.pulled.map((i) => i.key)).toEqual(["ROOM_VIEW:OCEAN"]);
    const copied = await prisma.roomType.findFirstOrThrow({ where: { propertyId: b.id, code: "WV" }, include: { features: true } });
    expect(copied.features.map((f) => f.code)).toEqual(["OCEAN"]);
    expect(await prisma.room.count({ where: { propertyId: b.id } })).toBe(0);
  });

  it("copies an outlet with its charge codes, its own subgroup pointing at the NEW outlet", async () => {
    const [a, b] = [await makeProperty("OutA"), await makeProperty("OutB")];
    await ensureChart({ propertyId: a.id });
    const outlet = await prisma.outlet.create({ data: { propertyId: a.id, name: "Garden Restaurant", code: "GRD", outletType: "RESTAURANT", phone: "+960 000" } });
    const group = await prisma.chargeGroup.findUniqueOrThrow({ where: { propertyId_code: { propertyId: a.id, code: "FNB" } } });
    const sub = await prisma.chargeSubgroup.create({ data: { enterpriseId, propertyId: a.id, chargeGroupId: group.id, code: "27RV", name: "Garden Restaurant", outletId: outlet.id } });
    const lunch = await prisma.chargeCode.create({ data: { enterpriseId, propertyId: a.id, code: "GRD01", description: "Garden lunch", chargeSubgroupId: sub.id } });
    await prisma.outletChargeCode.create({ data: { outletId: outlet.id, chargeCodeId: lunch.id } });

    const report = await runCopy("outlets", a.id, b.id, ["Garden Restaurant"]);
    expect(report.copied.map((i) => i.key)).toEqual(["Garden Restaurant"]);
    const copied = await prisma.outlet.findFirstOrThrow({ where: { propertyId: b.id, name: "Garden Restaurant" }, include: { chargeCodes: { include: { chargeCode: { include: { chargeSubgroup: true } } } } } });
    // Contact details are the source outlet's own.
    expect(copied.phone).toBeNull();
    expect(copied.chargeCodes).toHaveLength(1);
    expect(copied.chargeCodes[0].chargeCode.propertyId).toBe(b.id);
    expect(copied.chargeCodes[0].chargeCode.chargeSubgroup.outletId).toBe(copied.id);
  });

  it("never links a copied outlet to another outlet's codes that share its numbers", async () => {
    const [a, b] = [await makeProperty("ColA"), await makeProperty("ColB")];
    await ensureChart({ propertyId: a.id });
    await ensureChart({ propertyId: b.id });
    const beachBar = await prisma.outlet.create({ data: { propertyId: a.id, name: "Beach Bar", outletType: "RESTAURANT" } });
    const main = await prisma.outlet.create({ data: { propertyId: b.id, name: "Main Restaurant", outletType: "RESTAURANT" } });
    await provisionOutletSubgroup(prisma, { enterpriseId, propertyId: a.id, outletId: beachBar.id, outletName: "Beach Bar", outletType: "RESTAURANT" });
    await provisionOutletSubgroup(prisma, { enterpriseId, propertyId: b.id, outletId: main.id, outletName: "Main Restaurant", outletType: "RESTAURANT" });

    const report = await runCopy("outlets", a.id, b.id, ["Beach Bar"]);
    const copied = await prisma.outlet.findFirstOrThrow({
      where: { propertyId: b.id, name: "Beach Bar" },
      include: { chargeCodes: { include: { chargeCode: { include: { chargeSubgroup: true } } } } },
    });
    // A plain copy: B already uses the numbers, so nothing is linked, renumbered or invented
    // — each code is reported as skipped, and Main Restaurant's codes stay its own.
    expect(copied.chargeCodes).toHaveLength(0);
    expect(await prisma.chargeSubgroup.count({ where: { outletId: copied.id } })).toBe(0);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(report.skipped.every((i) => i.label.includes("already used at this property"))).toBe(true);
    const mainSub = await prisma.chargeSubgroup.findFirstOrThrow({ where: { outletId: main.id } });
    expect(mainSub.propertyId).toBe(b.id);
  });

  it("copies generates calculated on another generate with the basis re-pointed, whatever their order", async () => {
    const [a, b] = [await makeProperty("GenA"), await makeProperty("GenB")];
    await ensureChart({ propertyId: a.id });
    await ensureChart({ propertyId: b.id });
    const group = await prisma.chargeGroup.findUniqueOrThrow({ where: { propertyId_code: { propertyId: a.id, code: "FNB" } } });
    const sub = await prisma.chargeSubgroup.create({ data: { enterpriseId, propertyId: a.id, chargeGroupId: group.id, code: "KSK", name: "Kiosk" } });
    const snack = await prisma.chargeCode.create({ data: { enterpriseId, propertyId: a.id, code: "KSK01", description: "Snack", chargeSubgroupId: sub.id } });
    const sc = await prisma.chargeCode.create({ data: { enterpriseId, propertyId: a.id, code: "KSKSC", description: "Kiosk SC", chargeSubgroupId: sub.id } });
    const gst = await prisma.chargeCode.create({ data: { enterpriseId, propertyId: a.id, code: "KSKGST", description: "Kiosk GST", chargeSubgroupId: sub.id } });
    const scGen = await prisma.chargeCodeGenerate.create({ data: { enterpriseId, propertyId: a.id, generatorCodeId: snack.id, generatedCodeId: sc.id, method: "PERCENT", value: 10, calculateOn: "NET", sortOrder: 20 } });
    // Sorts BEFORE its basis.
    await prisma.chargeCodeGenerate.create({ data: { enterpriseId, propertyId: a.id, generatorCodeId: snack.id, generatedCodeId: gst.id, method: "PERCENT", value: 17, calculateOn: "ANOTHER_GENERATE", basisGenerateId: scGen.id, sortOrder: 10 } });

    await runCopy("charge-codes", a.id, b.id, ["KSK01"]);
    const gens = await prisma.chargeCodeGenerate.findMany({ where: { propertyId: b.id, generatorCode: { code: "KSK01" } }, include: { generatedCode: true } });
    const newSc = gens.find((g) => g.generatedCode.code === "KSKSC")!;
    const newGst = gens.find((g) => g.generatedCode.code === "KSKGST")!;
    expect(newGst.calculateOn).toBe("ANOTHER_GENERATE");
    expect(newGst.basisGenerateId).toBe(newSc.id);
  });

  it("offers no source to a single-property admin, and refuses a copy from a property they cannot open", async () => {
    const lagoonId = (await prisma.user.findUniqueOrThrow({ where: { id: lagoonAdminId } })).propertyId!;
    const beach = await makeProperty("Beach");
    const sources = await asUser(lagoonAdminId, () =>
      copyRoute.GET(new Request(`http://localhost/api/properties/${lagoonId}/copy`), { params: Promise.resolve({ id: lagoonId }) })
    );
    expect((await sources.json()).sources).toEqual([]);

    const post = await asUser(lagoonAdminId, () =>
      copyRoute.POST(
        new Request(`http://localhost/api/properties/${lagoonId}/copy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section: "lists", from: beach.id, keys: ["SPECIAL_REQUEST:X"] }),
        }),
        { params: Promise.resolve({ id: lagoonId }) }
      )
    );
    expect(post.status).toBe(403);
  });

  it("never copies across enterprises", async () => {
    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `test-pc-o-${uniq()}`, type: "STANDARD" } });
    const foreign = await makeProperty("Foreign", other.id);
    const mine = await makeProperty("Mine");
    await expect(previewCopy("lists", foreign.id, mine.id)).rejects.toThrow();
    const res = await asUser(adminId, () =>
      copyRoute.GET(new Request(`http://localhost/api/properties/${mine.id}/copy?section=lists&from=${foreign.id}`), { params: Promise.resolve({ id: mine.id }) })
    );
    expect(res.status).toBe(403);
    // The Spa / Excursions sections keep the same guard.
    await expect(runCopy("spa", foreign.id, mine.id, ["settings"])).rejects.toThrow();
    await expect(runCopy("excursions", foreign.id, mine.id, ["X"])).rejects.toThrow();
  });

  // ─── Phase 5b: allocations, Spa catalogue, excursions ─────────────────────────────

  it("copies stand-alone allocations with their rates and charge code, and a second run skips them", async () => {
    const [a, b] = [await makeProperty("AllocA"), await makeProperty("AllocB")];
    const code = await customChargeCode({ propertyId: a.id }, { code: "2291", description: "Transfer revenue" });
    await prisma.allocation.create({
      data: {
        propertyId: a.id, code: "TRF", name: "Speedboat transfer", type: "TRANSFER", chargeCodeId: code.id, sellSeparate: true,
        rates: { create: [{ adultPrice: 80, childPrice: 40, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }] },
      },
    });

    const preview = await previewCopy("allocations", a.id, b.id);
    expect(preview.map((i) => [i.key, i.exists])).toEqual([["TRF", false]]);

    const report = await runCopy("allocations", a.id, b.id, ["TRF"]);
    expect(report.copied.map((i) => i.key)).toEqual(["TRF"]);
    expect(report.pulled.map((i) => i.key)).toContain("2291");
    const copied = await prisma.allocation.findUniqueOrThrow({
      where: { propertyId_code: { propertyId: b.id, code: "TRF" } },
      include: { rates: true, chargeCode: true },
    });
    expect(copied.chargeCode.propertyId).toBe(b.id);
    expect(copied.sellSeparate).toBe(true);
    expect(copied.rates.map((r) => [r.adultPrice, r.childPrice])).toEqual([[80, 40]]);

    // The target changes its copy; copying again never overwrites it.
    await prisma.allocation.update({ where: { id: copied.id }, data: { name: "B's own transfer" } });
    expect((await previewCopy("allocations", a.id, b.id))[0].exists).toBe(true);
    const again = await runCopy("allocations", a.id, b.id, ["TRF"]);
    expect(again.copied).toEqual([]);
    expect(again.pulled).toEqual([]);
    expect(again.skipped.map((i) => i.key)).toEqual(["TRF"]);
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: copied.id } })).name).toBe("B's own transfer");
  });

  it("copies the Spa catalogue — categories, treatments with rates and rooms, rooms, settings — never therapists", async () => {
    const [a, b] = [await makeProperty("SpaA"), await makeProperty("SpaB")];
    const code = await customChargeCode({ propertyId: a.id }, { code: "2501", description: "Spa revenue" });
    const massage = await prisma.spaTreatmentCategory.create({ data: { propertyId: a.id, name: "Massage", displayOrder: 1 } });
    const facial = await prisma.spaTreatmentCategory.create({ data: { propertyId: a.id, name: "Facial", displayOrder: 2 } });
    const room1 = await prisma.spaRoom.create({ data: { propertyId: a.id, name: "Room 1", code: "R1" } });
    const couple = await prisma.spaRoom.create({ data: { propertyId: a.id, name: "Couple room", code: "CPL", capacity: 2 } });
    const balinese = await prisma.spaTreatment.create({
      data: {
        propertyId: a.id, categoryId: massage.id, chargeCodeId: code.id, name: "Balinese massage", defaultDurationMinutes: 60,
        maxParticipants: 2, publishOnline: true, publicDescription: "A classic",
        rates: {
          create: [
            { price: 90, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") },
            { price: 100, effectiveFrom: new Date("2026-07-01"), effectiveTo: null },
          ],
        },
        compatibleRooms: { create: [{ roomId: room1.id }, { roomId: couple.id, preferred: true }] },
      },
    });
    await prisma.spaTreatment.create({
      data: { propertyId: a.id, categoryId: facial.id, chargeCodeId: code.id, name: "Hydrating facial", defaultDurationMinutes: 45 },
    });
    await prisma.spaSettings.create({ data: { propertyId: a.id, defaultOpeningTime: "08:00", cancellationCutoffHours: 12, noShowChargeType: "FULL" } });
    const therapist = await prisma.spaTherapist.create({ data: { propertyId: a.id, displayName: "Ayu" } });
    await prisma.spaTherapistTreatment.create({ data: { therapistId: therapist.id, treatmentId: balinese.id } });

    const preview = await previewCopy("spa", a.id, b.id);
    expect(preview.map((i) => [i.group, i.key])).toEqual([
      ["Categories", "category:Massage"],
      ["Categories", "category:Facial"],
      ["Treatments", "treatment:Balinese massage"],
      ["Treatments", "treatment:Hydrating facial"],
      ["Treatment rooms", "room:Couple room"],
      ["Treatment rooms", "room:Room 1"],
      ["Settings", "settings"],
    ]);
    expect(preview.every((i) => !i.exists)).toBe(true);

    // Only the treatment and the settings are ticked: its category, charge code and rooms come along.
    const report = await runCopy("spa", a.id, b.id, ["treatment:Balinese massage", "settings"]);
    expect(report.copied.map((i) => i.key)).toEqual(["treatment:Balinese massage", "settings"]);
    expect(report.pulled.map((i) => i.key)).toEqual(expect.arrayContaining(["category:Massage", "2501", "room:Room 1", "room:Couple room"]));
    expect(report.pulled.map((i) => i.key)).not.toContain("category:Facial");

    const t = await prisma.spaTreatment.findFirstOrThrow({
      where: { propertyId: b.id, name: "Balinese massage" },
      include: { category: true, chargeCode: true, rates: { orderBy: { effectiveFrom: "asc" } }, compatibleRooms: { include: { room: true } }, therapistSkills: true },
    });
    expect(t.category.propertyId).toBe(b.id);
    expect(t.chargeCode.propertyId).toBe(b.id);
    expect(t.maxParticipants).toBe(2);
    expect(t.publishOnline).toBe(false); // going online is the target's own choice
    expect(t.publicDescription).toBe("A classic");
    expect(t.rates.map((r) => [r.price, r.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([[90, "2026-06-30"], [100, null]]);
    expect(t.compatibleRooms.map((l) => [l.room.name, l.room.propertyId === b.id, l.preferred]).sort()).toEqual([
      ["Couple room", true, true],
      ["Room 1", true, false],
    ]);
    expect(t.therapistSkills).toEqual([]);
    expect(await prisma.spaTherapist.count({ where: { propertyId: b.id } })).toBe(0);
    const settings = await prisma.spaSettings.findUniqueOrThrow({ where: { propertyId: b.id } });
    expect([settings.defaultOpeningTime, settings.cancellationCutoffHours, settings.noShowChargeType]).toEqual(["08:00", 12, "FULL"]);

    // Second run: the target has changed its copies — everything is skipped, nothing overwritten.
    await prisma.spaTreatment.update({ where: { id: t.id }, data: { defaultDurationMinutes: 75 } });
    await prisma.spaSettings.update({ where: { propertyId: b.id }, data: { defaultOpeningTime: "10:00" } });
    await prisma.spaRoom.updateMany({ where: { propertyId: b.id, name: "Room 1" }, data: { name: "Room One" } }); // still matched by code R1
    const keys = preview.map((i) => i.key).filter((k) => k !== "treatment:Hydrating facial" && k !== "category:Facial");
    const again = await runCopy("spa", a.id, b.id, keys);
    expect(again.copied).toEqual([]);
    expect(again.pulled).toEqual([]);
    expect(again.skipped.map((i) => i.key).sort()).toEqual(["category:Massage", "room:Couple room", "room:Room 1", "settings", "treatment:Balinese massage"]);
    expect((await prisma.spaTreatment.findUniqueOrThrow({ where: { id: t.id } })).defaultDurationMinutes).toBe(75);
    expect((await prisma.spaSettings.findUniqueOrThrow({ where: { propertyId: b.id } })).defaultOpeningTime).toBe("10:00");
    expect(await prisma.spaRoom.count({ where: { propertyId: b.id } })).toBe(2);
  });

  it("copies excursions with their rates, schedules and charge code — never departures or bookings", async () => {
    const [a, b] = [await makeProperty("ExcA"), await makeProperty("ExcB")];
    const code = await customChargeCode({ propertyId: a.id }, { code: "2601", description: "Excursion revenue" });
    const snork = await prisma.excursionType.create({
      data: {
        propertyId: a.id, code: "SNORK", name: "Snorkelling trip", chargeCodeId: code.id, cutoffHours: 12, publishOnline: true,
        rates: { create: [{ adultPrice: 50, childPrice: 25, infantPrice: 0, effectiveFrom: new Date("2026-01-01") }] },
        schedules: { create: [{ daysOfWeek: "MON,WED,FRI", departureTime: "09:00", meetingTime: "08:45", meetingPoint: "Main jetty", capacity: 12, minCapacity: 4 }] },
      },
      include: { schedules: true },
    });
    await prisma.excursionDeparture.create({
      data: { excursionTypeId: snork.id, scheduleId: snork.schedules[0].id, departureDate: new Date("2026-10-05"), departureTime: "09:00", capacity: 12 },
    });

    const preview = await previewCopy("excursions", a.id, b.id);
    expect(preview.map((i) => [i.key, i.exists])).toEqual([["SNORK", false]]);
    expect(preview[0].detail).toContain("1 schedule");

    const report = await runCopy("excursions", a.id, b.id, ["SNORK"]);
    expect(report.copied.map((i) => i.key)).toEqual(["SNORK"]);
    expect(report.pulled.map((i) => i.key)).toContain("2601");
    const copied = await prisma.excursionType.findUniqueOrThrow({
      where: { propertyId_code: { propertyId: b.id, code: "SNORK" } },
      include: { rates: true, schedules: true, chargeCode: true, departures: true },
    });
    expect(copied.chargeCode.propertyId).toBe(b.id);
    expect(copied.cutoffHours).toBe(12);
    expect(copied.publishOnline).toBe(false);
    expect(copied.rates.map((r) => [r.adultPrice, r.childPrice])).toEqual([[50, 25]]);
    expect(copied.schedules.map((s) => [s.daysOfWeek, s.departureTime, s.meetingPoint, s.capacity, s.minCapacity])).toEqual([
      ["MON,WED,FRI", "09:00", "Main jetty", 12, 4],
    ]);
    expect(copied.departures).toEqual([]);
    expect(await prisma.excursionBooking.count({ where: { departure: { excursionTypeId: copied.id } } })).toBe(0);

    await prisma.excursionType.update({ where: { id: copied.id }, data: { name: "B's own trip" } });
    const again = await runCopy("excursions", a.id, b.id, ["SNORK"]);
    expect(again.copied).toEqual([]);
    expect(again.skipped.map((i) => i.key)).toEqual(["SNORK"]);
    const after = await prisma.excursionType.findUniqueOrThrow({ where: { id: copied.id }, include: { schedules: true } });
    expect(after.name).toBe("B's own trip");
    expect(after.schedules).toHaveLength(1);
  });

  it("refuses the Spa and Excursions sections for an enterprise without the add-on", async () => {
    const bare = await prisma.enterprise.create({ data: { name: "Bare", slug: `test-pc-bare-${uniq()}`, type: "STANDARD" } });
    const [a, b] = [await makeProperty("BareA", bare.id), await makeProperty("BareB", bare.id)];
    const bareAdmin = await prisma.user.create({
      data: {
        enterpriseId: bare.id, email: `pc-bare-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "B", lastName: "A", roles: { create: { roleId: adminRoleId } }, scope: "ENTERPRISE",
      },
    });
    await expect(previewCopy("spa", a.id, b.id)).rejects.toThrow(/Spa add-on/);
    await expect(runCopy("excursions", a.id, b.id, ["SNORK"])).rejects.toThrow(/Excursions add-on/);

    for (const section of ["spa", "excursions"]) {
      const get = await asUser(bareAdmin.id, () =>
        copyRoute.GET(new Request(`http://localhost/api/properties/${b.id}/copy?section=${section}&from=${a.id}`), { params: Promise.resolve({ id: b.id }) })
      );
      expect(get.status).toBe(403);
      const post = await asUser(bareAdmin.id, () =>
        copyRoute.POST(
          new Request(`http://localhost/api/properties/${b.id}/copy`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ section, from: a.id, keys: ["x"] }),
          }),
          { params: Promise.resolve({ id: b.id }) }
        )
      );
      expect(post.status).toBe(403);
    }
    // Allocations are no add-on: the same enterprise copies them.
    const ok = await asUser(bareAdmin.id, () =>
      copyRoute.GET(new Request(`http://localhost/api/properties/${b.id}/copy?section=allocations&from=${a.id}`), { params: Promise.resolve({ id: b.id }) })
    );
    expect(ok.status).toBe(200);
  });
});
