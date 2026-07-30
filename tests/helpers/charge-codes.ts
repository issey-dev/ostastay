import { prisma } from "@/lib/db";
import { ensureChargeTree } from "@/lib/posting/ensure-charge-tree";

// Test helper for charge codes.
//
// `ChargeCode.chargeSubgroupId` is required — classification is the whole point of the
// hierarchy, and the free-text `category` column it replaced is gone. Tests used to
// create bare codes with just a code and description; they now need a subgroup, and
// nearly all of them only care that the code EXISTS, not where it sits.
//
// So: seed the enterprise's canonical chart once, then hand back codes from it. That
// also means a test exercises the same chart the app actually ships, rather than a
// hand-built stub that can drift from it.

const seeded = new Set<string>();

/** Idempotent per enterprise, and cheap after the first call in a test file. */
export async function ensureChart(enterpriseId: string): Promise<void> {
  if (seeded.has(enterpriseId)) return;
  await ensureChargeTree(prisma, enterpriseId);
  seeded.add(enterpriseId);
}

/**
 * A charge code from the enterprise's canonical chart, seeding the chart if needed.
 * `code` is a code from STANDARD_CHARGE_CODES — "1000", "8500", "2001", "2901"…
 */
export async function chargeCode(enterpriseId: string, code: string) {
  await ensureChart(enterpriseId);
  return prisma.chargeCode.findUniqueOrThrow({
    where: { enterpriseId_code: { enterpriseId, code } },
  });
}

/**
 * The charge code a test wants, created if the standard chart doesn't already have it.
 *
 * UPSERT, not create: seeding the chart means codes like ROOM, GTX and FBFOOD already
 * exist, and a fixture asking for one of those wants THAT code, not a duplicate — the
 * unique key would reject it anyway. A fixture asking for something the chart has no
 * opinion about (its own tax profile, a second accommodation code, an inactive one) gets
 * it created under `subgroupCode`, defaulting to Miscellaneous.
 *
 * On an existing code the caller's extra fields are still applied, so a test that wants
 * ROOM with a custom tax profile gets exactly that.
 */
export async function customChargeCode(
  enterpriseId: string,
  data: { code: string; description?: string; subgroupCode?: string } & Record<string, unknown>
) {
  await ensureChart(enterpriseId);
  const { code, description, subgroupCode, ...rest } = data;
  const subgroup = await prisma.chargeSubgroup.findUniqueOrThrow({
    where: { enterpriseId_code: { enterpriseId, code: subgroupCode ?? "60RV" } },
  });
  return prisma.chargeCode.upsert({
    where: { enterpriseId_code: { enterpriseId, code } },
    update: { ...(description ? { description } : {}), ...rest },
    create: {
      enterpriseId,
      code,
      description: description ?? code,
      chargeSubgroupId: subgroup.id,
      ...rest,
    },
  });
}

/** The subgroup id for a code from the canonical chart — for a direct prisma create. */
export async function subgroupId(enterpriseId: string, subgroupCode: string): Promise<string> {
  await ensureChart(enterpriseId);
  const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
    where: { enterpriseId_code: { enterpriseId, code: subgroupCode } },
  });
  return sub.id;
}
