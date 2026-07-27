import { describe, it, expect } from "vitest";
import { computeGeneratedAmounts, hasGenerateCycle, type GenerateRow } from "@/lib/posting/run-generates";
import { reportBucketOf, isLevyLine } from "@/lib/posting/report-bucket";
import {
  CANONICAL_GROUPS,
  REPORT_BUCKETS,
  LEGACY_CATEGORY_TO_SUBGROUP,
  legacyCategoryForSubgroup,
  canGenerateTax,
  standardGenerates,
  STANDARD_CHARGE_CODES,
  POSTING_TYPES,
} from "@/lib/posting/charge-tree";

// The generates engine (CHARGE_CODE_PLAN.md §4) and the reporting-bucket resolution
// that replaced the free-text ChargeCode.category string. Both are pure functions, so
// they're tested here without a database.

const row = (over: Partial<GenerateRow> & { id: string }): GenerateRow => ({
  generatedCodeId: `code-${over.id}`,
  method: "PERCENT",
  value: 0,
  calculateOn: "NET",
  basisGenerateId: null,
  sortOrder: 0,
  isActive: true,
  ...over,
});

const GREEN_TAX_SETTINGS = { greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 };

describe("generates: GREEN_TAX reads the enterprise's Maldives Tax config", () => {
  it("computes adults*adultRate + children*childRate per night", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "GREEN_TAX" })],
      netAmount: 100,
      grossAmount: 128.7,
      settings: GREEN_TAX_SETTINGS,
      context: { adults: 2, children: 1, nights: 1 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(30); // 2 * 12 + 1 * 6
  });

  it("multiplies by nights when a posting covers more than one", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "GREEN_TAX" })],
      netAmount: 100, grossAmount: 100,
      settings: GREEN_TAX_SETTINGS,
      context: { adults: 1, children: 0, nights: 3 },
    });
    expect(out[0].amount).toBe(36);
  });

  it("posts nothing when Green Tax is switched off in the Tax config", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "GREEN_TAX" })],
      netAmount: 100, grossAmount: 100,
      settings: { ...GREEN_TAX_SETTINGS, greenTaxEnabled: false },
      context: { adults: 2, children: 2, nights: 1 },
    });
    expect(out).toHaveLength(0);
  });

  it("marks its output final, so the tax engine never touches a government levy", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "GREEN_TAX" })],
      netAmount: 100, grossAmount: 100,
      settings: GREEN_TAX_SETTINGS,
      context: { adults: 1, children: 0, nights: 1 },
    });
    expect(out[0].isFinal).toBe(true);
  });

  it("posts nothing without a posting context — a levy needs a headcount", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "GREEN_TAX" })],
      netAmount: 100, grossAmount: 100,
      settings: GREEN_TAX_SETTINGS,
      context: null,
    });
    expect(out).toHaveLength(0);
  });
});

describe("generates: the other methods", () => {
  it("PERCENT on NET uses the parent's pre-tax base", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "PERCENT", value: 8 })],
      netAmount: 100, grossAmount: 128.7, settings: null, context: null,
    });
    expect(out[0].amount).toBe(8);
  });

  it("PERCENT on GROSS uses base + tax + service charge", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "PERCENT", value: 10, calculateOn: "GROSS" })],
      netAmount: 100, grossAmount: 128.7, settings: null, context: null,
    });
    expect(out[0].amount).toBe(12.87);
  });

  it("FLAT posts its value once per posting", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "FLAT", value: 5 })],
      netAmount: 100, grossAmount: 100, settings: null, context: { adults: 4, children: 0, nights: 2 },
    });
    expect(out[0].amount).toBe(5);
  });

  it("PER_PERSON_PER_NIGHT multiplies by heads and nights", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "PER_PERSON_PER_NIGHT", value: 2.5 })],
      netAmount: 100, grossAmount: 100, settings: null, context: { adults: 2, children: 1, nights: 2 },
    });
    expect(out[0].amount).toBe(15); // 2.50 * 3 pax * 2 nights
  });

  it("drops a row that computes to zero rather than posting a $0.00 line", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "PERCENT", value: 10 })],
      netAmount: 0, grossAmount: 0, settings: null, context: null,
    });
    expect(out).toHaveLength(0);
  });
});

describe("generates: cascading buckets", () => {
  it("a later row can compound on an earlier row's own output", () => {
    const out = computeGeneratedAmounts({
      generates: [
        row({ id: "g1", method: "PERCENT", value: 10, sortOrder: 1 }),                                   // 10% of 100 = 10
        row({ id: "g2", method: "PERCENT", value: 50, calculateOn: "ANOTHER_GENERATE", basisGenerateId: "g1", sortOrder: 2 }), // 50% of 10 = 5
      ],
      netAmount: 100, grossAmount: 100, settings: null, context: null,
    });
    expect(out.map((o) => o.amount)).toEqual([10, 5]);
  });

  it("applies rows in sortOrder, not array order", () => {
    const out = computeGeneratedAmounts({
      generates: [
        row({ id: "second", method: "FLAT", value: 2, sortOrder: 20 }),
        row({ id: "first", method: "FLAT", value: 1, sortOrder: 10 }),
      ],
      netAmount: 100, grossAmount: 100, settings: null, context: null,
    });
    expect(out.map((o) => o.generate.id)).toEqual(["first", "second"]);
  });

  it("a basis that hasn't run yet contributes zero rather than throwing", () => {
    const out = computeGeneratedAmounts({
      generates: [
        row({ id: "g1", method: "PERCENT", value: 50, calculateOn: "ANOTHER_GENERATE", basisGenerateId: "g2", sortOrder: 1 }),
        row({ id: "g2", method: "FLAT", value: 40, sortOrder: 2 }),
      ],
      netAmount: 100, grossAmount: 100, settings: null, context: null,
    });
    // g1 sees no bucket for g2 yet, so it resolves to 0 and is dropped; g2 still posts.
    expect(out.map((o) => o.generate.id)).toEqual(["g2"]);
  });

  it("skips deactivated rows", () => {
    const out = computeGeneratedAmounts({
      generates: [row({ id: "g1", method: "FLAT", value: 9, isActive: false })],
      netAmount: 100, grossAmount: 100, settings: null, context: null,
    });
    expect(out).toHaveLength(0);
  });
});

describe("generates: cycle guard", () => {
  it("rejects a code generating itself", () => {
    expect(hasGenerateCycle([{ generatorCodeId: "a", generatedCodeId: "a" }])).toBe(true);
  });

  it("rejects an indirect loop", () => {
    expect(hasGenerateCycle([
      { generatorCodeId: "a", generatedCodeId: "b" },
      { generatorCodeId: "b", generatedCodeId: "c" },
      { generatorCodeId: "c", generatedCodeId: "a" },
    ])).toBe(true);
  });

  it("accepts a diamond — two paths to the same code is not a cycle", () => {
    expect(hasGenerateCycle([
      { generatorCodeId: "a", generatedCodeId: "b" },
      { generatorCodeId: "a", generatedCodeId: "c" },
      { generatorCodeId: "b", generatedCodeId: "d" },
      { generatorCodeId: "c", generatedCodeId: "d" },
    ])).toBe(false);
  });
});

describe("report buckets", () => {
  it("reads the bucket off the hierarchy when a code is classified", () => {
    expect(reportBucketOf({ category: "OTHERS", chargeSubgroup: { chargeGroup: { reportBucket: "ROOM" } } })).toBe("ROOM");
  });

  it("falls back to the deprecated category while a code is still unclassified", () => {
    expect(reportBucketOf({ category: "TRANSPORTATION", chargeSubgroup: null })).toBe("TRANSPORT");
    expect(reportBucketOf({ category: "NON_REVENUE", chargeSubgroup: null })).toBe("NON_REVENUE");
  });

  it("lands on OTHER for a code with neither", () => {
    expect(reportBucketOf(null)).toBe("OTHER");
    expect(reportBucketOf({ category: "SOMETHING_MADE_UP" })).toBe("OTHER");
  });

  it("treats a TAX posting type as a levy — and still recognises a pre-migration GTX", () => {
    expect(isLevyLine({ postingType: "TAX", code: "BEDTAX" })).toBe(true);
    expect(isLevyLine({ postingType: "CHARGE", code: "GTX" })).toBe(true);
    expect(isLevyLine({ postingType: "CHARGE", code: "RM" })).toBe(false);
  });
});

describe("the canonical charge tree", () => {
  it("every group's reporting bucket is in the closed set", () => {
    for (const g of CANONICAL_GROUPS) {
      expect(REPORT_BUCKETS).toContain(g.reportBucket);
    }
  });

  it("subgroup codes are unique across the whole tree — they're unique per enterprise in the schema", () => {
    const codes = CANONICAL_GROUPS.flatMap((g) => g.subgroups.map((s) => s.code));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every legacy category maps to a subgroup that actually exists", () => {
    const known = new Set(CANONICAL_GROUPS.flatMap((g) => g.subgroups.map((s) => s.code)));
    for (const subgroupCode of Object.values(LEGACY_CATEGORY_TO_SUBGROUP)) {
      expect(known).toContain(subgroupCode);
    }
  });

  it("round-trips a subgroup back to the legacy category column it mirrors", () => {
    expect(legacyCategoryForSubgroup("ROOM_REVENUE")).toBe("ROOM");
    expect(legacyCategoryForSubgroup("GOVERNMENT_LEVY")).toBe("TAX");
    expect(legacyCategoryForSubgroup("COMMISSION")).toBe("NON_REVENUE");
  });

  it("taxes and non-revenue are never counted as earned revenue", () => {
    const notRevenue = CANONICAL_GROUPS.filter((g) => !g.isRevenue).map((g) => g.code);
    expect(notRevenue).toEqual(expect.arrayContaining(["TAX", "NON_REVENUE", "SYSTEM"]));
  });
});

// VAT/GST never generates on money that has already been taxed. This is a hard rule, not
// a default — it holds in the calculation layer regardless of what a generate row says.
describe("tax never generates on a non-sale", () => {
  it("only a CHARGE posting type may generate tax", () => {
    expect(canGenerateTax("CHARGE")).toBe(true);
    for (const t of ["TAX", "CREDIT", "NON_REVENUE", "", null, undefined]) {
      expect(canGenerateTax(t as string), String(t)).toBe(false);
    }
  });

  it("covers every posting type the chart uses, so a new one can't slip through untested", () => {
    // A payment / refund / paid-out / deposit / commission code is one of these three.
    const nonSale = POSTING_TYPES.filter((t) => t !== "CHARGE");
    expect(nonSale).toEqual(expect.arrayContaining(["TAX", "CREDIT", "NON_REVENUE"]));
    expect(nonSale.every((t) => !canGenerateTax(t))).toBe(true);
  });

  it("no payment, deposit or commission code in the standard chart generates anything", () => {
    const gens = standardGenerates();
    const nonSaleCodes = new Set(
      STANDARD_CHARGE_CODES.filter((c) => c.postingType !== "CHARGE").map((c) => c.code)
    );
    const offenders = gens.filter((g) => nonSaleCodes.has(g.generatorCode));
    expect(offenders).toEqual([]);
  });

  it("the payment subgroup's codes are all non-revenue and generate nothing", () => {
    const payment = STANDARD_CHARGE_CODES.filter((c) => c.subgroupCode === "PAYMENT");
    expect(payment.length).toBeGreaterThan(0);
    for (const c of payment) {
      expect(c.postingType, c.code).toBe("NON_REVENUE");
      expect(c.taxTreatment, c.code).toBe("NONE");
      expect(canGenerateTax(c.postingType), c.code).toBe(false);
    }
  });
});
