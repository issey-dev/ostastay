import { prisma } from "@/lib/db";
import { ensureChargeTree } from "@/lib/posting/ensure-charge-tree";

// Test helper for charge codes.
//
// `ChargeCode.chargeSubgroupId` is required — classification is the whole point of the
// hierarchy, and the free-text `category` column it replaced is gone. Tests used to
// create bare codes with just a code and description; they now need a subgroup, and
// nearly all of them only care that the code EXISTS, not where it sits.
//
// So: seed the property's canonical chart once, then hand back codes from it. That also
// means a test exercises the same chart the app actually ships, rather than a hand-built
// stub that can drift from it.
//
// Per PROPERTY since 2026-09-23 — every property keeps its own chart. The first argument
// is `{ propertyId }` (not a bare string) so a test that still passes an enterprise id
// fails to compile instead of silently finding nothing.

type Scope = { propertyId: string };

const seeded = new Set<string>();

/** Idempotent per property, and cheap after the first call in a test file. */
export async function ensureChart({ propertyId }: Scope): Promise<void> {
  if (seeded.has(propertyId)) return;
  await ensureChargeTree(prisma, { propertyId }, undefined, { demo: true });
  seeded.add(propertyId);
}

/**
 * A charge code from the property's canonical chart, seeding the chart if needed.
 * `code` is a code from STANDARD_CHARGE_CODES — "1000", "8500", "2001", "2901"…
 */
export async function chargeCode(scope: Scope, code: string) {
  await ensureChart(scope);
  return prisma.chargeCode.findUniqueOrThrow({
    where: { propertyId_code: { propertyId: scope.propertyId, code } },
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
  scope: Scope,
  data: { code: string; description?: string; subgroupCode?: string } & Record<string, unknown>
) {
  await ensureChart(scope);
  const { propertyId } = scope;
  const { code, description, subgroupCode, ...rest } = data;
  const [subgroup, property] = await Promise.all([
    prisma.chargeSubgroup.findUniqueOrThrow({
      where: { propertyId_code: { propertyId, code: subgroupCode ?? "60RV" } },
    }),
    prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { enterpriseId: true } }),
  ]);
  return prisma.chargeCode.upsert({
    where: { propertyId_code: { propertyId, code } },
    update: { ...(description ? { description } : {}), ...rest },
    create: {
      enterpriseId: property.enterpriseId,
      propertyId,
      code,
      description: description ?? code,
      chargeSubgroupId: subgroup.id,
      ...rest,
    },
  });
}

/** The subgroup id for a code from the canonical chart — for a direct prisma create. */
export async function subgroupId(scope: Scope, subgroupCode: string): Promise<string> {
  await ensureChart(scope);
  const sub = await prisma.chargeSubgroup.findUniqueOrThrow({
    where: { propertyId_code: { propertyId: scope.propertyId, code: subgroupCode } },
  });
  return sub.id;
}
