import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";

// SaaS licensing (owner decisions, 2026-07-31 — see .agents/docs/TODO.md "Osta platform
// level"): no tier pricing — the license price is manual, and the counted attributes
// (properties / room types / rooms / channels) are CAPS. Room-type/room/channel caps are
// per property (PropertyLicenseAllowance); properties are capped per enterprise
// (EnterpriseLicense.maxProperties, enforced in /api/properties since Phase 1). Pseudo
// (PM) room types and their rooms never count toward a cap, and PM room types are
// refused channel mapping outright.

export type LicenseState = "ACTIVE" | "GRACE" | "EXPIRED" | "REVOKED" | "UNLICENSED";

export type LicenseStatus = {
  state: LicenseState;
  // End of the grace window (expiresAt + graceDays); set when expiresAt is set.
  graceEndsAt: Date | null;
  license: Awaited<ReturnType<typeof prisma.enterpriseLicense.findUnique>>;
};

// Pure so it can be unit-tested without a DB. UNLICENSED (no row) is deliberately
// treated as valid-with-a-flag rather than a lockout: license rows are created lazily,
// and a missing row must never brick a tenant (same fail-open stance as the module
// gating scaffold). The Osta Licensing screen surfaces it loudly instead.
export function computeLicenseState(
  license: { status: string; expiresAt: Date | null; graceDays: number } | null,
  now: Date = new Date()
): { state: LicenseState; graceEndsAt: Date | null } {
  if (!license) return { state: "UNLICENSED", graceEndsAt: null };
  if (license.status === "REVOKED") return { state: "REVOKED", graceEndsAt: null };
  if (!license.expiresAt) return { state: "ACTIVE", graceEndsAt: null };
  const graceEndsAt = new Date(license.expiresAt.getTime() + license.graceDays * 24 * 60 * 60 * 1000);
  if (now <= license.expiresAt) return { state: "ACTIVE", graceEndsAt };
  if (now <= graceEndsAt) return { state: "GRACE", graceEndsAt };
  return { state: "EXPIRED", graceEndsAt };
}

export async function getLicenseStatus(enterpriseId: string): Promise<LicenseStatus> {
  const license = await prisma.enterpriseLicense.findUnique({ where: { enterpriseId } });
  return { ...computeLicenseState(license), license };
}

// True when users of this enterprise may sign in / keep working. GRACE still signs in
// (with a warning); EXPIRED and REVOKED do not.
export function isLicenseUsable(state: LicenseState): boolean {
  return state === "ACTIVE" || state === "GRACE" || state === "UNLICENSED";
}

// Counted usage for one property — what the caps compare against. Pseudo room types
// (and every room under them) are excluded by definition.
export async function getPropertyLicenseUsage(propertyId: string) {
  const [roomTypes, rooms, channelLinks] = await Promise.all([
    prisma.roomType.count({ where: { propertyId, isPseudo: false } }),
    prisma.room.count({ where: { roomType: { propertyId, isPseudo: false } } }),
    prisma.channelPropertyLink.count({ where: { propertyId } }),
  ]);
  return { roomTypes, rooms, channelLinks };
}

async function getAllowance(propertyId: string) {
  return prisma.propertyLicenseAllowance.findUnique({ where: { propertyId } });
}

// Each assert is called at the CREATE path of its attribute. A missing allowance row or
// a null cap means unlimited (allowances are opt-in, set by Osta per property); 0 means
// the attribute is disallowed entirely. Messages name the cap and who to contact — the
// same voice as the existing maxProperties rejection in /api/properties.
export async function assertRoomTypeCapacity(propertyId: string): Promise<void> {
  const allowance = await getAllowance(propertyId);
  if (allowance?.maxRoomTypes == null) return;
  const used = await prisma.roomType.count({ where: { propertyId, isPseudo: false } });
  if (used >= allowance.maxRoomTypes) {
    throw new ForbiddenError(
      `This property's license allows up to ${allowance.maxRoomTypes} room type${allowance.maxRoomTypes === 1 ? "" : "s"} (PM room types excluded). Contact Osta to increase this limit.`
    );
  }
}

export async function assertRoomCapacity(propertyId: string): Promise<void> {
  const allowance = await getAllowance(propertyId);
  if (allowance?.maxRooms == null) return;
  const used = await prisma.room.count({ where: { roomType: { propertyId, isPseudo: false } } });
  if (used >= allowance.maxRooms) {
    throw new ForbiddenError(
      `This property's license allows up to ${allowance.maxRooms} room${allowance.maxRooms === 1 ? "" : "s"} (PM rooms excluded). Contact Osta to increase this limit.`
    );
  }
}

export async function assertChannelCapacity(propertyId: string): Promise<void> {
  const allowance = await getAllowance(propertyId);
  if (allowance?.maxChannels == null) return;
  const used = await prisma.channelPropertyLink.count({ where: { propertyId } });
  if (used >= allowance.maxChannels) {
    throw new ForbiddenError(
      allowance.maxChannels === 0
        ? "This property's license does not include channel connections. Contact Osta to enable them."
        : `This property's license allows up to ${allowance.maxChannels} channel connection${allowance.maxChannels === 1 ? "" : "s"}. Contact Osta to increase this limit.`
    );
  }
}
