import { describe, it, expect, beforeAll } from "vitest";

const { prisma } = await import("@/lib/db");
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");
const { resolveChargeCode } = await import("@/lib/posting/resolve-charge-code");
const { postCharge, chargeCodeInclude } = await import("@/lib/posting/post-charge");
const { CANONICAL_GROUPS, STANDARD_CHARGE_CODES } = await import("@/lib/posting/charge-tree");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

// The seeder + the role resolver: the two pieces that closed the provisioning gap
// (CHARGE_CODE_PLAN.md §1.3) and killed the `findFirst({ code: "1000" })` lookups.

const slug = (name: string) => `test-charge-tree-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function freshEnterprise(name: string) {
  return prisma.enterprise.create({ data: { name, slug: slug(name), type: "STANDARD" } });
}

describe("ensureChargeTree", () => {
  let enterpriseId: string;

  beforeAll(async () => {
    const ent = await freshEnterprise("seed");
    enterpriseId = ent.id;
    await ensureChargeTree(prisma, enterpriseId);
  });

  it("creates the whole canonical group/subgroup tree", async () => {
    const groups = await prisma.chargeGroup.findMany({ where: { enterpriseId }, include: { subgroups: true } });
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
    const codes = await prisma.chargeCode.findMany({ where: { enterpriseId } });
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
      where: { enterpriseId },
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
      where: { enterpriseId_code: { enterpriseId, code: "1000" } },
      include: { generatesFrom: { include: { generatedCode: true } } },
    });
    const greenTax = room.generatesFrom.find((g) => g.method === "GREEN_TAX");
    expect(greenTax?.generatedCode.code).toBe("8500");
    // The rates deliberately live in EnterpriseSettings, not on the generate row.
    expect(greenTax!.value).toBe(0);

    // An F&B sale is not a stay night — no levy.
    const fb = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "2001" } },
      include: { generatesFrom: true },
    });
    expect(fb.generatesFrom.some((g) => g.method === "GREEN_TAX")).toBe(false);
  });

  it("taxes cancellation and no-show fees as ordinary accommodation revenue", async () => {
    // Owner ruling 2026-07-27: service charge AND GST, same as a room night. A property
    // that disagrees deletes the Service Charge row in the Generates editor.
    for (const code of ["1050", "1060"]) {
      const row = await prisma.chargeCode.findUniqueOrThrow({
        where: { enterpriseId_code: { enterpriseId, code } },
        include: { generatesFrom: true },
      });
      expect(row.generatesFrom.map((g) => g.method).sort(), code).toEqual(["GST", "SERVICE_CHARGE"]);
    }
    // A deposit is a liability, not revenue — taxed nowhere.
    const dep = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "9200" } },
      include: { generatesFrom: true },
    });
    expect(dep.generatesFrom).toHaveLength(0);
    expect(dep.postingType).toBe("NON_REVENUE");
  });

  it("is idempotent — a second run creates nothing and duplicates nothing", async () => {
    const before = await prisma.chargeGroup.count({ where: { enterpriseId } });
    const result = await ensureChargeTree(prisma, enterpriseId);
    expect(result.groupsCreated).toBe(0);
    expect(result.subgroupsCreated).toBe(0);
    expect(result.codesCreated).toBe(0);
    expect(result.generatesCreated).toBe(0);
    expect(await prisma.chargeGroup.count({ where: { enterpriseId } })).toBe(before);
  });
});

describe("ensureChargeTree alongside a property's own codes", () => {
  it("leaves a property's own codes alone while creating the chart around them", async () => {
    const ent = await freshEnterprise("coexist");
    await ensureChargeTree(prisma, ent.id);

    // A code the property added itself, properly classified — chargeSubgroupId is
    // required, so an unclassified code can no longer exist at all.
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "60RV" } },
    });
    await prisma.chargeCode.create({
      data: { enterpriseId: ent.id, code: "HOUSE", description: "House Special", chargeSubgroupId: sub.id },
    });

    // Re-running the seeder creates nothing and leaves the property's code untouched.
    const result = await ensureChargeTree(prisma, ent.id);
    expect(result.codesCreated).toBe(0);

    const row = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "HOUSE" } },
    });
    expect(row.chargeSubgroupId).toBe(sub.id);
    expect(row.isSystem).toBe(false);
  });

  it("adopts an existing ROOM/GTX code instead of colliding with it, keeping its tax config", async () => {
    const ent = await freshEnterprise("adopt");
    const profile = await prisma.taxProfile.create({ data: { enterpriseId: ent.id, name: "Legacy VAT" } });
    // A raw create, deliberately NOT the test helper: the helper seeds the whole chart,
    // and this test is specifically about what ensureChargeTree does when it meets a
    // property's own pre-existing ROOM code for the first time.
    // customChargeCode seeds the chart, then re-points ROOM at the property's own tax
    // profile — the shape an enterprise that has customised its accommodation code
    // arrives in. (chargeSubgroupId is required, so a bare unclassified ROOM can no
    // longer exist to begin with.)
    await customChargeCode(ent.id, { code: "1000", description: "Our Own Room Code", useDefaultTax: false, taxProfileId: profile.id });

    // A re-run adopts it rather than colliding, and creates nothing new.
    const result = await ensureChargeTree(prisma, ent.id);
    expect(result.codesCreated).toBe(0);

    const room = await prisma.chargeCode.findUniqueOrThrow({ where: { enterpriseId_code: { enterpriseId: ent.id, code: "1000" } } });
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
    const ent = await freshEnterprise("role-fallback");
    await ensureChargeTree(prisma, ent.id);

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("1000");
    expect((await resolveChargeCode(ent.id, "GREEN_TAX"))?.code).toBe("8500");
    expect((await resolveChargeCode(ent.id, "COMMISSION"))?.code).toBe("9100");
  });

  it("prefers the enterprise's own pointer over the seeded code", async () => {
    const ent = await freshEnterprise("role-pointer");
    await ensureChargeTree(prisma, ent.id);
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "10RV" } },
    });
    const custom = await customChargeCode(ent.id, { code: "ACCOM", description: "Accommodation", chargeSubgroupId: sub.id, subgroupCode: "10RV" });
    await prisma.enterpriseSettings.create({
      data: { enterpriseId: ent.id, defaultAccommodationChargeCodeId: custom.id },
    });

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("ACCOM");
  });

  it("falls through a dangling pointer rather than failing the posting", async () => {
    const ent = await freshEnterprise("role-dangling");
    await ensureChargeTree(prisma, ent.id);
    await prisma.enterpriseSettings.create({
      data: { enterpriseId: ent.id, defaultAccommodationChargeCodeId: "no-such-charge-code" },
    });

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("1000");
  });

  it("ignores a deactivated pointer target", async () => {
    const ent = await freshEnterprise("role-inactive");
    await ensureChargeTree(prisma, ent.id);
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "10RV" } },
    });
    const retired = await customChargeCode(ent.id, { code: "OLDRM", description: "Retired", chargeSubgroupId: sub.id, isActive: false });
    await prisma.enterpriseSettings.create({
      data: { enterpriseId: ent.id, defaultAccommodationChargeCodeId: retired.id },
    });

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("1000");
  });

  it("returns null for an enterprise with no charge codes at all", async () => {
    const ent = await freshEnterprise("role-empty");
    expect(await resolveChargeCode(ent.id, "ACCOMMODATION")).toBeNull();
  });

  it("never resolves a code belonging to another enterprise", async () => {
    const mine = await freshEnterprise("role-mine");
    const theirs = await freshEnterprise("role-theirs");
    await ensureChargeTree(prisma, theirs.id);

    expect(await resolveChargeCode(mine.id, "ACCOMMODATION")).toBeNull();
  });
});

// "VAT does not generate on any payments and is not allowed under any circumstances."
// Enforced in the admin API AND again at posting time, so a row that somehow exists in
// the database still cannot make a payment produce tax.
describe("tax never generates on a payment — enforced at posting time", () => {
  it("ignores a rogue tax generate stored against a payment code", async () => {
    const ent = await freshEnterprise("no-vat-on-payments");
    await ensureChargeTree(prisma, ent.id);

    const property = await prisma.property.create({
      data: {
        enterpriseId: ent.id, name: "P", code: `NV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    const folio = await prisma.folio.create({ data: { propertyId: property.id, folioNumber: 1 } });

    const payment = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "9500" } },
    });
    const gst = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "8000" } },
    });
    const svc = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "7000" } },
    });

    // Written straight to the database, bypassing the API's refusal.
    await prisma.chargeCodeGenerate.createMany({
      data: [
        { enterpriseId: ent.id, generatorCodeId: payment.id, generatedCodeId: gst.id, method: "GST", value: 0, calculateOn: "NET", sortOrder: 10 },
        { enterpriseId: ent.id, generatorCodeId: payment.id, generatedCodeId: svc.id, method: "SERVICE_CHARGE", value: 0, calculateOn: "NET", sortOrder: 20 },
      ],
    });

    const settings = await prisma.enterpriseSettings.create({
      data: { enterpriseId: ent.id, tgstEnabled: true, tgstRate: 17, serviceChargeEnabled: true, serviceChargeRate: 10 },
    });

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
