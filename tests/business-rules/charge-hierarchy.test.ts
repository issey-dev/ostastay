import { describe, it, expect, beforeAll } from "vitest";

const { prisma } = await import("@/lib/db");
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");
const { resolveChargeCode } = await import("@/lib/posting/resolve-charge-code");
const { postCharge, chargeCodeInclude } = await import("@/lib/posting/post-charge");
const { CANONICAL_GROUPS, STANDARD_CHARGE_CODES } = await import("@/lib/posting/charge-tree");

// The seeder + the role resolver: the two pieces that closed the provisioning gap
// (CHARGE_CODE_PLAN.md §1.3) and killed the `findFirst({ code: "ROOM" })` lookups.

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
    expect(system).toEqual(expect.arrayContaining(["ROOM", "GTX", "COMM", "CXL", "NOSHW", "DEP", "SVCACM", "GSTACM"]));
  });

  it("gives every revenue group its OWN tax codes, all on the same default rule", async () => {
    const codes = await prisma.chargeCode.findMany({
      where: { enterpriseId },
      include: { generatesFrom: { include: { generatedCode: true } } },
    });
    const byCode = new Map(codes.map((c) => [c.code, c]));

    // One representative posting code per group -> that group's own tax codes.
    const expectations: Array<[string, string, string]> = [
      ["ROOM", "SVCACM", "GSTACM"],
      ["FBFOOD", "SVCFNB", "GSTFNB"],
      ["MPBF", "SVCMPL", "GSTMPL"],
      ["TRFAIR", "SVCTRN", "GSTTRN"],
      ["SPATRT", "SVCSPA", "GSTSPA"],
      ["EXCTUR", "SVCEXC", "GSTEXC"],
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
    for (const c of codes.filter((x) => x.code.startsWith("SVC") || x.code.startsWith("GST") || x.code === "GTX")) {
      expect(c.postingType, c.code).toBe("TAX");
      expect(c.generatesFrom, `${c.code} must generate nothing`).toHaveLength(0);
    }
  });

  it("levies Green Tax off accommodation only, and reads its rate from the Tax config", async () => {
    const room = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "ROOM" } },
      include: { generatesFrom: { include: { generatedCode: true } } },
    });
    const greenTax = room.generatesFrom.find((g) => g.method === "GREEN_TAX");
    expect(greenTax?.generatedCode.code).toBe("GTX");
    // The rates deliberately live in EnterpriseSettings, not on the generate row.
    expect(greenTax!.value).toBe(0);

    // An F&B sale is not a stay night — no levy.
    const fb = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "FBFOOD" } },
      include: { generatesFrom: true },
    });
    expect(fb.generatesFrom.some((g) => g.method === "GREEN_TAX")).toBe(false);
  });

  it("gives cancellation and no-show fees GST but no service charge", async () => {
    for (const code of ["CXL", "NOSHW"]) {
      const row = await prisma.chargeCode.findUniqueOrThrow({
        where: { enterpriseId_code: { enterpriseId, code } },
        include: { generatesFrom: true },
      });
      expect(row.generatesFrom.map((g) => g.method).sort(), code).toEqual(["GST"]);
    }
    // A deposit is a liability, not revenue — taxed nowhere.
    const dep = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "DEP" } },
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

describe("ensureChargeTree over pre-existing codes (the backfill path)", () => {
  it("classifies legacy codes from their `category` and reports the ones it can't", async () => {
    const ent = await freshEnterprise("backfill");

    await prisma.chargeCode.createMany({
      data: [
        { enterpriseId: ent.id, code: "RM", description: "Room", category: "ROOM" },
        { enterpriseId: ent.id, code: "FB", description: "Food", category: "FOOD_BEVERAGE" },
        { enterpriseId: ent.id, code: "TA", description: "Commission", category: "NON_REVENUE" },
        { enterpriseId: ent.id, code: "WAT", description: "Mystery", category: "SOMETHING_ELSE" },
      ],
    });

    const result = await ensureChargeTree(prisma, ent.id);

    expect(result.codesClassified).toBe(3);
    // Log-don't-guess: an unrecognized category is surfaced, never silently bucketed.
    expect(result.unmapped).toEqual([{ code: "WAT", category: "SOMETHING_ELSE" }]);

    const rm = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "RM" } },
      include: { chargeSubgroup: { include: { chargeGroup: true } } },
    });
    expect(rm.chargeSubgroup?.chargeGroup.reportBucket).toBe("ROOM");

    const wat = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "WAT" } },
    });
    expect(wat.chargeSubgroupId).toBeNull();
  });

  it("adopts an existing ROOM/GTX code instead of colliding with it, keeping its tax config", async () => {
    const ent = await freshEnterprise("adopt");
    const profile = await prisma.taxProfile.create({ data: { enterpriseId: ent.id, name: "Legacy VAT" } });
    await prisma.chargeCode.create({
      data: { enterpriseId: ent.id, code: "ROOM", description: "Our Own Room Code", category: "ROOM", useDefaultTax: false, taxProfileId: profile.id },
    });

    const result = await ensureChargeTree(prisma, ent.id);
    // The whole chart minus the one code that already existed and was adopted.
    expect(result.codesCreated).toBe(STANDARD_CHARGE_CODES.length - 1);

    const room = await prisma.chargeCode.findUniqueOrThrow({ where: { enterpriseId_code: { enterpriseId: ent.id, code: "ROOM" } } });
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

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("ROOM");
    expect((await resolveChargeCode(ent.id, "GREEN_TAX"))?.code).toBe("GTX");
    expect((await resolveChargeCode(ent.id, "COMMISSION"))?.code).toBe("COMM");
  });

  it("prefers the enterprise's own pointer over the seeded code", async () => {
    const ent = await freshEnterprise("role-pointer");
    await ensureChargeTree(prisma, ent.id);
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "ROOM_REVENUE" } },
    });
    const custom = await prisma.chargeCode.create({
      data: { enterpriseId: ent.id, code: "ACCOM", description: "Accommodation", chargeSubgroupId: sub.id, category: "ROOM" },
    });
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

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("ROOM");
  });

  it("ignores a deactivated pointer target", async () => {
    const ent = await freshEnterprise("role-inactive");
    await ensureChargeTree(prisma, ent.id);
    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "ROOM_REVENUE" } },
    });
    const retired = await prisma.chargeCode.create({
      data: { enterpriseId: ent.id, code: "OLDRM", description: "Retired", chargeSubgroupId: sub.id, isActive: false },
    });
    await prisma.enterpriseSettings.create({
      data: { enterpriseId: ent.id, defaultAccommodationChargeCodeId: retired.id },
    });

    expect((await resolveChargeCode(ent.id, "ACCOMMODATION"))?.code).toBe("ROOM");
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
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "PMTADJ" } },
    });
    const gst = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "GSTOTH" } },
    });
    const svc = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: ent.id, code: "SVCOTH" } },
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
