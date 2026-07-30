// The canonical Charge Group -> Subgroup -> Code chart of accounts. This file is THE
// single source of truth for charge classification: the schema comment, the API
// validation, and the report-options endpoint all defer to it instead of each keeping
// their own array (the three mutually-contradictory "category" lists documented in
// CHARGE_CODE_PLAN.md §1.4).
//
// Deliberately free of any Prisma import so client components can read the labels and
// the closed bucket set — the seeder that writes this chart to an enterprise lives in
// src/lib/posting/ensure-charge-tree.ts.
//
// NUMBERING STANDARD (owner ruling 2026-07-30, modeled on the Opera transaction-code
// standardization doc):
//   ChargeGroup    — three-letter alpha (ACC, FNB, SPA, EXC, TRP, OTH, TAX, NRV, SYS)
//   ChargeSubgroup — two digits + two letters (10RV, 20RV, 70SC, 90NR, 99SY); the
//                    letters classify (RV revenue, SC service charge, TX tax, GT green
//                    tax, NR non-revenue, PY payment, SY system)
//   ChargeCode     — four digits whose leading digits align with the subgroup number
//                    (10RV -> 1000..., 20RV -> 2001..., 90NR -> 9100...)
//
// OUTLET-WISE SUBGROUPS: each F&B / Spa / Excursion outlet owns its own nnRV subgroup
// inside its group's band (FNB 20–28, SPA 30–39, EXC 40–49...), holding that outlet's
// posting codes. See OUTLET_SUBGROUP_BANDS below and src/lib/posting/outlet-subgroup.ts.
//
// SINGLE TAX CODES (supersedes the 2026-07-27 per-group tax pairs): ONE Service Charge
// code (7000), ONE GST code (8000), ONE Green Tax code (8500). Which main code produced
// a tax line is tracked structurally — every generated line carries
// FolioLineItem.generatedFromLineItemId pointing at its parent — so per-group tax codes
// added nothing but chart noise. The generate still only decides where the amount lands;
// the ONE default Maldives rule in src/lib/tax-calc.ts computes it.

// The closed set of reporting buckets. Every ChargeGroup carries one; every report
// that used to switch on ChargeCode.category now switches on this. Several groups may
// share a bucket (Spa and Excursions both report as Other) — a bucket never spans
// meanings.
export const REPORT_BUCKETS = [
  "ROOM",
  "FOOD_BEVERAGE",
  "TRANSPORT",
  "OTHER",
  "TAX",
  "NON_REVENUE",
  "SYSTEM",
] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

export const REPORT_BUCKET_LABELS: Record<ReportBucket, string> = {
  ROOM: "Room",
  FOOD_BEVERAGE: "Food & Beverage",
  TRANSPORT: "Transport",
  OTHER: "Other",
  TAX: "Tax",
  NON_REVENUE: "Non-Revenue",
  SYSTEM: "System",
};

// Posting semantics that used to be implied by the magic code string.
//   CHARGE      — ordinary revenue, taxed through src/lib/tax-calc.ts
//   TAX         — a tax or levy. Posted at face value: never itself service-charged or
//                 GST'd, and excluded from the GST base in reports.
//   CREDIT      — posts as a negative (TA commission credit at checkout)
//   NON_REVENUE — a movement that must never be counted as earned revenue
export const POSTING_TYPES = ["CHARGE", "TAX", "CREDIT", "NON_REVENUE"] as const;
export type PostingType = (typeof POSTING_TYPES)[number];

export const POSTING_TYPE_LABELS: Record<PostingType, string> = {
  CHARGE: "Charge",
  TAX: "Tax / Levy",
  CREDIT: "Credit",
  NON_REVENUE: "Non-Revenue",
};

/**
 * Whether a code of this posting type may generate tax at all.
 *
 * ONLY a sale is a taxable event. A payment, refund, paid-out, deposit, commission or
 * system adjustment is a movement of money that has already been taxed (or was never
 * taxable), so GST/VAT on it would be charging tax twice on the same money. This is a
 * hard rule, not a default: it is enforced when a generate is created or edited AND
 * again at posting time, so a row that somehow exists in the database still cannot make
 * a payment produce tax.
 */
export function canGenerateTax(postingType: string | null | undefined): boolean {
  return postingType === "CHARGE";
}

/**
 * How a posting code is taxed, which decides the generates the seeder wires to the
 * global tax codes.
 *   FULL     — Service Charge + GST (ordinary revenue)
 *   GST_ONLY — GST but no service charge (expressible per code where no service was
 *              rendered)
 *   NONE     — taxes, deposits, commissions, system movements
 */
export const TAX_TREATMENTS = ["FULL", "GST_ONLY", "NONE"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

// ── The single global tax codes ───────────────────────────────────────────────────

// One destination per tax, chart-wide. Attribution to the selling code is structural
// (generatedFromLineItemId), never encoded in the tax code identity.
export const TAX_CODES = {
  serviceCharge: "7000",
  gst: "8000",
  greenTax: "8500",
} as const;

// ── Level 1 + 2: groups and their subgroups ───────────────────────────────────────

type SeedSubgroup = { code: string; name: string; sortOrder: number };
type SeedGroup = {
  code: string;
  name: string;
  reportBucket: ReportBucket;
  isRevenue: boolean;
  sortOrder: number;
  subgroups: SeedSubgroup[];
};

export const CANONICAL_GROUPS: SeedGroup[] = [
  {
    code: "ACC",
    name: "Accommodation",
    reportBucket: "ROOM",
    isRevenue: true,
    sortOrder: 10,
    subgroups: [{ code: "10RV", name: "Room Revenue", sortOrder: 10 }],
  },
  {
    // Outlet band 20–28: each F&B outlet owns its own nnRV subgroup. 20RV is seeded as
    // the default so a fresh enterprise can post F&B before any outlet exists; the first
    // F&B outlet adopts it (renaming it to the outlet), the next gets 21RV, and so on.
    // 29RV holds meal-plan revenue — sold with the room, reported separately from outlet
    // F&B, still rolling into the F&B bucket.
    code: "FNB",
    name: "Food & Beverage",
    reportBucket: "FOOD_BEVERAGE",
    isRevenue: true,
    sortOrder: 20,
    subgroups: [
      { code: "20RV", name: "Restaurant", sortOrder: 20 },
      { code: "29RV", name: "Meal Plans", sortOrder: 29 },
    ],
  },
  {
    // Outlet band 30–39; 30RV seeded as the default spa outlet subgroup.
    code: "SPA",
    name: "Spa",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 30,
    subgroups: [{ code: "30RV", name: "Spa", sortOrder: 30 }],
  },
  {
    // Outlet band 40–49; 40RV seeded as the default excursion outlet subgroup.
    code: "EXC",
    name: "Excursions",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 40,
    subgroups: [{ code: "40RV", name: "Excursions", sortOrder: 40 }],
  },
  {
    code: "TRP",
    name: "Transport",
    reportBucket: "TRANSPORT",
    isRevenue: true,
    sortOrder: 50,
    subgroups: [{ code: "50RV", name: "Transport", sortOrder: 50 }],
  },
  {
    code: "OTH",
    name: "Others",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 60,
    subgroups: [{ code: "60RV", name: "Other Revenue", sortOrder: 60 }],
  },
  {
    code: "TAX",
    name: "Taxes & Levies",
    reportBucket: "TAX",
    // Pass-through to the government — collected, never earned.
    isRevenue: false,
    sortOrder: 70,
    subgroups: [
      { code: "70SC", name: "Service Charge", sortOrder: 70 },
      { code: "80TX", name: "GST", sortOrder: 80 },
      { code: "85GT", name: "Green Tax", sortOrder: 85 },
    ],
  },
  {
    code: "NRV",
    name: "Non-Revenue",
    reportBucket: "NON_REVENUE",
    isRevenue: false,
    sortOrder: 90,
    subgroups: [
      { code: "90NR", name: "Non-Revenue", sortOrder: 90 },
      { code: "95PY", name: "Payments", sortOrder: 95 },
    ],
  },
  {
    code: "SYS",
    name: "System",
    reportBucket: "SYSTEM",
    isRevenue: false,
    sortOrder: 99,
    subgroups: [{ code: "99SY", name: "System", sortOrder: 99 }],
  },
];

// ── Outlet subgroup bands & templates ─────────────────────────────────────────────

// Which two-digit range an outlet's own nnRV subgroup is allocated from, by outlet
// type (see src/app/api/outlets/route.ts OUTLET_TYPES). The band's first number is the
// seeded default subgroup, adopted by the first outlet of that kind instead of burning
// a fresh number. 29 is excluded from the FNB band — it's reserved for Meal Plans.
export const OUTLET_SUBGROUP_BANDS: Record<string, { groupCode: string; from: number; to: number }> = {
  RESTAURANT: { groupCode: "FNB", from: 20, to: 28 },
  BAR: { groupCode: "FNB", from: 20, to: 28 },
  SPA: { groupCode: "SPA", from: 30, to: 39 },
  RECREATION: { groupCode: "EXC", from: 40, to: 49 },
  TRANSPORT: { groupCode: "TRP", from: 50, to: 59 },
  RETAIL: { groupCode: "OTH", from: 60, to: 69 },
  OTHER: { groupCode: "OTH", from: 60, to: 69 },
};

// The posting codes a freshly provisioned outlet subgroup starts with. `suffix` is
// appended to the subgroup's two-digit number: outlet 21RV -> 2101, 2102...
export const OUTLET_CODE_TEMPLATES: Record<string, { suffix: string; description: string }[]> = {
  RESTAURANT: [
    { suffix: "01", description: "Breakfast" },
    { suffix: "02", description: "Lunch" },
    { suffix: "03", description: "Dinner" },
    { suffix: "04", description: "Beverage" },
  ],
  BAR: [
    { suffix: "01", description: "Beverage" },
    { suffix: "02", description: "Food" },
  ],
  SPA: [
    { suffix: "01", description: "Treatments" },
    { suffix: "02", description: "Products" },
  ],
  RECREATION: [
    { suffix: "01", description: "Tours" },
    { suffix: "02", description: "Other" },
  ],
  TRANSPORT: [
    { suffix: "01", description: "Transfers" },
    { suffix: "02", description: "Other" },
  ],
  RETAIL: [
    { suffix: "01", description: "Sales" },
    { suffix: "02", description: "Other" },
  ],
  OTHER: [
    { suffix: "01", description: "Sales" },
    { suffix: "02", description: "Other" },
  ],
};

/**
 * Pick the subgroup number a new outlet gets, given every subgroup code that already
 * exists in the enterprise. Pure so it's unit-testable: returns
 *  - `{ adopt: "20RV" }` when the band's seeded default exists and no outlet owns it yet
 *    (the caller checks ownership — this function only sees codes), or
 *  - `{ create: "21RV" }` for the next free number in the band, or
 *  - `null` when the band is exhausted (caller falls back to no subgroup).
 */
export function nextOutletSubgroupCode(
  outletType: string,
  existingSubgroupCodes: string[],
  adoptableCodes: string[]
): { adopt: string } | { create: string } | null {
  const band = OUTLET_SUBGROUP_BANDS[outletType];
  if (!band) return null;
  const existing = new Set(existingSubgroupCodes);
  for (let n = band.from; n <= band.to; n++) {
    const code = `${n}RV`;
    if (adoptableCodes.includes(code)) return { adopt: code };
    if (!existing.has(code)) return { create: code };
  }
  return null;
}

// ── Roles ─────────────────────────────────────────────────────────────────────────

// The roles the runtime resolves a charge code BY, instead of by a literal code string
// (see src/lib/posting/resolve-charge-code.ts). Each has a system-seeded code and an
// EnterpriseSettings pointer the property can repoint from Controls > Cashiering.
export const CHARGE_CODE_ROLES = ["ACCOMMODATION", "GREEN_TAX", "COMMISSION"] as const;
export type ChargeCodeRole = (typeof CHARGE_CODE_ROLES)[number];

// The fee-rule types that POST a charge, each with a seeded code so a fresh property can
// charge a cancellation or no-show without hand-building one first.
//
// DEPOSIT is deliberately absent: a deposit is collected as a Payment before arrival, not
// posted as a charge, and api/settings/fee-rules exempts it from needing a charge code.
// Seeding one would assert a link the flow never uses.
export const FEE_RULE_CODES: Record<"CANCELLATION" | "NO_SHOW", string> = {
  CANCELLATION: "1050",
  NO_SHOW: "1060",
};

// Which charge code a Payment Method of each type settles against, so a freshly seeded
// enterprise has every settlement route linked without anyone wiring it by hand. The
// method's own chargeCodeId can be re-pointed afterwards; a Payment is stamped at
// posting time, so changing it never rewrites settled history.
export const PAYMENT_METHOD_CODES: Record<string, string> = {
  CASH: "9501",
  CARD: "9502",
  TRANSFER: "9503",
  CITY_LEDGER: "9504",
};
/** Fallback for a method whose type isn't one of the four seeded routes. */
export const PAYMENT_METHOD_FALLBACK_CODE = "9500";

// ── Level 3: the standard chart of charge codes ───────────────────────────────────

export type SeedCode = {
  code: string;
  description: string;
  subgroupCode: string;
  postingType: PostingType;
  taxTreatment: TaxTreatment;
  /** Seeded isSystem = true: the admin UI refuses to delete or rename it, because a
   *  role lookup, a fee rule or the seeder itself depends on the code string. */
  isSystem?: boolean;
  role?: ChargeCodeRole;
  /** Green Tax rides on this code (accommodation only — it is a per-night stay levy). */
  levyGreenTax?: boolean;
};

export const STANDARD_CHARGE_CODES: SeedCode[] = [
  // ── ACC / 10RV Room Revenue ──
  { code: "1000", description: "Accommodation", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true, role: "ACCOMMODATION", levyGreenTax: true },
  { code: "1010", description: "Room Upgrade", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "1020", description: "Extra Occupancy", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "1030", description: "Package Component", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL" },
  // Penalties are taxed as ordinary accommodation revenue — Service Charge then GST
  // (owner ruling 2026-07-27). The alternative, GST with no service charge on the
  // grounds that no service was rendered, is still expressible per property by deleting
  // the Service Charge row in Controls > Cashiering > Charge Codes > Generates.
  { code: "1050", description: "Cancellation Fee", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true },
  { code: "1060", description: "No Show Fee", subgroupCode: "10RV", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true },

  // ── FNB / 20RV default F&B outlet (adopted/renamed by the first real outlet) ──
  { code: "2001", description: "Breakfast", subgroupCode: "20RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2002", description: "Lunch", subgroupCode: "20RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2003", description: "Dinner", subgroupCode: "20RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2004", description: "Beverage", subgroupCode: "20RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── FNB / 29RV Meal Plans (sold with the room, kept out of the outlet band) ──
  { code: "2901", description: "Meal Plan — Breakfast", subgroupCode: "29RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2902", description: "Meal Plan — Lunch", subgroupCode: "29RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2903", description: "Meal Plan — Dinner", subgroupCode: "29RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "2904", description: "Meal Plan — All Inclusive", subgroupCode: "29RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── SPA / 30RV default spa outlet ──
  { code: "3001", description: "Spa Treatments", subgroupCode: "30RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "3002", description: "Spa Products", subgroupCode: "30RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── EXC / 40RV default excursion outlet ──
  { code: "4001", description: "Excursion Tours", subgroupCode: "40RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "4002", description: "Excursion Other", subgroupCode: "40RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── TRP / 50RV Transport ──
  { code: "5001", description: "Airport Transfer", subgroupCode: "50RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "5002", description: "Speedboat Transfer", subgroupCode: "50RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "5003", description: "Other Transport", subgroupCode: "50RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── OTH / 60RV Other Revenue ──
  { code: "6001", description: "Laundry", subgroupCode: "60RV", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "6002", description: "Miscellaneous", subgroupCode: "60RV", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── TAX: the three global tax codes. Posted at face value (postingType TAX), so they
  //    are never themselves service-charged or GST'd and stay out of the GST base. ──
  { code: TAX_CODES.serviceCharge, description: "Service Charge", subgroupCode: "70SC", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: TAX_CODES.gst, description: "GST", subgroupCode: "80TX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: TAX_CODES.greenTax, description: "Green Tax", subgroupCode: "85GT", postingType: "TAX", taxTreatment: "NONE", isSystem: true, role: "GREEN_TAX" },

  // ── NRV / 90NR Non-Revenue ──
  { code: "9100", description: "Travel Agent Commission", subgroupCode: "90NR", postingType: "CREDIT", taxTreatment: "NONE", isSystem: true, role: "COMMISSION" },
  // A deposit is an ADVANCE PAYMENT, not a charge: it is collected before arrival as a
  // Payment on the reservation's folio #1, and check-in simply reuses that folio — so it
  // is already on the billing window with nothing to transfer (owner, 2026-07-27). These
  // codes exist for a manual folio adjustment against a deposit, not for that flow, and
  // the DEPOSIT fee rule deliberately carries no charge code at all.
  { code: "9200", description: "Deposit", subgroupCode: "90NR", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9210", description: "Deposit Applied", subgroupCode: "90NR", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "9300", description: "Rebate / Correction", subgroupCode: "90NR", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "9400", description: "Paid Out", subgroupCode: "90NR", postingType: "NON_REVENUE", taxTreatment: "NONE" },

  // ── NRV / 95PY Payments. Money IN: every financial posting is linked to a charge
  //    code, a payment just as much as a charge (owner rule, 2026-07-27) — so each
  //    settlement route has its own code and cash, card, transfer and city-ledger are
  //    identifiable in the ledger. A Payment Method points at one of these
  //    (PaymentMethod.chargeCodeId) and each Payment is stamped with it at posting time.
  //
  //    NON_REVENUE, so canGenerateTax() refuses them: money being settled has already
  //    been taxed on the charge it settles, and taxing it again would double-count. ──
  { code: "9500", description: "Payment Adjustment", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "9501", description: "Payment — Cash", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9502", description: "Payment — Credit Card", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9503", description: "Payment — Bank Transfer", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9504", description: "Payment — City Ledger", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9510", description: "Refund Adjustment", subgroupCode: "95PY", postingType: "NON_REVENUE", taxTreatment: "NONE" },

  // ── SYS / 99SY System ──
  { code: "9901", description: "Internal Adjustment", subgroupCode: "99SY", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "9902", description: "Balance Brought Forward", subgroupCode: "99SY", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "9903", description: "Folio Transfer", subgroupCode: "99SY", postingType: "NON_REVENUE", taxTreatment: "NONE" },
];

// The role -> seeded code mapping the resolver falls back to.
export const SYSTEM_CHARGE_CODES = STANDARD_CHARGE_CODES.filter(
  (c): c is SeedCode & { role: ChargeCodeRole } => !!c.role
);

// ── Derived: the generates the seeder wires ───────────────────────────────────────

export type SeedGenerate = {
  generatorCode: string;
  generatedCode: string;
  method: string;
  value: number;
  calculateOn: string;
  sortOrder: number;
};

/**
 * The generates a posting code with the given tax treatment should carry: Service
 * Charge and GST route to the single global codes; accommodation additionally levies
 * Green Tax. The one rule every code shares — the generate only names the destination,
 * src/lib/tax-calc.ts computes the amounts once per posting.
 */
export function generatesForTreatment(
  generatorCode: string,
  taxTreatment: TaxTreatment,
  levyGreenTax?: boolean
): SeedGenerate[] {
  const out: SeedGenerate[] = [];
  if (taxTreatment === "FULL") {
    out.push({ generatorCode, generatedCode: TAX_CODES.serviceCharge, method: "SERVICE_CHARGE", value: 0, calculateOn: "NET", sortOrder: 10 });
  }
  if (taxTreatment !== "NONE") {
    out.push({ generatorCode, generatedCode: TAX_CODES.gst, method: "GST", value: 0, calculateOn: "NET", sortOrder: 20 });
  }
  if (levyGreenTax) {
    out.push({ generatorCode, generatedCode: TAX_CODES.greenTax, method: "GREEN_TAX", value: 0, calculateOn: "NET", sortOrder: 30 });
  }
  return out;
}

/** Every generate implied by the standard chart. */
export function standardGenerates(): SeedGenerate[] {
  return STANDARD_CHARGE_CODES.flatMap((code) =>
    generatesForTreatment(code.code, code.taxTreatment, code.levyGreenTax)
  );
}

/** Whether this subgroup's group levies Green Tax on its postings (accommodation). */
export function isAccommodationSubgroup(subgroupCode: string): boolean {
  const group = CANONICAL_GROUPS.find((g) => g.subgroups.some((s) => s.code === subgroupCode));
  return group?.reportBucket === "ROOM";
}
