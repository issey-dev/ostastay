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
// Structure mirrors Opera's transaction-code hierarchy:
//   ChargeGroup    — the reporting bucket (what a revenue report sums into)
//   ChargeSubgroup — the sub-classification inside it
//   ChargeCode     — the actual posting code
//
// TAX IS ATTACHED AT GROUP LEVEL. Each revenue group declares its own Service Charge and
// GST charge codes (`taxCodes`), and every posting code in that group generates them. So
// Accommodation posts SVCACM/GSTACM, F&B posts SVCFNB/GSTFNB, Spa posts SVCSPA/GSTSPA —
// distinct codes per group, but all computed by the ONE default Maldives Tax rule in
// src/lib/tax-calc.ts. The generate only decides where each amount lands; it never
// calculates a rate of its own, so the groups can never drift apart.

// The closed set of reporting buckets. Every ChargeGroup carries one; every report
// that used to switch on ChargeCode.category now switches on this. Several groups may
// share a bucket (Meal Plans and the F&B outlet both report as Food & Beverage; Spa and
// Excursions both as Other) — a bucket never spans meanings.
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
 * How a posting code is taxed, which decides the generates the seeder wires to its
 * group's tax codes.
 *   FULL     — Service Charge + GST (ordinary revenue)
 *   GST_ONLY — GST but no service charge. Cancellation and no-show penalties: no service
 *              was rendered, so a service charge on them is not defensible.
 *   NONE     — taxes, deposits, commissions, system movements
 */
export const TAX_TREATMENTS = ["FULL", "GST_ONLY", "NONE"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

// ── Level 1 + 2: groups and their subgroups ───────────────────────────────────────

type SeedSubgroup = { code: string; name: string; sortOrder: number };
type SeedGroup = {
  code: string;
  name: string;
  reportBucket: ReportBucket;
  isRevenue: boolean;
  sortOrder: number;
  subgroups: SeedSubgroup[];
  /**
   * This group's own tax charge codes. Every FULL/GST_ONLY posting code in the group
   * generates them. Absent on the tax, non-revenue and system groups — those are never
   * themselves taxed.
   */
  taxCodes?: { serviceCharge: string; gst: string };
};

export const CANONICAL_GROUPS: SeedGroup[] = [
  {
    code: "ACCOMMODATION",
    name: "Accommodation",
    reportBucket: "ROOM",
    isRevenue: true,
    sortOrder: 10,
    taxCodes: { serviceCharge: "SVCACM", gst: "GSTACM" },
    subgroups: [
      { code: "ROOM_REVENUE", name: "Room Revenue", sortOrder: 10 },
      { code: "EXTRA_OCCUPANCY", name: "Extra Occupancy", sortOrder: 20 },
      { code: "PACKAGE", name: "Packages & Allocations", sortOrder: 30 },
      { code: "ACCOM_PENALTY", name: "Cancellation & No-Show", sortOrder: 40 },
    ],
  },
  {
    // The property's food & beverage outlet.
    code: "FOOD_BEVERAGE",
    name: "Food & Beverage",
    reportBucket: "FOOD_BEVERAGE",
    isRevenue: true,
    sortOrder: 20,
    taxCodes: { serviceCharge: "SVCFNB", gst: "GSTFNB" },
    subgroups: [
      { code: "RESTAURANT", name: "Restaurant", sortOrder: 10 },
      { code: "BAR", name: "Bar", sortOrder: 20 },
      { code: "MINIBAR", name: "Minibar", sortOrder: 30 },
      { code: "ROOM_SERVICE", name: "Room Service", sortOrder: 40 },
    ],
  },
  {
    // Its own group, not an F&B subgroup: meal-plan revenue is sold with the room and
    // reported separately from outlet F&B, while still rolling into the F&B bucket.
    code: "MEAL_PLAN",
    name: "Meal Plans",
    reportBucket: "FOOD_BEVERAGE",
    isRevenue: true,
    sortOrder: 30,
    taxCodes: { serviceCharge: "SVCMPL", gst: "GSTMPL" },
    subgroups: [{ code: "MEAL_PLAN_REVENUE", name: "Meal Plan Revenue", sortOrder: 10 }],
  },
  {
    code: "TRANSPORT",
    name: "Transport",
    reportBucket: "TRANSPORT",
    isRevenue: true,
    sortOrder: 40,
    taxCodes: { serviceCharge: "SVCTRN", gst: "GSTTRN" },
    subgroups: [
      { code: "TRANSFERS", name: "Airport & Jetty Transfers", sortOrder: 10 },
      { code: "TRANSPORT_OTHER", name: "Other Transport", sortOrder: 20 },
    ],
  },
  {
    code: "SPA",
    name: "Spa",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 50,
    taxCodes: { serviceCharge: "SVCSPA", gst: "GSTSPA" },
    subgroups: [
      { code: "SPA_TREATMENT", name: "Treatments", sortOrder: 10 },
      { code: "SPA_PRODUCT", name: "Retail Products", sortOrder: 20 },
    ],
  },
  {
    code: "EXCURSION",
    name: "Excursions",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 60,
    taxCodes: { serviceCharge: "SVCEXC", gst: "GSTEXC" },
    subgroups: [
      { code: "EXCURSION_TOUR", name: "Tours & Activities", sortOrder: 10 },
      { code: "EXCURSION_OTHER", name: "Excursion Extras", sortOrder: 20 },
    ],
  },
  {
    code: "OTHER",
    name: "Other Revenue",
    reportBucket: "OTHER",
    isRevenue: true,
    sortOrder: 70,
    taxCodes: { serviceCharge: "SVCOTH", gst: "GSTOTH" },
    subgroups: [
      { code: "LAUNDRY", name: "Laundry", sortOrder: 10 },
      { code: "MISCELLANEOUS", name: "Miscellaneous", sortOrder: 20 },
    ],
  },
  {
    code: "TAX",
    name: "Taxes & Levies",
    reportBucket: "TAX",
    // Pass-through to the government — collected, never earned.
    isRevenue: false,
    sortOrder: 80,
    subgroups: [
      { code: "SERVICE_CHARGE", name: "Service Charge", sortOrder: 10 },
      { code: "SALES_TAX", name: "GST", sortOrder: 20 },
      { code: "GOVERNMENT_LEVY", name: "Government Levies", sortOrder: 30 },
    ],
  },
  {
    code: "NON_REVENUE",
    name: "Non-Revenue",
    reportBucket: "NON_REVENUE",
    isRevenue: false,
    sortOrder: 90,
    subgroups: [
      { code: "COMMISSION", name: "Commissions", sortOrder: 10 },
      { code: "DEPOSIT", name: "Deposits & Prepayments", sortOrder: 20 },
      { code: "PAYMENT", name: "Payments & Settlement", sortOrder: 30 },
      { code: "NON_REVENUE_OTHER", name: "Other Non-Revenue", sortOrder: 40 },
    ],
  },
  {
    code: "SYSTEM",
    name: "System",
    reportBucket: "SYSTEM",
    isRevenue: false,
    sortOrder: 100,
    subgroups: [
      { code: "ADJUSTMENT", name: "Adjustments & Corrections", sortOrder: 10 },
      { code: "SYSTEM_OTHER", name: "Other System", sortOrder: 20 },
    ],
  },
];

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
  CANCELLATION: "CXL",
  NO_SHOW: "NOSHW",
};

// Which charge code a Payment Method of each type settles against, so a freshly seeded
// enterprise has every settlement route linked without anyone wiring it by hand. The
// method's own chargeCodeId can be re-pointed afterwards; a Payment is stamped at
// posting time, so changing it never rewrites settled history.
export const PAYMENT_METHOD_CODES: Record<string, string> = {
  CASH: "PAYCSH",
  CARD: "PAYCRD",
  TRANSFER: "PAYTRF",
  CITY_LEDGER: "PAYCL",
};
/** Fallback for a method whose type isn't one of the four seeded routes. */
export const PAYMENT_METHOD_FALLBACK_CODE = "PMTADJ";

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
  // ── Accommodation ──
  { code: "ROOM", description: "Accommodation", subgroupCode: "ROOM_REVENUE", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true, role: "ACCOMMODATION", levyGreenTax: true },
  { code: "ROOMUP", description: "Accommodation Upgrade", subgroupCode: "ROOM_REVENUE", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "XOCC", description: "Extra Occupancy", subgroupCode: "EXTRA_OCCUPANCY", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "PKG", description: "Package Component", subgroupCode: "PACKAGE", postingType: "CHARGE", taxTreatment: "FULL" },
  // Penalties are taxed as ordinary accommodation revenue — Service Charge then GST
  // (owner ruling 2026-07-27). The alternative, GST with no service charge on the
  // grounds that no service was rendered, is still expressible per property by deleting
  // the Service Charge row in Controls > Cashiering > Charge Codes > Generates.
  { code: "CXL", description: "Cancellation Fee", subgroupCode: "ACCOM_PENALTY", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true },
  { code: "NOSHW", description: "No-Show Fee", subgroupCode: "ACCOM_PENALTY", postingType: "CHARGE", taxTreatment: "FULL", isSystem: true },

  // ── Food & Beverage outlet ──
  { code: "FBFOOD", description: "Restaurant — Food", subgroupCode: "RESTAURANT", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "FBBEV", description: "Bar — Beverage", subgroupCode: "BAR", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "FBMINI", description: "Minibar", subgroupCode: "MINIBAR", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "FBRSVC", description: "Room Service", subgroupCode: "ROOM_SERVICE", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Meal plans ──
  { code: "MPBF", description: "Meal Plan — Breakfast", subgroupCode: "MEAL_PLAN_REVENUE", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "MPLN", description: "Meal Plan — Lunch", subgroupCode: "MEAL_PLAN_REVENUE", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "MPDN", description: "Meal Plan — Dinner", subgroupCode: "MEAL_PLAN_REVENUE", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "MPAI", description: "Meal Plan — All Inclusive", subgroupCode: "MEAL_PLAN_REVENUE", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Transport ──
  { code: "TRFAIR", description: "Airport Transfer", subgroupCode: "TRANSFERS", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "TRFSPD", description: "Speedboat Transfer", subgroupCode: "TRANSFERS", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "TRFOTH", description: "Other Transport", subgroupCode: "TRANSPORT_OTHER", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Spa outlet ──
  { code: "SPATRT", description: "Spa Treatment", subgroupCode: "SPA_TREATMENT", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "SPAPRD", description: "Spa Retail Product", subgroupCode: "SPA_PRODUCT", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Excursions ──
  { code: "EXCTUR", description: "Excursion", subgroupCode: "EXCURSION_TOUR", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "EXCOTH", description: "Excursion Extra", subgroupCode: "EXCURSION_OTHER", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Other revenue ──
  { code: "LNDRY", description: "Laundry", subgroupCode: "LAUNDRY", postingType: "CHARGE", taxTreatment: "FULL" },
  { code: "MISC", description: "Miscellaneous", subgroupCode: "MISCELLANEOUS", postingType: "CHARGE", taxTreatment: "FULL" },

  // ── Taxes: one Service Charge + one GST code per revenue group, all driven by the
  //    single default Maldives rule. Posted at face value (postingType TAX), so they are
  //    never themselves service-charged or GST'd and stay out of the GST base. ──
  { code: "SVCACM", description: "Service Charge — Accommodation", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCFNB", description: "Service Charge — Food & Beverage", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCMPL", description: "Service Charge — Meal Plans", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCTRN", description: "Service Charge — Transport", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCSPA", description: "Service Charge — Spa", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCEXC", description: "Service Charge — Excursions", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "SVCOTH", description: "Service Charge — Other", subgroupCode: "SERVICE_CHARGE", postingType: "TAX", taxTreatment: "NONE", isSystem: true },

  { code: "GSTACM", description: "GST — Accommodation", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTFNB", description: "GST — Food & Beverage", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTMPL", description: "GST — Meal Plans", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTTRN", description: "GST — Transport", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTSPA", description: "GST — Spa", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTEXC", description: "GST — Excursions", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },
  { code: "GSTOTH", description: "GST — Other", subgroupCode: "SALES_TAX", postingType: "TAX", taxTreatment: "NONE", isSystem: true },

  { code: "GTX", description: "Green Tax", subgroupCode: "GOVERNMENT_LEVY", postingType: "TAX", taxTreatment: "NONE", isSystem: true, role: "GREEN_TAX" },

  // ── Non-revenue ──
  { code: "COMM", description: "Travel Agent Commission", subgroupCode: "COMMISSION", postingType: "CREDIT", taxTreatment: "NONE", isSystem: true, role: "COMMISSION" },
  // A deposit is an ADVANCE PAYMENT, not a charge: it is collected before arrival as a
  // Payment on the reservation's folio #1, and check-in simply reuses that folio — so it
  // is already on the billing window with nothing to transfer (owner, 2026-07-27). These
  // codes exist for a manual folio adjustment against a deposit, not for that flow, and
  // the DEPOSIT fee rule deliberately carries no charge code at all.
  { code: "DEP", description: "Deposit", subgroupCode: "DEPOSIT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "DEPAPP", description: "Deposit Applied", subgroupCode: "DEPOSIT", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  // Money IN. Every financial posting is linked to a charge code, a payment just as
  // much as a charge (owner rule, 2026-07-27) — so each settlement route has its own
  // code and cash, card, transfer and city-ledger are identifiable in the ledger.
  // A Payment Method points at one of these (PaymentMethod.chargeCodeId) and each
  // Payment is stamped with it at posting time.
  //
  // NON_REVENUE, so canGenerateTax() refuses them: money being settled has already been
  // taxed on the charge it settles, and taxing it again would double-count.
  { code: "PAYCSH", description: "Payment — Cash", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "PAYCRD", description: "Payment — Card", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "PAYTRF", description: "Payment — Bank Transfer", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "PAYCL", description: "Payment — City Ledger", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "PMTADJ", description: "Payment Adjustment", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "REFADJ", description: "Refund Adjustment", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "PAIDOUT", description: "Paid Out", subgroupCode: "PAYMENT", postingType: "NON_REVENUE", taxTreatment: "NONE" },

  // ── System ──
  { code: "ADJ", description: "Adjustment", subgroupCode: "ADJUSTMENT", postingType: "NON_REVENUE", taxTreatment: "NONE", isSystem: true },
  { code: "REBATE", description: "Rebate / Correction", subgroupCode: "ADJUSTMENT", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "OPENBAL", description: "Opening Balance", subgroupCode: "SYSTEM_OTHER", postingType: "NON_REVENUE", taxTreatment: "NONE" },
  { code: "FTRANS", description: "Folio Transfer", subgroupCode: "SYSTEM_OTHER", postingType: "NON_REVENUE", taxTreatment: "NONE" },
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
 * Every generate implied by the chart: each posting code routes its Service Charge and
 * GST to its OWN GROUP's tax codes, and accommodation additionally levies Green Tax.
 *
 * Derived rather than hand-listed so a code can never be added to a group and silently
 * miss its tax — the group owns the tax codes, and membership is the whole rule.
 */
export function standardGenerates(): SeedGenerate[] {
  const groupOfSubgroup = new Map<string, SeedGroup>();
  for (const g of CANONICAL_GROUPS) {
    for (const s of g.subgroups) groupOfSubgroup.set(s.code, g);
  }

  const out: SeedGenerate[] = [];
  for (const code of STANDARD_CHARGE_CODES) {
    const group = groupOfSubgroup.get(code.subgroupCode);
    if (!group?.taxCodes || code.taxTreatment === "NONE") continue;

    if (code.taxTreatment === "FULL") {
      out.push({ generatorCode: code.code, generatedCode: group.taxCodes.serviceCharge, method: "SERVICE_CHARGE", value: 0, calculateOn: "NET", sortOrder: 10 });
    }
    out.push({ generatorCode: code.code, generatedCode: group.taxCodes.gst, method: "GST", value: 0, calculateOn: "NET", sortOrder: 20 });
    if (code.levyGreenTax) {
      out.push({ generatorCode: code.code, generatedCode: "GTX", method: "GREEN_TAX", value: 0, calculateOn: "NET", sortOrder: 30 });
    }
  }
  return out;
}

/** The tax codes belonging to the group that owns `subgroupCode`, or null. */
export function groupTaxCodesForSubgroup(subgroupCode: string): { serviceCharge: string; gst: string } | null {
  const group = CANONICAL_GROUPS.find((g) => g.subgroups.some((s) => s.code === subgroupCode));
  return group?.taxCodes ?? null;
}

/** Whether this subgroup's group levies Green Tax on its accommodation postings. */
export function isAccommodationSubgroup(subgroupCode: string): boolean {
  const group = CANONICAL_GROUPS.find((g) => g.subgroups.some((s) => s.code === subgroupCode));
  return group?.reportBucket === "ROOM";
}

// ── Legacy mapping ────────────────────────────────────────────────────────────────

// The old free-text ChargeCode.category -> the subgroup a backfilled code lands in.
// Anything not listed here is logged rather than guessed (CHARGE_CODE_PLAN.md §6.3).
export const LEGACY_CATEGORY_TO_SUBGROUP: Record<string, string> = {
  ROOM: "ROOM_REVENUE",
  FOOD_BEVERAGE: "RESTAURANT",
  TRANSPORTATION: "TRANSFERS",
  TRANSPORT: "TRANSFERS",
  OTHERS: "MISCELLANEOUS",
  OTHER: "MISCELLANEOUS",
  TAX: "GOVERNMENT_LEVY",
  NON_REVENUE: "NON_REVENUE_OTHER",
  SYSTEM: "SYSTEM_OTHER",
};

// The reverse view: the deprecated `category` string kept in sync on write so any
// un-migrated reader still sees a sane value during the migration window.
export const BUCKET_TO_LEGACY_CATEGORY: Record<ReportBucket, string> = {
  ROOM: "ROOM",
  FOOD_BEVERAGE: "FOOD_BEVERAGE",
  TRANSPORT: "TRANSPORTATION",
  OTHER: "OTHERS",
  TAX: "TAX",
  NON_REVENUE: "NON_REVENUE",
  SYSTEM: "SYSTEM",
};

// The deprecated `category` value a code in this subgroup should carry, so the column
// stays truthful for any reader not yet migrated to reportBucket.
export function legacyCategoryForSubgroup(subgroupCode: string): string {
  const group = CANONICAL_GROUPS.find((g) => g.subgroups.some((s) => s.code === subgroupCode));
  return group ? BUCKET_TO_LEGACY_CATEGORY[group.reportBucket] : "OTHERS";
}
