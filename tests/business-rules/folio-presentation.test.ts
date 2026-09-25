import { describe, it, expect } from "vitest";
import { buildFolioRows, FOLIO_STYLES, isFolioStyle, pickMainLine, rollUpByCheck, CHECK_NO_PATTERN, type PresentableLine } from "@/lib/folio-presentation";

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
  // 2026-09-26 (owner): by-check uses the posting's check number (FolioLineItem.checkNo),
  // not the outlet sales check. A charge and its SC/GST/levies share one number; a Night
  // Audit night's room rate + extra occupancy + allocations + taxes share one number.
  const numbered: PresentableLine[] = FOLIO.map((l) => ({
    ...l,
    checkNo: l.id.startsWith("room1") || l.id === "gtx1" ? "1001" : l.id.startsWith("room2") ? "1002" : l.id.startsWith("fb") ? "1003" : "1004",
  }));

  it("lines with no check number fall back to one row per charge, taxes folded in", () => {
    const rows = buildFolioRows(FOLIO, "by-check");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.description)).toEqual(["Nightly Room Charge", "Nightly Room Charge", "Restaurant — Food"]);
  });

  it("one row per check, named after the main line, generated lines folded in", () => {
    const rows = buildFolioRows(numbered, "by-check");
    expect(rows).toHaveLength(3);
    const first = rows.find((r) => r.reference === "1001")!;
    expect(first.description).toBe("Nightly Room Charge");
    expect(first.total).toBeCloseTo(112, 2);
    expect(first.serviceCharge).toBeCloseTo(7.77, 2);
    expect(first.tax).toBeCloseTo(14.53, 2);
    expect(first.count).toBe(4);
    expect(rows.find((r) => r.reference === "1003")!.description).toBe("Restaurant — Food");
    expect(rows.find((r) => r.reference === "1003")!.total).toBeCloseTo(50, 2);
  });

  it("excludes voided lines and totals like every other style", () => {
    const rows = buildFolioRows(numbered, "by-check");
    expect(rows.some((r) => r.reference === "1004")).toBe(false);
    expect(sum(rows)).toBeCloseTo(EXPECTED_TOTAL, 2);
    for (const style of FOLIO_STYLES) expect(sum(buildFolioRows(numbered, style))).toBeCloseTo(EXPECTED_TOTAL, 2);
  });

  it("a Night Audit night rolls room, extra occupancy and allocation onto one row named after the room", () => {
    const night: PresentableLine[] = [
      line({ id: "alloc", description: "Breakfast", amount: 20, checkNo: "2001", createdAt: "2026-07-01T23:00:02Z" }),
      line({ id: "xo", description: "Extra Occupancy Charge", amount: 30, checkNo: "2001", roomAssignmentId: "ra1", createdAt: "2026-07-01T23:00:01Z" }),
      line({ id: "room", description: "Nightly Room Charge", amount: 100, checkNo: "2001", roomAssignmentId: "ra1", createdAt: "2026-07-01T23:00:00Z" }),
      line({ id: "room-gst", description: "GST", taxAmount: 17, checkNo: "2001", roomAssignmentId: "ra1", generatedFromLineItemId: "room", createdAt: "2026-07-01T22:00:00Z" }),
    ];
    const rows = buildFolioRows(night, "by-check");
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("Nightly Room Charge");
    expect(rows[0].total).toBeCloseTo(167, 2);
  });

  it("the same number on another folio never rolls in", () => {
    const mixed = [
      line({ id: "a", amount: 10, checkNo: "3001", folioId: "F1" }),
      line({ id: "b", amount: 20, checkNo: "3001", folioId: "F2" }),
    ];
    expect(buildFolioRows(mixed, "by-check")).toHaveLength(2);
  });
});

describe("pickMainLine", () => {
  it("never picks a generated line while its parent is a member", () => {
    const members = [
      line({ id: "gst", description: "GST", taxAmount: 50, generatedFromLineItemId: "spa" }),
      line({ id: "spa", description: "Spa — Massage", amount: 10 }),
    ];
    expect(pickMainLine(members).id).toBe("spa");
  });

  it("falls back to the earliest-posted root, then the larger amount", () => {
    const members = [
      line({ id: "b", amount: 5, createdAt: "2026-07-01T10:00:01Z" }),
      line({ id: "a", amount: 1, createdAt: "2026-07-01T10:00:00Z" }),
    ];
    expect(pickMainLine(members).id).toBe("a");
    expect(pickMainLine([line({ id: "x", amount: 1 }), line({ id: "y", amount: 9 })]).id).toBe("y");
  });
});

describe("rollUpByCheck (the folio screen)", () => {
  it("rolls lines sharing a number, leaves singles and voids alone", () => {
    const lines = [
      line({ id: "r", date: D1, description: "Nightly Room Charge", amount: 100, checkNo: "10", roomAssignmentId: "ra" }),
      line({ id: "r-sc", date: D1, description: "Service Charge", serviceChargeAmount: 10, checkNo: "10", generatedFromLineItemId: "r" }),
      line({ id: "solo", date: D1, description: "Laundry", amount: 5, checkNo: "11" }),
      line({ id: "none", date: D2, description: "Minibar", amount: 7, checkNo: null }),
      line({ id: "r-void", date: D2, description: "Wrong", amount: 99, checkNo: "10", isVoid: true }),
    ];
    const entries = rollUpByCheck(lines);
    expect(entries.map((e) => e.kind)).toEqual(["check", "line", "line", "line"]);
    const group = entries[0];
    if (group.kind !== "check") throw new Error("expected a check");
    expect(group.main.id).toBe("r");
    expect(group.lines.map((l) => l.id)).toEqual(["r", "r-sc"]);
    expect(group.total).toBeCloseTo(110, 2); // the void is not counted
    expect(entries[3].kind === "line" && entries[3].line.id).toBe("r-void");
  });

  it("different folios never roll together", () => {
    const entries = rollUpByCheck([
      line({ id: "a", amount: 1, checkNo: "5", folioId: "F1" }),
      line({ id: "b", amount: 2, checkNo: "5", folioId: "F2" }),
    ]);
    expect(entries.every((e) => e.kind === "line")).toBe(true);
  });

  it("check numbers follow the API's rule", () => {
    expect(CHECK_NO_PATTERN.test("A-1001")).toBe(true);
    expect(CHECK_NO_PATTERN.test("")).toBe(false);
    expect(CHECK_NO_PATTERN.test("has space")).toBe(false);
    expect(CHECK_NO_PATTERN.test("x".repeat(21))).toBe(false);
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
