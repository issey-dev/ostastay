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
// on ONE PROPERTY. Split from the definitions so those stay importable from client
// components — this half touches Prisma and is server-only.
//
// Per property since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md, Phase 2): every property
// keeps its own chart, and properties differ — one without a spa needs no Spa codes. So
// the optional `modules` leaves out the Spa and Excursions groups (and their codes) for a
// property that doesn't offer them. Re-running later with the module switched on adds
// them; nothing is ever removed.
//
// Called at property onboarding (api/properties, api/osta/properties/create), lazily by
// the Charge Codes page for a property that has no chart, and by the seed scripts.

type Client = Prisma.TransactionClient | typeof prisma;

export type EnsureChargeTreeResult = {
  groupsCreated: number;
  subgroupsCreated: number;
  codesCreated: number;
  generatesCreated: number;
};

export type ChartModules = { spa?: boolean; excursions?: boolean };

// Groups a property only gets when it offers the module.
const MODULE_GROUPS: Record<string, keyof ChartModules> = { SPA: "spa", EXC: "excursions" };

// Idempotent: safe to re-run on a property that already has some or all of the chart.
// Never touches a code's tax configuration or description — only classification.
export async function ensureChargeTree(
  client: Client,
  { propertyId }: { propertyId: string },
  modules: ChartModules = { spa: true, excursions: true }
): Promise<EnsureChargeTreeResult> {
  const result: EnsureChargeTreeResult = {
    groupsCreated: 0,
    subgroupsCreated: 0,
    codesCreated: 0,
    generatesCreated: 0,
  };

  const property = await client.property.findUniqueOrThrow({ where: { id: propertyId }, select: { enterpriseId: true } });
  const enterpriseId = property.enterpriseId;
  const wanted = (groupCode: string) => {
    const module = MODULE_GROUPS[groupCode];
    return !module || modules[module] !== false;
  };

  // 1. Groups + subgroups. Both are unique on [propertyId, code], so an existing row is
  // adopted (and its system flags/bucket re-asserted) rather than duplicated.
  const subgroupIdByCode = new Map<string, string>();
  for (const g of CANONICAL_GROUPS) {
    if (!wanted(g.code)) continue;
    const existingGroup = await client.chargeGroup.findUnique({
      where: { propertyId_code: { propertyId, code: g.code } },
    });
    const group = existingGroup
      ? await client.chargeGroup.update({
          where: { id: existingGroup.id },
          data: { reportBucket: g.reportBucket, isRevenue: g.isRevenue, isSystem: true },
        })
      : await client.chargeGroup.create({
          data: {
            enterpriseId,
            propertyId,
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
        where: { propertyId_code: { propertyId, code: s.code } },
      });
      const sub = existingSub
        ? await client.chargeSubgroup.update({
            where: { id: existingSub.id },
            data: { chargeGroupId: group.id, isSystem: true },
          })
        : await client.chargeSubgroup.create({
            data: {
              enterpriseId,
              propertyId,
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

  // 2. The standard chart of charge codes. A property that already has a code of the
  // same name keeps it — with its own tax config and description untouched — and is only
  // adopted into the hierarchy and flagged isSystem where the chart says so.
  const codeIdByCode = new Map<string, string>();
  for (const c of STANDARD_CHARGE_CODES) {
    const subgroupId = subgroupIdByCode.get(c.subgroupCode);
    if (!subgroupId) continue; // its group was left out (a module this property doesn't offer)
    const existing = await client.chargeCode.findUnique({
      where: { propertyId_code: { propertyId, code: c.code } },
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
            propertyId,
            code: c.code,
            description: c.description,
            chargeSubgroupId: subgroupId,
            postingType: c.postingType,
            isSystem: c.isSystem ?? false,
            isActive: true,
            // Every code uses the property's default Maldives Tax rule. A tax code's own
            // postingType keeps it out of the tax engine entirely, so the flag is moot
            // there; a revenue code's Service Charge and GST are routed to its group's
            // tax codes by the generates below.
            useDefaultTax: true,
          },
        });
    if (!existing) result.codesCreated += 1;
    codeIdByCode.set(c.code, row.id);
  }

  // 3. Generates: every revenue code routes its Service Charge and GST to the property's
  // single tax codes (7000/8000), and accommodation levies Green Tax on top. Unique on
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
        propertyId,
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

  // 4. Point the property's roles at the seeded codes, unless it has already chosen its
  // own. Without this the resolver still falls back by code string, but having the
  // pointers set means Charge Codes › Posting Defaults shows the real answer, not "None".
  const settings = await client.propertySettings.upsert({
    where: { propertyId },
    create: { propertyId },
    update: {},
  });
  const pointer = (current: string | null, role: string) =>
    current ?? codeIdByCode.get(SYSTEM_CHARGE_CODES.find((c) => c.role === role)!.code) ?? null;
  await client.propertySettings.update({
    where: { propertyId },
    data: {
      defaultAccommodationChargeCodeId: pointer(settings.defaultAccommodationChargeCodeId, "ACCOMMODATION"),
      defaultGreenTaxChargeCodeId: pointer(settings.defaultGreenTaxChargeCodeId, "GREEN_TAX"),
      commissionChargeCodeId: pointer(settings.commissionChargeCodeId, "COMMISSION"),
    },
  });

  // 5. Link every Payment Method to the code its money posts against. Every financial
  // posting is linked to a charge code — a payment as much as a charge (owner rule) — so
  // a method without one is a settlement route that can't be identified in the ledger.
  // Only fills a missing link; a method the property has re-pointed is left alone.
  const methods = await client.paymentMethod.findMany({
    where: { propertyId, chargeCodeId: null },
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
 * Give a property a Cancellation and No-Show fee rule pointing at its own seeded charge
 * code, so both are wired end-to-end from the property's Finance page the moment it is
 * onboarded.
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
export async function ensureFeeRules(client: Client, { propertyId }: { propertyId: string }): Promise<number> {
  const codes = await client.chargeCode.findMany({
    where: { propertyId, code: { in: Object.values(FEE_RULE_CODES) } },
    select: { id: true, code: true },
  });
  const codeIdByCode = new Map(codes.map((c) => [c.code, c.id]));

  const NAMES: Record<keyof typeof FEE_RULE_CODES, string> = {
    CANCELLATION: "Standard Cancellation Fee",
    NO_SHOW: "Standard No-Show Fee",
  };

  let created = 0;
  for (const ruleType of Object.keys(FEE_RULE_CODES) as Array<keyof typeof FEE_RULE_CODES>) {
    const chargeCodeId = codeIdByCode.get(FEE_RULE_CODES[ruleType]);
    if (!chargeCodeId) continue;

    const existing = await client.propertyFeeRule.findFirst({ where: { propertyId, ruleType } });
    if (existing) {
      // Only fill a missing link — never repoint a rule the property has configured.
      if (!existing.chargeCodeId) {
        await client.propertyFeeRule.update({ where: { id: existing.id }, data: { chargeCodeId } });
      }
      continue;
    }
    await client.propertyFeeRule.create({
      data: { propertyId, name: NAMES[ruleType], ruleType, basis: "FLAT", value: 0, chargeCodeId, isActive: false },
    });
    created += 1;
  }
  return created;
}

/**
 * Which module groups a NEW property's chart gets (owner, 2026-09-23: "one property has
 * spa + excursion but the other one does not"). A module is included only when the
 * enterprise holds its add-on; the onboarding form may then leave it out for this
 * property (offersSpa / offersExcursions === false). Adding it later is harmless — the
 * seeder only ever adds, and outlet provisioning seeds a missing module group on demand.
 */
export async function chartModulesFor(
  client: Client,
  enterpriseId: string,
  requested?: { offersSpa?: unknown; offersExcursions?: unknown }
): Promise<ChartModules> {
  const addons = await client.enterpriseAddonAccess.findMany({
    where: { enterpriseId, enabled: true, module: { in: ["SPA", "EXCURSIONS"] } },
    select: { module: true },
  });
  const held = new Set(addons.map((a) => a.module));
  return {
    spa: held.has("SPA") && requested?.offersSpa !== false,
    excursions: held.has("EXCURSIONS") && requested?.offersExcursions !== false,
  };
}
