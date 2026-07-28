import type { EnterpriseSettings } from "@prisma/client";

// Opera's "generates" mechanism, as a pure calculation. Posting a charge code can
// automatically post derived codes — taxes, bed levies, municipal fees — declared as
// ChargeCodeGenerate rows instead of the hardcoded "ROOM also posts GTX" branch that
// used to live in Night Audit (CHARGE_CODE_PLAN.md §4).
//
// This is deliberately NOT a second tax engine. Service Charge and GST stay entirely in
// src/lib/tax-calc.ts, applied to the parent line; generates only produce *additional
// lines* for levies that are separate charges in their own right. The Maldives Green
// Tax is exactly that shape, and method GREEN_TAX reads its rates straight from the
// enterprise's existing Maldives Tax configuration (EnterpriseSettings.greenTax*) —
// Controls > Finance > Tax remains the single place those amounts are edited.

export const GENERATE_METHODS = [
  "SERVICE_CHARGE",
  "GST",
  "GREEN_TAX",
  "PERCENT",
  "FLAT",
  "PER_PERSON_PER_NIGHT",
] as const;
export type GenerateMethod = (typeof GENERATE_METHODS)[number];

export const GENERATE_METHOD_LABELS: Record<GenerateMethod, string> = {
  SERVICE_CHARGE: "Service Charge (from Tax config)",
  GST: "GST (from Tax config)",
  GREEN_TAX: "Maldives Green Tax (from Tax config)",
  PERCENT: "Percentage of basis",
  FLAT: "Flat amount",
  PER_PERSON_PER_NIGHT: "Per person, per night",
};

/**
 * The two methods that ROUTE tax rather than compute it.
 *
 * A `SERVICE_CHARGE` / `GST` generate does not calculate anything of its own: the
 * enterprise's Maldives Tax engine (src/lib/tax-calc.ts) has already resolved both
 * amounts for the parent charge, and the generate only declares WHICH charge code each
 * lands on. That is what makes "every group generates its own tax codes, all on the same
 * default rule" true by construction — the rule is shared because there is still exactly
 * one calculation, and only its destination differs per group.
 *
 * Because the tax is posted as its own line, the parent line must not also carry it in
 * its own tax columns; postCharge moves the amount rather than duplicating it.
 */
export const TAX_ROUTING_METHODS = ["SERVICE_CHARGE", "GST"] as const;
export type TaxRoutingMethod = (typeof TAX_ROUTING_METHODS)[number];

export function isTaxRoutingMethod(method: string): method is TaxRoutingMethod {
  return (TAX_ROUTING_METHODS as readonly string[]).includes(method);
}

export const CALCULATE_ON = ["NET", "GROSS", "ANOTHER_GENERATE"] as const;
export type CalculateOn = (typeof CALCULATE_ON)[number];

export const CALCULATE_ON_LABELS: Record<CalculateOn, string> = {
  NET: "Parent's net (pre-tax) amount",
  GROSS: "Parent's gross (incl. tax & service charge)",
  ANOTHER_GENERATE: "Another generate on this code",
};

/** Headcount/duration the parent posting covers — the basis PER_PERSON_PER_NIGHT and
 *  GREEN_TAX need. Infants are deliberately absent: they are exempt and not counted
 *  (see .agents/docs/DECISIONS.md, "Green Tax posting & the `infants` bucket"). */
export type PostingContext = {
  adults: number;
  children: number;
  nights: number;
};

export type GenerateRow = {
  id: string;
  generatedCodeId: string;
  method: string;
  value: number;
  calculateOn: string;
  basisGenerateId: string | null;
  sortOrder: number;
  isActive: boolean;
};

export type GeneratedAmount = {
  generate: GenerateRow;
  amount: number;
  /**
   * The amount is a final, face-value figure that must be posted as-is — the tax engine
   * must not touch it and `pricesIncludeTaxes` does not apply.
   *
   * True for GREEN_TAX: a government levy is a tax by construction, so taxing it would
   * be wrong no matter how the target charge code is configured. That matters beyond
   * tidiness — an enterprise whose GTX code predates `postingType` still has it set to
   * CHARGE/useDefaultTax, and without this the nightly levy would silently start being
   * service-charged and GST'd.
   */
  isFinal: boolean;
};

type GreenTaxSettings = Pick<EnterpriseSettings, "greenTaxEnabled" | "greenTaxAdultAmount" | "greenTaxChildAmount">;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute every generated amount for one parent posting, in ascending sortOrder.
 *
 * Rows compound through a bucket map: NET and GROSS come from the parent line, and each
 * row's own output is keyed by its id so a later row can calculate on it via
 * `calculateOn = "ANOTHER_GENERATE"` + `basisGenerateId`. A row referencing a basis that
 * hasn't been computed yet (out-of-order, deactivated, or a cycle) resolves to a zero
 * basis rather than throwing — a mis-configured cascade must never fail a night audit.
 *
 * Rows that compute to zero are dropped: a disabled Green Tax, or a percentage of a
 * zero-rate room night, should post no line at all rather than a $0.00 one.
 */
export function computeGeneratedAmounts(params: {
  generates: GenerateRow[];
  /** The parent line's pre-tax base (what tax-calc returned as baseAmount). */
  netAmount: number;
  /** The parent line's base + tax + service charge. */
  grossAmount: number;
  settings: GreenTaxSettings | null;
  context?: PostingContext | null;
}): GeneratedAmount[] {
  const { generates, netAmount, grossAmount, settings, context } = params;

  const ordered = [...generates]
    // SERVICE_CHARGE / GST rows are handled by postCharge, which moves an
    // already-resolved amount onto them — there is nothing to compute here, and letting
    // them fall through to the PERCENT default would invent a second, wrong figure.
    .filter((g) => g.isActive && !isTaxRoutingMethod(g.method))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  // Bucket map — every basis a later row may compound on.
  const buckets = new Map<string, number>();
  const out: GeneratedAmount[] = [];

  for (const g of ordered) {
    const amount = computeOne(g, { netAmount, grossAmount, buckets, settings, context });
    buckets.set(g.id, amount);
    if (Math.abs(amount) > 0.005) {
      out.push({ generate: g, amount: round2(amount), isFinal: g.method === "GREEN_TAX" });
    }
  }

  return out;
}

function computeOne(
  g: GenerateRow,
  env: {
    netAmount: number;
    grossAmount: number;
    buckets: Map<string, number>;
    settings: GreenTaxSettings | null;
    context?: PostingContext | null;
  }
): number {
  switch (g.method as GenerateMethod) {
    case "GREEN_TAX": {
      // Reads the enterprise's own Maldives Tax config rather than duplicating the
      // rates onto the generate row — so switching Green Tax off, or changing the
      // per-adult amount, takes effect here with no charge-code edit.
      if (!env.settings?.greenTaxEnabled) return 0;
      const ctx = env.context;
      if (!ctx) return 0;
      const perNight = round2(
        ctx.adults * (env.settings.greenTaxAdultAmount ?? 0) + ctx.children * (env.settings.greenTaxChildAmount ?? 0)
      );
      return round2(perNight * Math.max(0, ctx.nights));
    }
    case "FLAT":
      return g.value;
    case "PER_PERSON_PER_NIGHT": {
      const ctx = env.context;
      if (!ctx) return 0;
      return round2(g.value * (ctx.adults + ctx.children) * Math.max(0, ctx.nights));
    }
    case "PERCENT":
    default: {
      const basis = resolveBasis(g, env);
      return round2((basis * g.value) / 100);
    }
  }
}

function resolveBasis(
  g: GenerateRow,
  env: { netAmount: number; grossAmount: number; buckets: Map<string, number> }
): number {
  switch (g.calculateOn as CalculateOn) {
    case "GROSS":
      return env.grossAmount;
    case "ANOTHER_GENERATE":
      return g.basisGenerateId ? (env.buckets.get(g.basisGenerateId) ?? 0) : 0;
    case "NET":
    default:
      return env.netAmount;
  }
}

/**
 * Cycle guard for the admin surface: a code may not generate itself, directly or via a
 * chain of other generate rows. Enforced when a generate row is created/updated so the
 * posting path never has to defend against it.
 *
 * `edges` is the enterprise's full generator -> generated adjacency, including the row
 * being proposed.
 */
export function hasGenerateCycle(edges: Array<{ generatorCodeId: string; generatedCodeId: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.generatorCodeId === e.generatedCodeId) return true;
    const list = adjacency.get(e.generatorCodeId) ?? [];
    list.push(e.generatedCodeId);
    adjacency.set(e.generatorCodeId, list);
  }

  const UNVISITED = 0, IN_STACK = 1, DONE = 2;
  const state = new Map<string, number>();

  const visit = (node: string): boolean => {
    const s = state.get(node) ?? UNVISITED;
    if (s === IN_STACK) return true;
    if (s === DONE) return false;
    state.set(node, IN_STACK);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state.set(node, DONE);
    return false;
  };

  for (const node of adjacency.keys()) {
    if (visit(node)) return true;
  }
  return false;
}
