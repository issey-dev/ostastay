import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITIES, roleCapabilities, mergeCapabilities, summarizeRole } from "@/lib/capabilities";
import { capabilityOverridesFromBody } from "@/lib/role-capabilities";
import { gateBookingConflicts } from "@/lib/restrictions";
import { stripFigures, stripReportFigures } from "@/lib/figures";
import { MODULES } from "@/lib/modules";

// Agent Portal plan §10 / Phase 0b: capabilities and Suppress rates.

const perm = (module: string, v = false, c = false, u = false, d = false) => ({
  module,
  canView: v,
  canCreate: c,
  canUpdate: u,
  canDelete: d,
});
const full = MODULES.map((m) => perm(m, true, true, true, true));

describe("capability defaults", () => {
  it("a full role gets every capability by default (nobody loses anything on upgrade)", () => {
    const caps = roleCapabilities(full, []);
    for (const c of CAPABILITIES) expect(caps.has(c.key)).toBe(true);
  });

  it("defaults follow the role's own module permissions", () => {
    const desk = [perm("RESERVATIONS", true, true, true, false), perm("AVAILABILITY", true, false, false, false)];
    const caps = roleCapabilities(desk, []);
    expect(caps.has("reservations.overbook")).toBe(true);
    expect(caps.has("reservations.overrideStopSale")).toBe(false); // needs AVAILABILITY update
    expect(caps.has("reservations.exceedSellLimit")).toBe(false); // needs AVAILABILITY delete
    expect(caps.has("figures.see")).toBe(true);
  });

  it("an override switches a default off or on", () => {
    const caps = roleCapabilities(full, [
      { capability: "reservations.overbook", granted: false },
      { capability: "figures.see", granted: false },
    ]);
    expect(caps.has("reservations.overbook")).toBe(false);
    expect(caps.has("figures.see")).toBe(false);
    const none = roleCapabilities([], [{ capability: "reports.export", granted: true }]);
    expect(none.has("reports.export")).toBe(true);
  });

  it("a suppressed role cannot hold a capability that needs figures", () => {
    const caps = roleCapabilities(full, [{ capability: "figures.see", granted: false }]);
    expect(caps.has("billing.voidBill")).toBe(false);
    expect(caps.has("billing.advanceFolio")).toBe(false);
    expect(caps.has("debtors.payCommission")).toBe(false);
  });

  it("merges across roles by OR, like module permissions", () => {
    const a = roleCapabilities(full, [{ capability: "figures.see", granted: false }]);
    const b = roleCapabilities([perm("HOUSEKEEPING", true)], []);
    const merged = mergeCapabilities([a, b]);
    expect(merged.has("figures.see")).toBe(true); // role b sees figures
    expect(merged.has("reservations.overbook")).toBe(true); // role a can overbook
  });

  it("unknown capability keys from a request are never stored", () => {
    expect(capabilityOverridesFromBody({ "reservations.overbook": false, "made.up": true, "figures.see": "no" })).toEqual([
      { capability: "reservations.overbook", granted: false },
    ]);
    expect(capabilityOverridesFromBody(null)).toEqual([]);
  });

  it("summarises a role in plain language", () => {
    const caps = roleCapabilities(full, [{ capability: "figures.see", granted: false }]);
    expect(summarizeRole(full, caps)).toMatch(/cannot see rates/);
  });

  it("every capability in the catalogue is enforced somewhere in the code", () => {
    // The catalogue is code, not data: each key must appear in a check outside capabilities.ts.
    const sources = [
      "src/lib/reservations/create-reservation.ts",
      "src/app/api/reservations/[id]/route.ts",
      "src/app/api/groups/[id]/pickup/route.ts",
      "src/app/api/availability/restrictions/route.ts",
      "src/app/api/reservations/[id]/reverse-check-in/route.ts",
      "src/app/api/reservations/[id]/reverse-check-out/route.ts",
      "src/app/api/reservations/[id]/eregistration-link/route.ts",
      "src/app/api/reservations/[id]/advance-bill/route.ts",
      "src/app/api/folios/[id]/void-bill/route.ts",
      "src/app/api/night-audit/run/route.ts",
      "src/app/api/reports/generate/route.ts",
      "src/lib/figures.ts",
      ...extraEnforcers,
    ]
      .map((f) => {
        try {
          return readFileSync(join(process.cwd(), f), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const missing = CAPABILITIES.map((c) => c.key)
      .filter((k) => !NOT_YET_WIRED.has(k))
      .filter((k) => !sources.includes(`"${k}"`));
    expect(missing).toEqual([]);
  });
});

// Catalogued now, wired by the phase that builds the feature behind it (each phase removes
// its keys from this set in the same commit). Empty once Phase 7 is in.
const NOT_YET_WIRED = new Set<string>([
  "profiles.portalLogins",
  "debtors.payCommission",
]);

// Later phases add their enforcing files here as they wire their capabilities.
const extraEnforcers: string[] = [
  "src/lib/reservations/options.ts",
  "src/lib/availability-sell-limit.ts",
  "src/app/api/availability/sell-limits/route.ts",
  "src/lib/reservations/overflow.ts",
  "src/lib/groups/slot-requests.ts",
  "src/app/api/profiles/[upid]/portal-logins/route.ts",
  "src/lib/commission-ledger.ts",
  "src/app/api/debtors/commissions/route.ts",
];

describe("overbook capability at the booking gate", () => {
  it("without the capability, an overbook cannot be confirmed past", () => {
    const g = gateBookingConflicts({
      stopSale: [],
      availability: ["Deluxe: 0 left on 1 Jan"],
      acknowledgeOverbook: true,
      canOverrideStopSale: false,
      canOverbook: false,
    });
    expect(g?.requiresOverbookConfirm).toBe(false);
    expect(g?.error).toMatch(/does not allow overbooking/);
  });

  it("with it, acknowledging passes as before", () => {
    expect(
      gateBookingConflicts({ stopSale: [], availability: ["x"], acknowledgeOverbook: true, canOverrideStopSale: false, canOverbook: true })
    ).toBeNull();
  });
});

describe("Suppress rates", () => {
  const reservation = {
    id: "r1",
    status: "RESERVED",
    ratePlanId: "rp1",
    totalAmount: 450,
    balance: 120,
    assignments: [{ id: "a1", overrideRate: 150, roomTypeId: "t1", ratePlan: { id: "rp1", name: "BAR", baseRate: 150 } }],
    folios: [{ id: "f1", balance: 120, lineItems: [{ amount: 150, taxAmount: 25 }], payments: [{ amount: 330, method: "CASH" }] }],
    guestName: "A Guest",
    adults: 2,
  };

  it("removes rates, totals and charge lines but keeps the balance", () => {
    const out = stripFigures(reservation) as Record<string, any>;
    expect(out.totalAmount).toBeUndefined();
    expect(out.balance).toBe(120);
    expect(out.assignments[0].overrideRate).toBeUndefined();
    expect(out.assignments[0].ratePlan.baseRate).toBeUndefined();
    expect(out.assignments[0].ratePlan.name).toBe("BAR");
    expect(out.folios[0].lineItems).toBeUndefined();
    expect(out.folios[0].balance).toBe(120);
    expect(out.folios[0].payments[0].amount).toBeUndefined();
    expect(out.ratePlanId).toBe("rp1");
    expect(out.adults).toBe(2);
    expect(JSON.stringify(out)).not.toMatch(/"(amount|totalAmount|overrideRate|baseRate|taxAmount)"/);
  });

  it("drops currency columns, money KPIs and charts from a report", () => {
    const out = stripReportFigures({
      title: "Revenue",
      columns: [
        { key: "room", label: "Room" },
        { key: "revenue", label: "Revenue", format: "currency" },
        { key: "balance", label: "Balance", format: "currency" },
      ],
      rows: [{ room: "101", revenue: 100, balance: 20 }],
      totals: { revenue: 100, balance: 20 },
      summary: [
        { key: "rev", label: "Revenue", value: 100, format: "currency" as any },
        { key: "occ", label: "Occupancy", value: 80, format: "percent" as any },
      ],
      visuals: [{} as any],
    });
    expect(out.columns.map((c) => c.key)).toEqual(["room", "balance"]);
    expect(out.rows).toEqual([{ room: "101", balance: 20 }]);
    expect(out.summary?.map((k) => k.key)).toEqual(["occ"]);
    expect(out.visuals).toEqual([]);
  });

  it("the money-bearing routes go through the redaction", () => {
    const routes = [
      "src/app/api/reservations/route.ts",
      "src/app/api/reservations/[id]/route.ts",
      "src/app/api/reservations/tape-chart/route.ts",
      "src/app/api/tape-chart/route.ts",
      "src/app/api/reservations/quote/route.ts",
      "src/app/api/reservations/rate-availability/route.ts",
      "src/app/api/reservations/[id]/daily-breakdown/route.ts",
      "src/app/api/folios/route.ts",
      "src/app/api/folios/[id]/route.ts",
      "src/app/api/groups/route.ts",
      "src/app/api/groups/[id]/route.ts",
      "src/app/api/dashboard/overview/route.ts",
      "src/app/api/reports/generate/route.ts",
    ];
    const notRedacting = routes.filter(
      (f) => !/figuresJson|stripReportFigures|redactFigures/.test(readFileSync(join(process.cwd(), f), "utf8"))
    );
    expect(notRedacting).toEqual([]);
  });
});
