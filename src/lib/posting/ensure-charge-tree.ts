import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CANONICAL_GROUPS,
  STANDARD_CHARGE_CODES,
  SYSTEM_CHARGE_CODES,
  FEE_RULE_CODES,
  PAYMENT_METHOD_CODES,
  PAYMENT_METHOD_FALLBACK_CODE,
  standardGenerates,
} from "@/lib/posting/charge-tree";

// The idempotent seeder that puts the canonical chart of accounts (see charge-tree.ts)
// on an enterprise. Split from the definitions so those stay importable from client
// components — this half touches Prisma and is server-only.
//
// Called at property onboarding (api/properties), lazily by the Cashiering panel for an
// enterprise that predates the hierarchy, and by
// scripts/dev-tools/backfill-charge-hierarchy.ts.

type Client = Prisma.TransactionClient | typeof prisma;

export type EnsureChargeTreeResult = {
  groupsCreated: number;
  subgroupsCreated: number;
  codesCreated: number;
  generatesCreated: number;
};

// Idempotent: safe to re-run on an enterprise that already has some or all of the chart.
// Never touches a code's tax configuration or description — only classification.
export async function ensureChargeTree(
  client: Client,
  enterpriseId: string
): Promise<EnsureChargeTreeResult> {
  const result: EnsureChargeTreeResult = {
    groupsCreated: 0,
    subgroupsCreated: 0,
    codesCreated: 0,
    generatesCreated: 0,
  };

  // 1. Groups + subgroups. Both are unique on [enterpriseId, code], so an existing row
  // is adopted (and its system flags/bucket re-asserted) rather than duplicated.
  const subgroupIdByCode = new Map<string, string>();
  for (const g of CANONICAL_GROUPS) {
    const existingGroup = await client.chargeGroup.findUnique({
      where: { enterpriseId_code: { enterpriseId, code: g.code } },
    });
    const group = existingGroup
      ? await client.chargeGroup.update({
          where: { id: existingGroup.id },
          data: { reportBucket: g.reportBucket, isRevenue: g.isRevenue, isSystem: true },
        })
      : await client.chargeGroup.create({
          data: {
            enterpriseId,
            code: g.code,
            name: g.name,
            reportBucket: g.reportBucket,
            isRevenue: g.isRevenue,
            isSystem: true,
            sortOrder: g.sortOrder,
          },
        });
    if (!existingGroup) result.groupsCreated += 1;

    for (const s of g.subgroups) {
      const existingSub = await client.chargeSubgroup.findUnique({
        where: { enterpriseId_code: { enterpriseId, code: s.code } },
      });
      const sub = existingSub
        ? await client.chargeSubgroup.update({
            where: { id: existingSub.id },
            data: { chargeGroupId: group.id, isSystem: true },
          })
        : await client.chargeSubgroup.create({
            data: {
              enterpriseId,
              chargeGroupId: group.id,
              code: s.code,
              name: s.name,
              isSystem: true,
              sortOrder: s.sortOrder,
            },
          });
      if (!existingSub) result.subgroupsCreated += 1;
      subgroupIdByCode.set(s.code, sub.id);
    }
  }

  // 2. The standard chart of charge codes. An enterprise that already has a code of the
  // same name keeps it — with its own tax config and description untouched — and is only
  // adopted into the hierarchy and flagged isSystem where the chart says so.
  const codeIdByCode = new Map<string, string>();
  for (const c of STANDARD_CHARGE_CODES) {
    const subgroupId = subgroupIdByCode.get(c.subgroupCode)!;
    const existing = await client.chargeCode.findUnique({
      where: { enterpriseId_code: { enterpriseId, code: c.code } },
    });
    const row = existing
      ? await client.chargeCode.update({
          where: { id: existing.id },
          data: {
            // chargeSubgroupId is required, so an existing code always has one — the
            // seeder classifies, it never re-files a code the property has moved.
            chargeSubgroupId: existing.chargeSubgroupId,
            postingType: existing.isSystem ? existing.postingType : c.postingType,
            isSystem: c.isSystem ?? existing.isSystem,
          },
        })
      : await client.chargeCode.create({
          data: {
            enterpriseId,
            code: c.code,
            description: c.description,
            chargeSubgroupId: subgroupId,
            postingType: c.postingType,
            isSystem: c.isSystem ?? false,
            isActive: true,
            // Every code uses the enterprise's default Maldives Tax rule. A tax code's
            // own postingType keeps it out of the tax engine entirely, so the flag is
            // moot there; a revenue code's Service Charge and GST are routed to its
            // group's tax codes by the generates below.
            useDefaultTax: true,
          },
        });
    if (!existing) result.codesCreated += 1;
    codeIdByCode.set(c.code, row.id);
  }


  // 3. Generates: every revenue code routes its Service Charge and GST to its own
  // GROUP's tax codes, and accommodation levies Green Tax on top. Unique on
  // [generatorCodeId, generatedCodeId], so a re-run adopts the existing row rather than
  // stacking duplicates — and never overwrites one the property has since tuned.
  for (const gen of standardGenerates()) {
    const generatorCodeId = codeIdByCode.get(gen.generatorCode);
    const generatedCodeId = codeIdByCode.get(gen.generatedCode);
    if (!generatorCodeId || !generatedCodeId) continue;
    const existing = await client.chargeCodeGenerate.findUnique({
      where: { generatorCodeId_generatedCodeId: { generatorCodeId, generatedCodeId } },
    });
    if (existing) continue;
    await client.chargeCodeGenerate.create({
      data: {
        enterpriseId,
        generatorCodeId,
        generatedCodeId,
        method: gen.method,
        value: gen.value,
        calculateOn: gen.calculateOn,
        sortOrder: gen.sortOrder,
      },
    });
    result.generatesCreated += 1;
  }

  // 4. Point the enterprise's roles at the seeded codes, unless it has already chosen
  // its own. Without this the resolver still falls back by code string, but having the
  // pointers set means Controls > Cashiering > Posting Defaults shows the real answer
  // rather than "None".
  const settings = await client.enterpriseSettings.findUnique({ where: { enterpriseId } });
  if (settings) {
    const pointer = (current: string | null, role: string) =>
      current ?? codeIdByCode.get(SYSTEM_CHARGE_CODES.find((c) => c.role === role)!.code) ?? null;
    await client.enterpriseSettings.update({
      where: { enterpriseId },
      data: {
        defaultAccommodationChargeCodeId: pointer(settings.defaultAccommodationChargeCodeId, "ACCOMMODATION"),
        defaultGreenTaxChargeCodeId: pointer(settings.defaultGreenTaxChargeCodeId, "GREEN_TAX"),
        commissionChargeCodeId: pointer(settings.commissionChargeCodeId, "COMMISSION"),
      },
    });
  }

  // 5. Link every Payment Method to the code its money posts against. Every financial
  // posting is linked to a charge code — a payment as much as a charge (owner rule) — so
  // a method without one is a settlement route that can't be identified in the ledger.
  // Only fills a missing link; a method the property has re-pointed is left alone.
  const methods = await client.paymentMethod.findMany({
    where: { enterpriseId, chargeCodeId: null },
    select: { id: true, type: true },
  });
  for (const m of methods) {
    const codeId = codeIdByCode.get(PAYMENT_METHOD_CODES[m.type] ?? PAYMENT_METHOD_FALLBACK_CODE);
    if (!codeId) continue;
    await client.paymentMethod.update({ where: { id: m.id }, data: { chargeCodeId: codeId } });
  }

  return result;
}

/**
 * Give every property a Cancellation and No-Show fee rule pointing at its own seeded
 * charge code, so both are wired end-to-end from Controls > Finance > Deposit & Fee Rules
 * the moment a property is onboarded.
 *
 * DEPOSIT rules are deliberately not seeded: a deposit is an advance PAYMENT collected
 * before arrival onto the reservation's folio, which check-in then reuses as the billing
 * folio — it never posts a charge, and api/settings/fee-rules exempts it from needing a
 * charge code. Seeding one would assert a link the flow never uses.
 *
 * Seeded INACTIVE with a zero amount: a fee that charges real money must be a deliberate
 * decision by the property, not something a seeder switches on. The WIRING is what's
 * being provisioned here — the policy stays the owner's.
 */
export async function ensureFeeRules(client: Client, enterpriseId: string): Promise<number> {
  const properties = await client.property.findMany({ where: { enterpriseId }, select: { id: true } });
  const codes = await client.chargeCode.findMany({
    where: { enterpriseId, code: { in: Object.values(FEE_RULE_CODES) } },
    select: { id: true, code: true },
  });
  const codeIdByCode = new Map(codes.map((c) => [c.code, c.id]));

  const NAMES: Record<keyof typeof FEE_RULE_CODES, string> = {
    CANCELLATION: "Standard Cancellation Fee",
    NO_SHOW: "Standard No-Show Fee",
  };

  let created = 0;
  for (const property of properties) {
    for (const ruleType of Object.keys(FEE_RULE_CODES) as Array<keyof typeof FEE_RULE_CODES>) {
      const chargeCodeId = codeIdByCode.get(FEE_RULE_CODES[ruleType]);
      if (!chargeCodeId) continue;

      const existing = await client.propertyFeeRule.findFirst({ where: { propertyId: property.id, ruleType } });
      if (existing) {
        // Only fill a missing link — never repoint a rule the property has configured.
        if (!existing.chargeCodeId) {
          await client.propertyFeeRule.update({ where: { id: existing.id }, data: { chargeCodeId } });
        }
        continue;
      }
      await client.propertyFeeRule.create({
        data: { propertyId: property.id, name: NAMES[ruleType], ruleType, basis: "FLAT", value: 0, chargeCodeId, isActive: false },
      });
      created += 1;
    }
  }
  return created;
}
