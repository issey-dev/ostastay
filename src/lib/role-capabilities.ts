import { isCapabilityKey, roleCapabilities, type CapabilityKey } from "@/lib/capabilities";

// Request-body helpers for the roles API (Phase 0b). Kept apart from capabilities.ts so the
// client-safe registry stays free of request parsing.

/** `{ "reservations.overbook": false, … }` → rows; unknown keys are dropped, never stored. */
export function capabilityOverridesFromBody(raw: unknown): { capability: CapabilityKey; granted: boolean }[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([k, v]) => isCapabilityKey(k) && typeof v === "boolean")
    .map(([k, v]) => ({ capability: k as CapabilityKey, granted: v as boolean }));
}

export function effectiveRoleCapabilities(
  permissions: { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[],
  overrides: { capability: string; granted: boolean }[]
): Set<CapabilityKey> {
  return roleCapabilities(permissions, overrides);
}
