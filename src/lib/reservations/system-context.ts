import type { AuthContext } from "@/lib/scope";

/**
 * A synthetic AuthContext for system-driven reservation paths that have no logged-in
 * user behind them: a channel-manager booking being converted
 * (src/lib/channels/inbound/convert.ts) or a booking arriving through a property's own
 * brand website (src/lib/website-api/booking.ts).
 *
 * createReservation's assertPropertyAccess() and logActivity() calls need SOMETHING to
 * run against; ENTERPRISE scope with no property pin is the same shape a real
 * enterprise-level admin has, and logActivity tolerates a userId that resolves to no real
 * User row (see src/lib/activity-log.ts) by just recording null name/email.
 *
 * Extracted from convert.ts on 2026-09-06 when the Website API became the second caller —
 * one definition, so the two system paths can never drift in what they claim to be.
 */
export function systemContext(enterpriseId: string, userId: string = "system"): AuthContext {
  return {
    userId,
    enterpriseId,
    homeEnterpriseId: enterpriseId,
    scope: "ENTERPRISE",
    sessionPropertyId: null,
    propertyId: null,
    roleIds: [],
    permissions: new Map(),
    // Never passes through requireSession, so there is no Session row behind it.
    sessionId: "system",
    sessionJti: "system",
    isInternal: false,
    isActingAsSupport: false,
    licensedModules: new Set(),
  };
}
