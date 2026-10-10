// The relations every charge-code read loads (tax profile with its current rate, the
// subgroup and group, and the codes it generates). It lives here, not in the route file:
// Next only allows HTTP-method handlers and route config as exports of a route.ts, so
// exporting this constant from /api/charge-codes/route.ts failed the production build's
// type check (found while verifying 8.7.0).
export const CHARGE_CODE_INCLUDE = {
  taxProfile: { include: { rates: { orderBy: { effectiveFrom: "desc" as const }, take: 1 } } },
  chargeSubgroup: { include: { chargeGroup: true } },
  generatesFrom: { include: { generatedCode: { select: { id: true, code: true, description: true } } }, orderBy: { sortOrder: "asc" as const } },
} as const;
