// Should the dashboard be replaced by the property-onboarding gate, and in which state?
//
// Pure so it can be tested directly and so the layout stays a thin caller — the rule it
// encodes ("no ACTIVE property means the app has nothing to show") is a business rule,
// not a rendering detail. See src/components/onboarding/property-onboarding-gate.tsx.
//
// NOT a security boundary: assertPropertyAccess() independently refuses every non-ACTIVE
// property on every API route. This decides what the user SEES instead of a dashboard
// that would sit loading forever.

export type GateDecision =
  | { blocked: false }
  | { blocked: true; state: "NONE" | "AWAITING" | "NO_RIGHTS" };

export function decidePropertyGate(input: {
  /** Support sessions see the real dashboard — Osta may need to inspect a pending property. */
  isActingAsSupport: boolean;
  /** Properties visible to this session (already scope-filtered), with their statuses. */
  properties: { status: string }[];
  scope: "ENTERPRISE" | "PROPERTY";
  canCreateControls: boolean;
}): GateDecision {
  if (input.isActingAsSupport) return { blocked: false };
  if (input.properties.some((p) => p.status === "ACTIVE")) return { blocked: false };

  // Something exists but none of it is usable — waiting on Osta (or rejected).
  if (input.properties.length > 0) return { blocked: true, state: "AWAITING" };

  // Nothing exists. Only an enterprise-scoped user who may create properties can fix
  // that; for anyone else an "add a property" button would be a dead end.
  return input.scope === "ENTERPRISE" && input.canCreateControls
    ? { blocked: true, state: "NONE" }
    : { blocked: true, state: "NO_RIGHTS" };
}
