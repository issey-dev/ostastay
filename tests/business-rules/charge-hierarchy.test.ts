import { describe, it, expect, beforeAll } from "vitest";

const { prisma } = await import("@/lib/db");
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");
const { resolveChargeCode } = await import("@/lib/posting/resolve-charge-code");
const { postCharge, chargeCodeInclude } = await import("@/lib/posting/post-charge");
const { CANONICAL_GROUPS, STANDARD_CHARGE_CODES } = await import("@/lib/posting/charge-tree");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");

// The seeder + the role resolver: the two pieces that closed the provisioning gap
// (CHARGE_CODE_PLAN.md §1.3) and killed the `findFirst({ code: "1000" })` lookups.

const slug = (name: string) => `test-charge-tree-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function freshEnterprise(name: string) {
  return prisma.enterprise.create({ data: { name, slug: slug(name), type: "STANDARD" } });
}

// The chart is per PROPERTY since 2026-09-23 — every case gets its own property.
async function freshProperty(name: string, enterpriseId?: string) {
  const ent = enterpriseId ? { id: enterpriseId } : await freshEnterprise(name);
  const property = await prisma.property.create({
    data: {
      enterpriseId: ent.id, name, code: slug(name).toUpperCase(), legalName: `${name} LLC`,
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  return { ent, propertyId: property.id };
}

describe("ensureChargeTree", () => {
  let propertyId: string;

  beforeAll(async () => {
    ({ propertyId } = await freshProperty("seed"));
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
  });

  it("creates the whole canonical group/subgroup tree", async () => {
    const groups = await prisma.chargeGroup.findMany({ where: { propertyId }, include: { subgroups: true } });
    expect(groups).toHaveLength(CANONICAL_GROUPS.length);
    for (const canonical of CANONICAL_GROUPS) {
      const actual = groups.find((g) => g.code === canonical.code);
      expect(actual, `group ${canonical.code}`).toBeDefined();
      expect(actual!.reportBucket).toBe(canonical.reportBucket);
      expect(actual!.isSystem).toBe(true);
      expect(actual!.subgroups).toHaveLength(canonical.subgroups.length);
    }
  });

  it("creates the whole standard chart of charge codes", async () => {
    const codes = await prisma.chargeCode.findMany({ where: { propertyId } });
    expect(codes).toHaveLength(STANDARD_CHARGE_CODES.length);
    for (const expected of STANDARD_CHARGE_CODES) {
      const actual = codes.find((c) => c.code === expected.code);
      expect(actual, `code ${expected.code}`).toBeDefined();
      expect(actual!.postingType).toBe(expected.postingType);
      expect(actual!.isActive).toBe(true);
    }
    // The three role codes plus the tax and fee codes billing depends on are protected.
    const system = codes.filter((c) => c.isSystem).map((c) => c.code);
    expect(system).toEqual(expect.arrayContaining(["1000", "8500", "9100", "1050", "1060", "9200", "7000", "8000"]));
  });

  it("gives every revenue group its OWN tax codes, all on the same default rule", async () => {
    const codes = await prisma.chargeCode.findMany({
      where: { propertyId },
      include: { generatesFrom: { include: { generatedCode: true } } },
    });
    const byCode = new Map(codes.map((c) => [c.code, c]));

    // One representative posting code per group -> that group's own tax codes.
    const expectations: Array<[string, string, string]> = [
      ["1000", "7000", "8000"],
      ["2001", "7000", "8000"],
      ["2901", "7000", "8000"],
      ["5001", "7000", "8000"],
      ["3001", "7000", "8000"],
      ["4001", "7000", "8000"],
    ];
    for (const [source, svc, gst] of expectations) {
      const gens = byCode.get(source)!.generatesFrom;
      const svcRow = gens.find((g) => g.method === "SERVICE_CHARGE");
      const gstRow = gens.find((g) => g.method === "GST");
      expect(svcRow?.generatedCode.code, `${source} service charge`).toBe(svc);
      expect(gstRow?.generatedCode.code, `${source} GST`).toBe(gst);
      // The rate is NOT duplicated onto the row — the generate only routes whatever the
      // one default Maldives rule resolves, which is what keeps the groups identical.
      expect(svcRow!.value).toBe(0);
      expect(gstRow!.value).toBe(0);
    }

    // Every tax code posts at face value, so a tax is never itself taxed.
    for (const c of codes.filter((x) => ["7000", "8000", "8500"].includes(x.code))) {
      expect(c.postingType, c.code).toBe("TAX");
      expect(c.generatesFrom, `${c.code} must generate nothing`).toHaveLength(0);
    }
  });

  it("levies Green Tax off accommodation only, and reads its rate from the Tax config", async () => {
    const room = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "1000" } },
      include: { generatesFrom: { include: { generatedCode: true } } },
    });
    const greenTax = room.generatesFrom.find((g) => g.method === "GREEN_TAX");
    expect(greenTax?.generatedCode.code).toBe("8500");
    // The rates deliberately live in the property's settings, not on the generate row.
    expect(greenTax!.value).toBe(0);

    // An F&B sale is not a stay night — no levy.
    const fb = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "2001" } },
      include: { generatesFrom: true },
    });
    expect(fb.generatesFrom.some((g) => g.method === "GREEN_TAX")).toBe(false);
  });

  it("taxes cancellation and no-show fees as ordinary accommodation revenue", async () => {
    // Owner ruling 2026-07-27: service charge AND GST, same as a room night. A property
    // that disagrees deletes the Service Charge row in the Generates editor.
    for (const code of ["1050", "1060"]) {
      const row = await prisma.chargeCode.findUniqueOrThrow({
        where: { propertyId_code: { propertyId, code } },
        include: { generatesFrom: true },
      });
      expect(row.generatesFrom.map((g) => g.method).sort(), code).toEqual(["GST", "SERVICE_CHARGE"]);
    }
    // A deposit is a liability, not revenue — taxed nowhere.
    const dep = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "9200" } },
      include: { generatesFrom: true },
    });
    expect(dep.generatesFrom).toHaveLength(0);
    expect(dep.postingType).toBe("NON_REVENUE");
  });

  it("is idempotent — a second run creates nothing and duplicates nothing", async () => {
    const before = await prisma.chargeGroup.count({ where: { propertyId } });
    const result = await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    expect(result.groupsCreated).toBe(0);
    expect(result.subgroupsCreated).toBe(0);
    expect(result.codesCreated).toBe(0);
    expect(result.generatesCreated).toBe(0);
    expect(await prisma.chargeGroup.count({ where: { propertyId } })).toBe(before);
  });
});

describe("a new property's chart (owner, 2026-09-24)", () => {
  it("gets only the system codes — every revenue code is the owner's to create and number", async () => {
    const { propertyId } = await freshProperty("system-only");
    await ensureChargeTree(prisma, { propertyId });
    const codes = await prisma.chargeCode.findMany({ where: { propertyId }, select: { code: true, isSystem: true } });
    const expected = STANDARD_CHARGE_CODES.filter((c) => c.isSystem).map((c) => c.code).sort();
    expect(codes.map((c) => c.code).sort()).toEqual(expected);
    expect(codes.every((c) => c.isSystem)).toBe(true);
    // No demo outlet subgroups (20RV Restaurant...), but every reporting group is there.
    expect(await prisma.chargeSubgroup.count({ where: { propertyId, code: "20RV" } })).toBe(0);
    expect(await prisma.chargeGroup.count({ where: { propertyId } })).toBe(CANONICAL_GROUPS.length);
    // The roles still resolve.
    const settings = await prisma.propertySettings.findUniqueOrThrow({ where: { propertyId } });
    expect(settings.defaultAccommodationChargeCodeId).not.toBeNull();
    expect(settings.defaultGreenTaxChargeCodeId).not.toBeNull();
    expect(settings.commissionChargeCodeId).not.toBeNull();
  });
});

describe("ensureChargeTree alongside a property's own codes", () => {
  it("leaves a property's own codes alone while creating the chart around them", async () => {
    const { ent, propertyId } = await freshProperty("coexist");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });

    // A code the property added itself, properly classified — chargeSubgroupId is
    // required, so an unclassified code can no longer exist at all.
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "60RV" } },
    });
    await prisma.chargeCode.create({
      data: { enterpriseId: ent.id, propertyId, code: "HOUSE", description: "House Special", chargeSubgroupId: sub.id },
    });

    // Re-running the seeder creates nothing and leaves the property's code untouched.
    const result = await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    expect(result.codesCreated).toBe(0);

    const row = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "HOUSE" } },
    });
    expect(row.chargeSubgroupId).toBe(sub.id);
    expect(row.isSystem).toBe(false);
  });

  it("adopts an existing ROOM/GTX code instead of colliding with it, keeping its tax config", async () => {
    const { ent, propertyId } = await freshProperty("adopt");
    const profile = await prisma.taxProfile.create({ data: { enterpriseId: ent.id, propertyId, name: "Legacy VAT" } });
    // A raw create, deliberately NOT the test helper: the helper seeds the whole chart,
    // and this test is specifically about what ensureChargeTree does when it meets a
    // property's own pre-existing ROOM code for the first time.
    // customChargeCode seeds the chart, then re-points ROOM at the property's own tax
    // profile — the shape an enterprise that has customised its accommodation code
    // arrives in. (chargeSubgroupId is required, so a bare unclassified ROOM can no
    // longer exist to begin with.)
    await customChargeCode({ propertyId }, { code: "1000", description: "Our Own Room Code", useDefaultTax: false, taxProfileId: profile.id });

    // A re-run adopts it rather than colliding, and creates nothing new.
    const result = await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    expect(result.codesCreated).toBe(0);

    const room = await prisma.chargeCode.findUniqueOrThrow({ where: { propertyId_code: { propertyId, code: "1000" } } });
    expect(room.isSystem).toBe(true);
    expect(room.chargeSubgroupId).not.toBeNull();
    // The seeder classifies; it never rewrites how a property already taxes a code.
    expect(room.description).toBe("Our Own Room Code");
    expect(room.useDefaultTax).toBe(false);
    expect(room.taxProfileId).toBe(profile.id);
  });
});

describe("resolveChargeCode: roles, not magic strings", () => {
  it("falls back to the system-seeded code when no pointer is set", async () => {
    const { ent, propertyId } = await freshProperty("role-fallback");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });

    expect((await resolveChargeCode({ propertyId }, "ACCOMMODATION"))?.code).toBe("1000");
    expect((await resolveChargeCode({ propertyId }, "GREEN_TAX"))?.code).toBe("8500");
    expect((await resolveChargeCode({ propertyId }, "COMMISSION"))?.code).toBe("9100");
  });

  it("prefers the property's own pointer over the seeded code", async () => {
    const { ent, propertyId } = await freshProperty("role-pointer");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "10RV" } },
    });
    const custom = await customChargeCode({ propertyId }, { code: "ACCOM", description: "Accommodation", chargeSubgroupId: sub.id, subgroupCode: "10RV" });
    await setPropertySettings(propertyId, { defaultAccommodationChargeCodeId: custom.id });

    expect((await resolveChargeCode({ propertyId }, "ACCOMMODATION"))?.code).toBe("ACCOM");
  });

  it("falls through a dangling pointer rather than failing the posting", async () => {
    const { ent, propertyId } = await freshProperty("role-dangling");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    await setPropertySettings(propertyId, { defaultAccommodationChargeCodeId: "no-such-charge-code" });

    expect((await resolveChargeCode({ propertyId }, "ACCOMMODATION"))?.code).toBe("1000");
  });

  it("ignores a deactivated pointer target", async () => {
    const { ent, propertyId } = await freshProperty("role-inactive");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "10RV" } },
    });
    const retired = await customChargeCode({ propertyId }, { code: "OLDRM", description: "Retired", chargeSubgroupId: sub.id, isActive: false });
    await setPropertySettings(propertyId, { defaultAccommodationChargeCodeId: retired.id });

    expect((await resolveChargeCode({ propertyId }, "ACCOMMODATION"))?.code).toBe("1000");
  });

  it("returns null for a property with no charge codes at all", async () => {
    const { propertyId } = await freshProperty("role-empty");
    expect(await resolveChargeCode({ propertyId }, "ACCOMMODATION")).toBeNull();
  });

  it("never resolves a code belonging to another enterprise", async () => {
    const mine = await freshProperty("role-mine");
    const theirs = await freshProperty("role-theirs");
    await ensureChargeTree(prisma, { propertyId: theirs.propertyId }, undefined, { demo: true });

    expect(await resolveChargeCode({ propertyId: mine.propertyId }, "ACCOMMODATION")).toBeNull();
  });

  it("never resolves a code of ANOTHER PROPERTY of the same enterprise", async () => {
    const charted = await freshProperty("role-sibling-charted");
    const sibling = await freshProperty("role-sibling", charted.ent.id);
    await ensureChargeTree(prisma, { propertyId: charted.propertyId }, undefined, { demo: true });

    expect((await resolveChargeCode({ propertyId: charted.propertyId }, "ACCOMMODATION"))?.code).toBe("1000");
    expect(await resolveChargeCode({ propertyId: sibling.propertyId }, "ACCOMMODATION")).toBeNull();
  });
});

// "VAT does not generate on any payments and is not allowed under any circumstances."
// Enforced in the admin API AND again at posting time, so a row that somehow exists in
// the database still cannot make a payment produce tax.
describe("tax never generates on a payment — enforced at posting time", () => {
  it("ignores a rogue tax generate stored against a payment code", async () => {
    const { ent, propertyId } = await freshProperty("no-vat-on-payments");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });

    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1 } });

    const payment = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "9500" } },
    });
    const gst = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "8000" } },
    });
    const svc = await prisma.chargeCode.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: "7000" } },
    });

    // Written straight to the database, bypassing the API's refusal.
    await prisma.chargeCodeGenerate.createMany({
      data: [
        { enterpriseId: ent.id, propertyId, generatorCodeId: payment.id, generatedCodeId: gst.id, method: "GST", value: 0, calculateOn: "NET", sortOrder: 10 },
        { enterpriseId: ent.id, propertyId, generatorCodeId: payment.id, generatedCodeId: svc.id, method: "SERVICE_CHARGE", value: 0, calculateOn: "NET", sortOrder: 20 },
      ],
    });

    const settings = await setPropertySettings(propertyId, { tgstEnabled: true, tgstRate: 17, serviceChargeEnabled: true, serviceChargeRate: 10 });

    const postable = await prisma.chargeCode.findUniqueOrThrow({
      where: { id: payment.id },
      include: chargeCodeInclude(),
    });
    const posted = await prisma.$transaction((tx) =>
      postCharge(tx, {
        folioId: folio.id,
        chargeCode: postable,
        inputAmount: 100,
        settings,
        pricesIncludeTaxes: true,
        date: new Date(),
        description: "Payment adjustment",
      })
    );

    // Face value, no tax, and nothing generated.
    expect(posted.parent.amount).toBe(100);
    expect(posted.parent.taxAmount).toBe(0);
    expect(posted.parent.serviceChargeAmount).toBe(0);
    expect(posted.generated).toHaveLength(0);
    expect(posted.taxTotal).toBe(0);
    expect(posted.grandTotal).toBe(100);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId: folio.id } });
    expect(lines).toHaveLength(1);
  });
});

describe("postCharge: a GROSS-based generate sees the exact gross", () => {
  it("inclusive 50.25 with a 10% GROSS fee posts 5.03, not the float-sum 5.02", async () => {
    // 50.25 inclusive splits 39.05 + 3.90 + 7.30. Summed as floats that is
    // 50.24999999999999, whose 10% rounds DOWN to 5.02 — the gross must be summed in cents.
    const { ent, propertyId } = await freshProperty("gross-generate");
    await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1 } });

    const excursion = await chargeCode({ propertyId }, "4001");
    const fee = await customChargeCode({ propertyId }, { code: "FEE10", description: "Booking Fee", postingType: "TAX" });
    await prisma.chargeCodeGenerate.create({
      data: { enterpriseId: ent.id, propertyId, generatorCodeId: excursion.id, generatedCodeId: fee.id, method: "PERCENT", value: 10, calculateOn: "GROSS", sortOrder: 90 },
    });
    const settings = await setPropertySettings(propertyId, { tgstEnabled: true, tgstRate: 17, serviceChargeEnabled: true, serviceChargeRate: 10 });

    const postable = await prisma.chargeCode.findUniqueOrThrow({ where: { id: excursion.id }, include: chargeCodeInclude() });
    const posted = await prisma.$transaction((tx) =>
      postCharge(tx, { folioId: folio.id, chargeCode: postable, inputAmount: 50.25, settings, pricesIncludeTaxes: true, date: new Date() })
    );

    expect(posted.baseAmount).toBe(39.05);
    expect(posted.taxTotal).toBe(11.2);
    const feeLine = posted.generated.find((l) => l.chargeCodeId === fee.id);
    expect(feeLine?.amount).toBe(5.03);
    expect(posted.leviesTotal).toBe(5.03);
    expect(posted.grandTotal).toBe(55.28);
  });
});
