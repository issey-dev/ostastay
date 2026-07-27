import { Prisma } from "@prisma/client";
import type { EnterpriseSettings, FolioLineItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveOutletChargeTax } from "@/lib/tax-calc";
import {
  computeGeneratedAmounts,
  isTaxRoutingMethod,
  type GenerateRow,
  type PostingContext,
  type TaxRoutingMethod,
} from "@/lib/posting/run-generates";

// THE single entry point for writing a FolioLineItem (CHARGE_CODE_PLAN.md §3). Every
// financial write site posts through here instead of hand-building rows, so that:
//
//   * tax resolution always goes through src/lib/tax-calc.ts — this file contains no
//     tax math of its own and never will,
//   * a code's `postingType` is honoured consistently (a TAX levy is posted at face
//     value, never itself service-charged or GST'd), and
//   * declared ChargeCodeGenerate rows fire automatically, so Green Tax — and any bed
//     tax or municipal levy a property adds later — posts without new code.

type Client = Prisma.TransactionClient | typeof prisma;

const TAX_INCLUDE = { taxProfile: { include: { rates: true } } } as const;

/** The charge-code shape postCharge needs. Load it with `chargeCodeInclude()`. */
export type PostableChargeCode = Prisma.ChargeCodeGetPayload<{
  include: { taxProfile: { include: { rates: true } } };
}>;

export function chargeCodeInclude() {
  return TAX_INCLUDE;
}

type OutletTaxOverride = {
  taxOverrideMode: string;
  taxProfile?: { rates: Array<{ name: string; ratePercent: number; calculateOn: string; order: number; effectiveFrom: Date; effectiveTo: Date | null }> } | null;
} | null;

export type PostChargeInput = {
  folioId: string;
  /** Pre-loaded (with taxProfile.rates) — resolve it via resolveChargeCode() or a
   *  caller-supplied id, never a literal code string. */
  chargeCode: PostableChargeCode;
  /** The amount the user/rate entered. Tax is added on top of it, or backed out of it,
   *  per `pricesIncludeTaxes`. Negative is allowed (credits, adjustments).
   *  Mutually exclusive with `amounts`. */
  inputAmount?: number;
  /**
   * An already-split posting, used instead of `inputAmount` when the caller holds the
   * authoritative breakdown and must not have it recomputed — Advance Bill posts the
   * exact figures the reservation quote showed the guest, so re-running the tax engine
   * over an already-net base would silently double-tax the bill.
   */
  amounts?: { baseAmount: number; taxAmount: number; serviceChargeAmount: number };
  settings: EnterpriseSettings | null;
  pricesIncludeTaxes: boolean;
  /** Business date the line is stamped with — never wall-clock. */
  date: Date;

  description?: string | null;
  reference?: string | null;

  /** Stamped on this line when it was itself produced by a generate (postCharge sets
   *  this for its own cascade; callers normally leave it unset). */
  generatedFromLineItemId?: string | null;

  outletId?: string | null;
  /** Outlet tax override, when posting through a point of sale. */
  outlet?: OutletTaxOverride;
  outletCheckId?: string | null;
  roomAssignmentId?: string | null;
  shiftId?: string | null;

  /** Headcount/nights the posting covers — required for Green Tax and any other
   *  per-person generate to produce an amount. */
  postingContext?: PostingContext | null;

  /**
   * Run this code's ChargeCodeGenerate rows. Default true.
   *
   * Set false when a single logical stay-night posts more than one line against the
   * same code (Night Audit's extra-occupancy surcharge rides on the room code) — the
   * levies must fire once per night, not once per line.
   */
  runGenerates?: boolean;

  /**
   * Generate rows to apply on top of the ones stored against this charge code, for a
   * levy that is implied by the posting rather than declared on the code.
   *
   * This exists for one case: the Maldives Green Tax is a rule about *accommodation*,
   * not about one particular code. A property that adds a second room charge code (per
   * rate plan) — or whose codes predate the hierarchy and were never backfilled — must
   * not silently stop levying it. Night Audit supplies the implied Green Tax row; a row
   * actually stored on the code always wins, so an explicit configuration (including a
   * deliberately deleted one) is never overridden.
   */
  extraGenerates?: GenerateRow[];

  /** Where a generated line lands. Defaults to the parent's folio; Night Audit passes
   *  its folio-routing resolver so a routed Green Tax follows its own rule. */
  routeGeneratedTo?: (chargeCodeId: string) => string;

  /** Description for generated lines. Defaults to the generated code's own description. */
  generatedDescription?: (code: { code: string; description: string }) => string;
};

export type PostedLines = {
  parent: FolioLineItem;
  /** Every line this call generated — routed tax lines first, then levies. */
  generated: FolioLineItem[];
  /** Pre-tax base of the parent line. */
  baseAmount: number;
  /**
   * Tax + service charge belonging to the parent charge, whether it stayed in the
   * parent's own columns or was moved onto routed tax lines. Callers totalling "tax
   * collected" must use this and NOT also sum `generated`, or routed tax double-counts.
   */
  taxTotal: number;
  /** Generated levies and fees (Green Tax, bed tax...) — excludes routed tax. */
  leviesTotal: number;
  /** Everything written by this call: base + taxTotal + leviesTotal. */
  grandTotal: number;
};

/**
 * Post one charge (plus anything it generates) inside the caller's transaction.
 *
 * Always call this with a transaction client on a path that writes more than one line —
 * the generated levies must roll back with their parent or a folio ends up with a Green
 * Tax line and no room charge behind it.
 */
export async function postCharge(client: Client, input: PostChargeInput): Promise<PostedLines> {
  const {
    folioId,
    chargeCode,
    inputAmount,
    settings,
    pricesIncludeTaxes,
    date,
    postingContext,
    runGenerates = true,
  } = input;

  // ONLY a CHARGE is a taxable event. A TAX levy is a flat government charge in its own
  // right; a CREDIT (commission) and a NON_REVENUE movement (deposit, folio transfer,
  // paid out) are not sales at all. All three post at face value — `pricesIncludeTaxes`
  // doesn't apply to them either. This generalises the behaviour the hardcoded Green Tax
  // branch already had, and it is why a commission credit can safely go through the same
  // posting path as a room charge.
  const isTaxable = chargeCode.postingType === "CHARGE";

  if (inputAmount === undefined && !input.amounts) {
    throw new Error("postCharge: one of `inputAmount` or `amounts` is required");
  }

  const { baseAmount, taxAmount, serviceChargeAmount } = input.amounts
    ? input.amounts
    : isTaxable
      ? resolveOutletChargeTax({
          chargeCode,
          outlet: input.outlet ?? null,
          inputAmount: inputAmount!,
          settings,
          pricesIncludeTaxes,
        })
      : { baseAmount: round2(inputAmount!), taxAmount: 0, serviceChargeAmount: 0 };

  // Generates are loaded BEFORE the parent line is written, because a tax-routing row
  // (SERVICE_CHARGE / GST) moves an amount off the parent onto its own line. The tax is
  // never recomputed — it is the figure tax-calc.ts already resolved above — so a folio's
  // total is identical whether tax sits in the parent's columns or on its own line.
  const loaded: GenerateRow[] = runGenerates ? await loadGenerates(client, chargeCode.id, input.extraGenerates) : [];

  // HARD RULE: tax never generates on anything that isn't a sale. A payment, refund,
  // paid-out, deposit, commission or system adjustment is money that has already been
  // taxed (or was never taxable), so GST/VAT on it would tax the same money twice. The
  // admin API refuses to create such a row; this second check means a row that somehow
  // exists — a hand-edited database, an older export — still cannot produce tax.
  const rows = isTaxable ? loaded : loaded.filter((r) => !isTaxRoutingMethod(r.method) && r.method !== "GREEN_TAX");

  const taxRoutes = new Map<TaxRoutingMethod, GenerateRow>();
  for (const r of rows) {
    if (isTaxRoutingMethod(r.method) && !taxRoutes.has(r.method)) taxRoutes.set(r.method, r);
  }
  const routedServiceCharge = taxRoutes.has("SERVICE_CHARGE") ? serviceChargeAmount : 0;
  const routedGst = taxRoutes.has("GST") ? taxAmount : 0;

  const parent = await client.folioLineItem.create({
    data: {
      folioId,
      chargeCodeId: chargeCode.id,
      outletId: input.outletId ?? null,
      outletCheckId: input.outletCheckId ?? null,
      roomAssignmentId: input.roomAssignmentId ?? null,
      shiftId: input.shiftId ?? null,
      generatedFromLineItemId: input.generatedFromLineItemId ?? null,
      amount: baseAmount,
      taxAmount: taxAmount - routedGst,
      serviceChargeAmount: serviceChargeAmount - routedServiceCharge,
      description: input.description?.trim() || chargeCode.description,
      reference: input.reference?.trim() || null,
      date,
    },
  });

  const generated: FolioLineItem[] = [];
  let leviesTotal = 0;

  // Tax lines first, so a folio reads base -> service charge -> GST -> levies in the
  // order a guest expects. Each keeps its amount in the SAME column it occupied on the
  // parent (serviceChargeAmount / taxAmount), so every report that sums those columns —
  // GST return, EOD trial balance, shift summary — is unaffected by the move.
  for (const [method, route] of taxRoutes) {
    const amount = method === "SERVICE_CHARGE" ? routedServiceCharge : routedGst;
    if (Math.abs(amount) <= 0.005) continue;
    const code = await client.chargeCode.findUnique({ where: { id: route.generatedCodeId }, include: TAX_INCLUDE });
    if (!code || !code.isActive) continue;

    const line = await client.folioLineItem.create({
      data: {
        folioId: input.routeGeneratedTo?.(code.id) ?? folioId,
        chargeCodeId: code.id,
        generatedFromLineItemId: parent.id,
        outletId: input.outletId ?? null,
        outletCheckId: input.outletCheckId ?? null,
        roomAssignmentId: input.roomAssignmentId ?? null,
        shiftId: input.shiftId ?? null,
        amount: 0,
        taxAmount: method === "GST" ? amount : 0,
        serviceChargeAmount: method === "SERVICE_CHARGE" ? amount : 0,
        description: code.description,
        date,
      },
    });
    generated.push(line);
    // Deliberately NOT added to leviesTotal: this amount is already inside taxTotal —
    // it was moved off the parent, not added to the bill.
  }

  if (runGenerates) {
    if (rows.length > 0) {
      const amounts = computeGeneratedAmounts({
        generates: rows,
        netAmount: baseAmount,
        grossAmount: baseAmount + taxAmount + serviceChargeAmount,
        settings,
        context: postingContext ?? null,
      });

      if (amounts.length > 0) {
        const generatedCodes = await client.chargeCode.findMany({
          where: { id: { in: amounts.map((a) => a.generate.generatedCodeId) } },
          include: TAX_INCLUDE,
        });
        const codeById = new Map(generatedCodes.map((c) => [c.id, c]));

        for (const { generate, amount, isFinal } of amounts) {
          const code = codeById.get(generate.generatedCodeId);
          // A deactivated or deleted target is skipped, not fatal — a mis-configured
          // cascade must never take a night audit down with it.
          if (!code || !code.isActive) continue;
          // The same hard rule as above, caught by TARGET rather than by method: a
          // non-sale can't route to a tax code by dressing the row up as a PERCENT.
          if (!isTaxable && code.postingType === "TAX") continue;

          // Recursion is deliberately not supported: a generated code's own generate
          // rows do NOT fire. Cascading is expressed within one generator's row set via
          // calculateOn = ANOTHER_GENERATE, which keeps the cascade finite by
          // construction. hasGenerateCycle() guards the admin surface as well.
          const line = await postCharge(client, {
            folioId: input.routeGeneratedTo?.(code.id) ?? folioId,
            chargeCode: code,
            // A final amount (a government levy) posts at face value whatever the target
            // code says; anything else still resolves tax from the code's own config, so
            // a generated service fee can carry GST if the property wants it to.
            ...(isFinal
              ? { amounts: { baseAmount: amount, taxAmount: 0, serviceChargeAmount: 0 } }
              : { inputAmount: amount }),
            settings,
            pricesIncludeTaxes,
            date,
            description: input.generatedDescription?.(code) ?? code.description,
            generatedFromLineItemId: parent.id,
            roomAssignmentId: input.roomAssignmentId ?? null,
            outletId: input.outletId ?? null,
            outletCheckId: input.outletCheckId ?? null,
            shiftId: input.shiftId ?? null,
            postingContext,
            runGenerates: false,
          });
          generated.push(line.parent);
          leviesTotal += line.grandTotal;
        }
      }
    }
  }

  // taxTotal is the parent charge's tax however it was posted — in its own columns, or
  // moved onto routed tax lines. Callers that total "tax collected" must use this and
  // NOT also walk `generated`, or routed tax would be counted twice.
  const taxTotal = taxAmount + serviceChargeAmount;
  return {
    parent,
    generated,
    baseAmount,
    taxTotal,
    leviesTotal: round2(leviesTotal),
    grandTotal: round2(baseAmount + taxTotal + leviesTotal),
  };
}

// A code's stored generate rows plus any implied by the caller. A stored row always wins
// over an implied one for the same target code, so an explicit configuration (including a
// deliberately deleted one) is authoritative — see PostChargeInput.extraGenerates.
async function loadGenerates(
  client: Client,
  chargeCodeId: string,
  extra: GenerateRow[] | undefined
): Promise<GenerateRow[]> {
  const stored = await client.chargeCodeGenerate.findMany({
    where: { generatorCodeId: chargeCodeId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const storedTargets = new Set(stored.map((r) => r.generatedCodeId));
  return [...stored, ...(extra ?? []).filter((r) => !storedTargets.has(r.generatedCodeId))];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
