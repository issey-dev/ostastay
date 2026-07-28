import { describe, it, expect } from "vitest";
import { buildFolioRows, FOLIO_STYLES, isFolioStyle, type PresentableLine } from "@/lib/folio-presentation";

// Folio styles group the same posted ledger differently. The invariant that matters:
// grouping NEVER changes what is owed.

const D1 = new Date("2026-07-01T00:00:00.000Z");
const D2 = new Date("2026-07-02T00:00:00.000Z");

const line = (over: Partial<PresentableLine> & { id: string }): PresentableLine => ({
  date: D1,
  description: "Charge",
  reference: null,
  amount: 0,
  taxAmount: 0,
  serviceChargeAmount: 0,
  isVoid: false,
  generatedFromLineItemId: null,
  chargeCode: { code: "MISC", description: "Miscellaneous" },
  outletCheck: null,
  ...over,
});

// A realistic folio after the group-level tax change: two room nights and one F&B sale,
// each with its own routed Service Charge and GST lines, plus a Green Tax levy.
const FOLIO: PresentableLine[] = [
  line({ id: "room1", date: D1, description: "Nightly Room Charge", amount: 77.7, chargeCode: { code: "ROOM", description: "Accommodation" } }),
  line({ id: "room1-svc", date: D1, description: "Service Charge — Accommodation", serviceChargeAmount: 7.77, generatedFromLineItemId: "room1", chargeCode: { code: "SVCACM", description: "Service Charge — Accommodation" } }),
  line({ id: "room1-gst", date: D1, description: "GST — Accommodation", taxAmount: 14.53, generatedFromLineItemId: "room1", chargeCode: { code: "GSTACM", description: "GST — Accommodation" } }),
  line({ id: "gtx1", date: D1, description: "Green Tax", amount: 12, generatedFromLineItemId: "room1", chargeCode: { code: "GTX", description: "Green Tax" } }),

  line({ id: "room2", date: D2, description: "Nightly Room Charge", amount: 77.7, chargeCode: { code: "ROOM", description: "Accommodation" } }),
  line({ id: "room2-svc", date: D2, description: "Service Charge — Accommodation", serviceChargeAmount: 7.77, generatedFromLineItemId: "room2", chargeCode: { code: "SVCACM", description: "Service Charge — Accommodation" } }),
  line({ id: "room2-gst", date: D2, description: "GST — Accommodation", taxAmount: 14.53, generatedFromLineItemId: "room2", chargeCode: { code: "GSTACM", description: "GST — Accommodation" } }),

  line({ id: "fb", date: D2, description: "Restaurant — Food", amount: 38.85, chargeCode: { code: "FBFOOD", description: "Restaurant — Food" }, outletCheck: { checkNumber: "REST-00012" } }),
  line({ id: "fb-svc", date: D2, description: "Service Charge — Food & Beverage", serviceChargeAmount: 3.89, generatedFromLineItemId: "fb", chargeCode: { code: "SVCFNB", description: "Service Charge — F&B" }, outletCheck: { checkNumber: "REST-00012" } }),
  line({ id: "fb-gst", date: D2, description: "GST — Food & Beverage", taxAmount: 7.26, generatedFromLineItemId: "fb", chargeCode: { code: "GSTFNB", description: "GST — F&B" }, outletCheck: { checkNumber: "REST-00012" } }),

  line({ id: "voided", date: D2, description: "Cancelled item", amount: 999, isVoid: true }),
];

const EXPECTED_TOTAL = 77.7 + 7.77 + 14.53 + 12 + 77.7 + 7.77 + 14.53 + 38.85 + 3.89 + 7.26;
const sum = (rows: Array<{ total: number }>) => Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100;

describe("folio styles: every layout owes the same", () => {
  it.each(FOLIO_STYLES)("%s totals to the folio balance", (style) => {
    expect(sum(buildFolioRows(FOLIO, style))).toBeCloseTo(EXPECTED_TOTAL, 2);
  });

  it.each(FOLIO_STYLES)("%s excludes voided lines", (style) => {
    const rows = buildFolioRows(FOLIO, style);
    expect(rows.some((r) => r.description.includes("Cancelled"))).toBe(false);
  });
});

describe("detailed", () => {
  it("shows every posted line, taxes as their own rows", () => {
    const rows = buildFolioRows(FOLIO, "detailed");
    expect(rows).toHaveLength(10); // all but the void
    expect(rows.map((r) => r.key)).toContain("room1-gst");
    expect(rows.find((r) => r.key === "room1-svc")!.serviceCharge).toBe(7.77);
  });
});

describe("compact", () => {
  it("folds each generated line back into the charge that produced it", () => {
    const rows = buildFolioRows(FOLIO, "compact");
    // room1 + its svc/gst/green tax, room2 + its two, fb + its two = 3 rows.
    expect(rows).toHaveLength(3);

    const room1 = rows.find((r) => r.key === "room1")!;
    expect(room1.serviceCharge).toBe(7.77);
    expect(room1.tax).toBe(14.53);
    // Green Tax is a levy, so it lands in the row's base rather than its tax columns.
    expect(room1.base).toBeCloseTo(89.7, 2);
    expect(room1.total).toBeCloseTo(112, 2);
  });

  it("keeps a generated line whose parent is on another folio rather than dropping it", () => {
    const orphaned = [
      line({ id: "gst-only", description: "GST", taxAmount: 5, generatedFromLineItemId: "posted-elsewhere" }),
    ];
    const rows = buildFolioRows(orphaned, "compact");
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(5);
  });
});

describe("by-code", () => {
  it("rolls the whole stay onto one line per charge", () => {
    const rows = buildFolioRows(FOLIO, "by-code");
    const room = rows.find((r) => r.description === "Nightly Room Charge")!;
    expect(room.count).toBe(2);
    // Both nights with their service charge and GST, plus the one night's Green Tax.
    expect(room.total).toBeCloseTo(212, 2);
    expect(rows.find((r) => r.description === "Restaurant — Food")!.count).toBe(1);
  });
});

describe("by-date", () => {
  it("collapses each date to a single line", () => {
    const rows = buildFolioRows(FOLIO, "by-date");
    expect(rows).toHaveLength(2);
    expect(rows[0].total).toBeCloseTo(112, 2);   // 1 Jul: room + tax + green tax
    expect(rows[1].total).toBeCloseTo(150, 2);   // 2 Jul: room + tax, plus the F&B sale
    expect(rows[1].description).toContain("2 transactions");
  });
});

describe("by-check", () => {
  it("rolls outlet charges onto their sales-check number", () => {
    const rows = buildFolioRows(FOLIO, "by-check");
    const check = rows.find((r) => r.reference === "REST-00012")!;
    expect(check.description).toBe("Outlet check REST-00012");
    expect(check.total).toBeCloseTo(50, 2);
    // Room charges have no check, so they still summarise by their own description.
    expect(rows.find((r) => r.description === "Nightly Room Charge")!.count).toBe(2);
  });
});

describe("style validation", () => {
  it("accepts only known styles", () => {
    expect(isFolioStyle("by-date")).toBe(true);
    expect(isFolioStyle("nonsense")).toBe(false);
    expect(isFolioStyle(undefined)).toBe(false);
  });
});
