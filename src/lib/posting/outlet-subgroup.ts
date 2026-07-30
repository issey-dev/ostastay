import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  OUTLET_SUBGROUP_BANDS,
  OUTLET_CODE_TEMPLATES,
  nextOutletSubgroupCode,
  generatesForTreatment,
} from "@/lib/posting/charge-tree";

// Outlet-wise charge subgroups (owner ruling 2026-07-30): each F&B / Spa / Excursion /
// Transport / Retail outlet owns its own nnRV subgroup inside its group's numeric band
// (FNB 20–28, SPA 30–39, EXC 40–49, TRP 50–59, OTH 60–69), holding that outlet's own
// 4-digit posting codes (21RV -> 2101 Breakfast, 2102 Lunch...).
//
// The band's first number is seeded as an unowned default (20RV/30RV/40RV...) so a
// fresh enterprise can post before any outlet exists — the first outlet of each kind
// ADOPTS that default (takes ownership and its name) instead of burning a number; every
// later outlet gets the next free number. Numbering increments across the whole
// enterprise, matching the chart's own enterprise-wide scope.

type Client = Prisma.TransactionClient | typeof prisma;

export type ProvisionResult = {
  subgroupCode: string;
  adopted: boolean;
  codesCreated: number;
} | null;

/**
 * Give a newly created outlet its own charge subgroup + posting codes, and link those
 * codes to the outlet (OutletChargeCode) so its POS picker starts populated. Returns
 * null when the outlet type has no band or the band is exhausted — the outlet still
 * works, it just has no auto-provisioned codes.
 */
export async function provisionOutletSubgroup(
  client: Client,
  { enterpriseId, outletId, outletName, outletType }: {
    enterpriseId: string;
    outletId: string;
    outletName: string;
    outletType: string;
  }
): Promise<ProvisionResult> {
  const band = OUTLET_SUBGROUP_BANDS[outletType];
  if (!band) return null;

  // Idempotent: an outlet that already owns a subgroup keeps it — re-running (seed
  // re-runs, retried requests) must never burn a second band number on the same outlet.
  const owned = await client.chargeSubgroup.findFirst({ where: { outletId } });
  if (owned) return { subgroupCode: owned.code, adopted: false, codesCreated: 0 };

  const group = await client.chargeGroup.findUnique({
    where: { enterpriseId_code: { enterpriseId, code: band.groupCode } },
  });
  if (!group) return null; // chart not seeded — nothing to hang the subgroup on

  const existingSubgroups = await client.chargeSubgroup.findMany({
    where: { enterpriseId, chargeGroupId: group.id },
    select: { id: true, code: true, outletId: true },
  });

  // The seeded default (band start) is adoptable while no outlet owns it.
  const adoptable = existingSubgroups
    .filter((s) => s.code === `${band.from}RV` && s.outletId === null)
    .map((s) => s.code);

  const pick = nextOutletSubgroupCode(
    outletType,
    existingSubgroups.map((s) => s.code),
    adoptable
  );
  if (!pick) return null;

  const subgroupCode = "adopt" in pick ? pick.adopt : pick.create;
  const nn = subgroupCode.slice(0, 2);

  const subgroup =
    "adopt" in pick
      ? await client.chargeSubgroup.update({
          where: { id: existingSubgroups.find((s) => s.code === pick.adopt)!.id },
          data: { name: outletName, outletId },
        })
      : await client.chargeSubgroup.create({
          data: {
            enterpriseId,
            chargeGroupId: group.id,
            code: subgroupCode,
            name: outletName,
            isSystem: false,
            sortOrder: Number(nn),
            outletId,
          },
        });

  // Template posting codes: nn01, nn02... — created only where the number is still
  // free (an adopted default already carries its seeded codes), each wired to the
  // global Service Charge + GST generates like any other revenue code, and linked to
  // the outlet so its picker starts populated.
  const templates = OUTLET_CODE_TEMPLATES[outletType] ?? [];
  let codesCreated = 0;
  for (const t of templates) {
    const code = `${nn}${t.suffix}`;
    let row = await client.chargeCode.findUnique({
      where: { enterpriseId_code: { enterpriseId, code } },
    });
    if (!row) {
      row = await client.chargeCode.create({
        data: {
          enterpriseId,
          code,
          description: t.description,
          chargeSubgroupId: subgroup.id,
          postingType: "CHARGE",
          isSystem: false,
          isActive: true,
          useDefaultTax: true,
        },
      });
      codesCreated += 1;

      for (const gen of generatesForTreatment(code, "FULL")) {
        const target = await client.chargeCode.findUnique({
          where: { enterpriseId_code: { enterpriseId, code: gen.generatedCode } },
        });
        if (!target) continue;
        await client.chargeCodeGenerate.create({
          data: {
            enterpriseId,
            generatorCodeId: row.id,
            generatedCodeId: target.id,
            method: gen.method,
            value: gen.value,
            calculateOn: gen.calculateOn,
            sortOrder: gen.sortOrder,
          },
        });
      }
    }

    const linked = await client.outletChargeCode.findUnique({
      where: { outletId_chargeCodeId: { outletId, chargeCodeId: row.id } },
    });
    if (!linked) {
      await client.outletChargeCode.create({ data: { outletId, chargeCodeId: row.id } });
    }
  }

  return { subgroupCode, adopted: "adopt" in pick, codesCreated };
}
