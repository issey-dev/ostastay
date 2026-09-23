import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import type { ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";

// What a Booking API key may be used for (BOOKING_API_ADDONS_PLAN.md B-1). One key serves a
// brand website's rooms, excursions and spa; each is a scope ticked in the Hub.
//
// An add-on scope is only a grant of intent. Three things must ALL hold, checked live on
// every request, before a module answers:
//   1. the key carries the scope,
//   2. the enterprise has the add-on enabled right now (EnterpriseAddonAccess — Osta can
//      switch it off, and the API must stop the same minute),
//   3. the property sells the module online (ActivityOnlineSettings.enabled).
// Rooms has no add-on; its equivalent of (3) is WebsitePropertySettings (rate plan chosen,
// booking switched on), reported through the property's existing `booking` block.

export const API_SCOPES = ["ROOMS", "EXCURSIONS", "SPA"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export type ActivityModule = "EXCURSIONS" | "SPA";
export const ACTIVITY_MODULES: readonly ActivityModule[] = ["EXCURSIONS", "SPA"];

export const SCOPE_LABELS: Record<ApiScope, string> = { ROOMS: "Rooms", EXCURSIONS: "Excursions", SPA: "Spa" };

/** Thrown by a route when the key lacks the scope it needs; websiteRoute answers 403. */
export class ScopeError extends Error {
  constructor(public readonly scope: ApiScope) {
    super(`This API key is not enabled for ${SCOPE_LABELS[scope]}. Ask the property to add it to the key in the Hub.`);
    this.name = "ScopeError";
  }
}

export function keyHasScope(key: Pick<ResolvedWebsiteKey, "scopes">, scope: ApiScope): boolean {
  return key.scopes.includes(scope);
}

export function requireScope(key: Pick<ResolvedWebsiteKey, "scopes">, scope: ApiScope): void {
  if (!keyHasScope(key, scope)) throw new ScopeError(scope);
}

/** Add-on modules the enterprise currently has switched on. */
export async function enabledActivityModules(enterpriseId: string): Promise<Set<ActivityModule>> {
  const rows = await prisma.enterpriseAddonAccess.findMany({
    where: { enterpriseId, enabled: true, module: { in: [...ACTIVITY_MODULES] } },
    select: { module: true },
  });
  return new Set(rows.map((r) => r.module as ActivityModule));
}

/**
 * Validate the scopes an administrator chose for a key. At least one; only known values;
 * an add-on scope only while the enterprise has that add-on — offering a scope for a
 * module the customer has not bought would be a promise the API then refuses to keep.
 */
export async function normalizeScopes(enterpriseId: string, input: string[]): Promise<ApiScope[]> {
  const unique = [...new Set(input)];
  if (unique.length === 0) throw new ForbiddenError("Choose at least one thing this key may use");
  for (const s of unique) {
    if (!API_SCOPES.includes(s as ApiScope)) throw new ForbiddenError(`Unknown scope "${s}"`);
  }
  const addons = await enabledActivityModules(enterpriseId);
  for (const s of unique) {
    if ((s === "EXCURSIONS" || s === "SPA") && !addons.has(s)) {
      throw new ForbiddenError(`${SCOPE_LABELS[s]} is not enabled for this enterprise`);
    }
  }
  return API_SCOPES.filter((s) => unique.includes(s));
}

export type ModuleStatusCode =
  | "SCOPE_NOT_GRANTED"
  | "ADDON_NOT_ENABLED"
  | "NOT_SOLD_ONLINE"
  | "NO_OUTLET"
  | "NOTHING_PUBLISHED"
  | "BOOKING_DISABLED";

export type ModuleStatus = {
  /** True when the site may book this module at this property right now. */
  enabled: boolean;
  /** Stable reason code when enabled is false. */
  code: ModuleStatusCode | null;
  /** Human-readable reason when enabled is false. */
  reason: string | null;
};

const REASONS: Record<ModuleStatusCode, string> = {
  SCOPE_NOT_GRANTED: "This API key is not enabled for this module.",
  ADDON_NOT_ENABLED: "This module is not available for this property.",
  NOT_SOLD_ONLINE: "The property does not sell this online.",
  NO_OUTLET: "The property has not finished setting this up for online sale.",
  NOTHING_PUBLISHED: "The property has not published anything to sell online yet.",
  BOOKING_DISABLED: "Online booking is not available for this property.",
};

export function moduleStatus(code: ModuleStatusCode | null): ModuleStatus {
  return code ? { enabled: false, code, reason: REASONS[code] } : { enabled: true, code: null, reason: null };
}

/**
 * Whether an activity module can be booked through this key at this property, and if not,
 * the first reason why — in the order a property administrator would fix them. The public
 * reasons are deliberately generic: a guest-facing site must not learn commercial detail
 * (which add-ons an enterprise pays for) beyond "not available".
 */
export async function activityModuleStatus(
  key: Pick<ResolvedWebsiteKey, "scopes" | "enterpriseId">,
  propertyId: string,
  module: ActivityModule
): Promise<ModuleStatus> {
  if (!keyHasScope(key, module)) return moduleStatus("SCOPE_NOT_GRANTED");
  const [addon, settings, enterpriseSettings, published] = await Promise.all([
    prisma.enterpriseAddonAccess.findUnique({ where: { enterpriseId_module: { enterpriseId: key.enterpriseId, module } } }),
    prisma.activityOnlineSettings.findUnique({ where: { propertyId_module: { propertyId, module } } }),
    prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: key.enterpriseId },
      select: { excursionOutletId: true, spaOutletId: true },
    }),
    module === "EXCURSIONS"
      ? prisma.excursionType.count({ where: { propertyId, isActive: true, publishOnline: true } })
      : prisma.spaTreatment.count({ where: { propertyId, isActive: true, publishOnline: true, allowWalkIn: true } }),
  ]);
  if (!addon?.enabled) return moduleStatus("ADDON_NOT_ENABLED");
  if (!settings?.enabled) return moduleStatus("NOT_SOLD_ONLINE");
  // Every online booking posts a charge, and posting needs the module's hub-wide outlet
  // (owner rule 2026-07-30).
  const outletId = module === "EXCURSIONS" ? enterpriseSettings?.excursionOutletId : enterpriseSettings?.spaOutletId;
  if (!outletId) return moduleStatus("NO_OUTLET");
  if (published === 0) return moduleStatus("NOTHING_PUBLISHED");
  return moduleStatus(null);
}
