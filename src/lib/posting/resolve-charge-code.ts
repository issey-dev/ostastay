import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SYSTEM_CHARGE_CODES, type ChargeCodeRole } from "@/lib/posting/charge-tree";

// Replaces every `findFirst({ where: { code: "ROOM" } })` / `code: "GTX"` in the app
// (CHARGE_CODE_PLAN.md §1.2) with a role lookup. A role resolves in this order:
//
//   1. the enterprise's own pointer in EnterpriseSettings (what the property picked in
//      Controls > Cashiering > Posting Defaults), then
//   2. the system-seeded code for that role (`ROOM` / `GTX` / `COMM`), matched by the
//      isSystem flag the seeder sets — not by the string alone, and
//   3. the bare code string, as a last resort for an enterprise seeded before the
//      hierarchy existed and never backfilled.
//
// Callers never pass a literal code string. That is the whole point: a missing lookup
// silently drops revenue attribution, so there is exactly one path.

type Client = Prisma.TransactionClient | typeof prisma;

const TAX_INCLUDE = { taxProfile: { include: { rates: true } } } as const;

const SETTINGS_POINTER: Record<ChargeCodeRole, "defaultAccommodationChargeCodeId" | "defaultGreenTaxChargeCodeId" | "commissionChargeCodeId"> = {
  ACCOMMODATION: "defaultAccommodationChargeCodeId",
  GREEN_TAX: "defaultGreenTaxChargeCodeId",
  COMMISSION: "commissionChargeCodeId",
};

const SEEDED_CODE: Record<ChargeCodeRole, string> = Object.fromEntries(
  SYSTEM_CHARGE_CODES.map((c) => [c.role, c.code])
) as Record<ChargeCodeRole, string>;

export type ResolvedChargeCode = Prisma.ChargeCodeGetPayload<{
  include: { taxProfile: { include: { rates: true } } };
}>;

/**
 * Resolve the charge code that plays `role` for this enterprise, or null when the
 * enterprise genuinely has none (callers decide whether that's fatal — a missing
 * ACCOMMODATION code blocks Night Audit, a missing GREEN_TAX code only matters when
 * Green Tax is switched on).
 *
 * `settings` may be passed when the caller already loaded EnterpriseSettings, to avoid
 * a second read on the hot Night Audit path.
 */
export async function resolveChargeCode(
  enterpriseId: string,
  role: ChargeCodeRole,
  opts?: {
    client?: Client;
    settings?: { defaultAccommodationChargeCodeId?: string | null; defaultGreenTaxChargeCodeId?: string | null; commissionChargeCodeId?: string | null } | null;
  }
): Promise<ResolvedChargeCode | null> {
  const db = opts?.client ?? prisma;

  const settings =
    opts?.settings !== undefined
      ? opts.settings
      : await db.enterpriseSettings.findUnique({ where: { enterpriseId } });

  const pointerId = settings?.[SETTINGS_POINTER[role]] ?? null;
  if (pointerId) {
    // A dangling pointer (code deleted since it was chosen) falls through to the
    // seeded code rather than failing the posting outright.
    const byPointer = await db.chargeCode.findFirst({
      where: { id: pointerId, enterpriseId, isActive: true },
      include: TAX_INCLUDE,
    });
    if (byPointer) return byPointer;
  }

  const seededCode = SEEDED_CODE[role];
  const bySystemFlag = await db.chargeCode.findFirst({
    where: { enterpriseId, code: seededCode, isSystem: true, isActive: true },
    include: TAX_INCLUDE,
  });
  if (bySystemFlag) return bySystemFlag;

  return db.chargeCode.findFirst({
    where: { enterpriseId, code: seededCode },
    include: TAX_INCLUDE,
  });
}

/**
 * Same as resolveChargeCode but throws a message the API routes surface verbatim.
 * Use where the absence of the code is a hard stop (the nightly room charge).
 */
export async function requireChargeCode(
  enterpriseId: string,
  role: ChargeCodeRole,
  opts?: Parameters<typeof resolveChargeCode>[2]
): Promise<ResolvedChargeCode> {
  const code = await resolveChargeCode(enterpriseId, role, opts);
  if (!code) {
    throw new MissingChargeCodeError(role);
  }
  return code;
}

export class MissingChargeCodeError extends Error {
  constructor(public readonly role: ChargeCodeRole) {
    super(
      role === "ACCOMMODATION"
        ? "No accommodation charge code configured. Set a default in Controls > Cashiering > Posting Defaults."
        : role === "GREEN_TAX"
          ? "No Green Tax charge code configured. Set one in Controls > Cashiering > Posting Defaults."
          : "No commission charge code configured. Set one in Controls > Cashiering > Posting Defaults."
    );
  }
}
