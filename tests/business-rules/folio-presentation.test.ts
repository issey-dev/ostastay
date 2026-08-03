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
  chargeCode: { code: "6002", description: "Miscellaneous" },
  outletCheck: null,
  ...over,
});

// A realistic folio after the group-level tax change: two room nights and one F&B sale,
// each with its own routed Service Charge and GST lines, plus a Green Tax levy.
const FOLIO: PresentableLine[] = [
  line({ id: "room1", date: D1, description: "Nightly Room Charge", amount: 77.7, chargeCode: { code: "1000", description: "Accommodation" } }),
  line({ id: "room1-svc", date: D1, description: "Service Charge — Accommodation", serviceChargeAmount: 7.77, generatedFromLineItemId: "room1", chargeCode: { code: "7000", description: "Service Charge — Accommodation" } }),
  line({ id: "room1-gst", date: D1, description: "GST — Accommodation", taxAmount: 14.53, generatedFromLineItemId: "room1", chargeCode: { code: "8000", description: "GST — Accommodation" } }),
  line({ id: "gtx1", date: D1, description: "Green Tax", amount: 12, generatedFromLineItemId: "room1", chargeCode: { code: "8500", description: "Green Tax" } }),

  line({ id: "room2", date: D2, description: "Nightly Room Charge", amount: 77.7, chargeCode: { code: "1000", description: "Accommodation" } }),
  line({ id: "room2-svc", date: D2, description: "Service Charge — Accommodation", serviceChargeAmount: 7.77, generatedFromLineItemId: "room2", chargeCode: { code: "7000", description: "Service Charge — Accommodation" } }),
  line({ id: "room2-gst", date: D2, description: "GST — Accommodation", taxAmount: 14.53, generatedFromLineItemId: "room2", chargeCode: { code: "8000", description: "GST — Accommodation" } }),

  line({ id: "fb", date: D2, description: "Restaurant — Food", amount: 38.85, chargeCode: { code: "2001", description: "Restaurant — Food" }, outletCheck: { checkNumber: "REST-00012" } }),
  line({ id: "fb-svc", date: D2, description: "Service Charge — Food & Beverage", serviceChargeAmount: 3.89, generatedFromLineItemId: "fb", chargeCode: { code: "7000", description: "Service Charge — F&B" }, outletCheck: { checkNumber: "REST-00012" } }),
  line({ id: "fb-gst", date: D2, description: "GST — Food & Beverage", taxAmount: 7.26, generatedFromLineItemId: "fb", chargeCode: { code: "8000", description: "GST — F&B" }, outletCheck: { checkNumber: "REST-00012" } }),

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
  // Changed 2026-08-03 (owner): grouping compresses repetition WITHIN a day and never
  // across days. A row carries one date, so a line merging two nights would print one
  // date beside a figure that isn't that day's — unreconcilable against the stay.
  it("groups per charge within a day, keeping each night on its own line", () => {
    const rows = buildFolioRows(FOLIO, "by-code");
    const roomRows = rows.filter((r) => r.description === "Nightly Room Charge");
    expect(roomRows).toHaveLength(2);
    expect(roomRows.every((r) => r.count === 1)).toBe(true);
    // 1 Jul carries the Green Tax as well, so the two nights differ.
    expect(roomRows[0].total).toBeCloseTo(112, 2);
    expect(roomRows[1].total).toBeCloseTo(100, 2);
    // Same grand total as every other style — grouping never changes what is owed.
    expect(rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(262, 2);
    expect(rows.find((r) => r.description === "Restaurant — Food")!.count).toBe(1);
  });

  it("still collapses repeats posted on the SAME day", () => {
    const sameDay = [
      line({ id: "a", date: D1, description: "Laundry", amount: 10 }),
      line({ id: "b", date: D1, description: "Laundry", amount: 15 }),
      line({ id: "c", date: D2, description: "Laundry", amount: 20 }),
    ];
    const rows = buildFolioRows(sameDay, "by-code");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.count === 2)!.total).toBeCloseTo(25, 2);
    expect(rows.find((r) => r.count === 1)!.total).toBeCloseTo(20, 2);
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
    // Room charges have no check, so they fall back to their own description — still
    // scoped to a single day, so the two nights stay on separate lines.
    const roomRows = rows.filter((r) => r.description === "Nightly Room Charge");
    expect(roomRows).toHaveLength(2);
    expect(roomRows.every((r) => r.count === 1)).toBe(true);
  });
});

// The invariant that motivates the day-scoping, asserted directly against every style.
describe("every style", () => {
  it("never merges charges from different days onto one row", () => {
    for (const style of FOLIO_STYLES) {
      // Every row's total must fall entirely within its own day — so summing rows by
      // their printed date reproduces the true day totals, style by style.
      const rows = buildFolioRows(FOLIO, style);
      const byDay = new Map<string, number>();
      for (const r of rows) {
        const k = new Date(r.date).toISOString().slice(0, 10);
        byDay.set(k, (byDay.get(k) ?? 0) + r.total);
      }
      expect(byDay.get("2026-07-01")).toBeCloseTo(112, 2);
      expect(byDay.get("2026-07-02")).toBeCloseTo(150, 2);
    }
  });
});

describe("style validation", () => {
  it("accepts only known styles", () => {
    expect(isFolioStyle("by-date")).toBe(true);
    expect(isFolioStyle("nonsense")).toBe(false);
    expect(isFolioStyle(undefined)).toBe(false);
  });
});
