import { describe, it, expect } from "vitest";
import { decidePropertyGate } from "@/lib/properties/onboarding-gate";

// The rule behind the dashboard's onboarding gate (app-owner requirement, 2026-08-03):
// a session with no ACTIVE property must be told what is going on instead of rendering
// pages that wait forever on a current property. Approval is required for EVERY
// tenant-created property, including the first.
describe("Property onboarding gate", () => {
  const base = { isActingAsSupport: false, scope: "ENTERPRISE" as const, canCreateControls: true };

  it("lets a session through as soon as ONE property is active", () => {
    expect(decidePropertyGate({ ...base, properties: [{ status: "ACTIVE" }] })).toEqual({ blocked: false });
    // A pending second property does not re-block an enterprise that is already running.
    expect(
      decidePropertyGate({ ...base, properties: [{ status: "ACTIVE" }, { status: "PENDING" }] })
    ).toEqual({ blocked: false });
  });

  it("blocks with the create step when nothing exists yet", () => {
    expect(decidePropertyGate({ ...base, properties: [] })).toEqual({ blocked: true, state: "NONE" });
  });

  it("blocks with the waiting step while every property awaits approval", () => {
    // The whole point of the app-owner's decision: the FIRST property is not usable
    // until Osta approves it, so creating it does not unblock the dashboard.
    expect(decidePropertyGate({ ...base, properties: [{ status: "PENDING" }] })).toEqual({
      blocked: true,
      state: "AWAITING",
    });
    // Rejected is the same blocked state — the screen offers a resubmit rather than a
    // second "create" that would pile up duplicates.
    expect(decidePropertyGate({ ...base, properties: [{ status: "REJECTED" }] })).toEqual({
      blocked: true,
      state: "AWAITING",
    });
    expect(
      decidePropertyGate({ ...base, properties: [{ status: "PENDING" }, { status: "REJECTED" }] })
    ).toEqual({ blocked: true, state: "AWAITING" });
  });

  it("tells users who cannot fix it themselves to ask their administrator", () => {
    // A property-scoped user has no route to creating a property...
    expect(
      decidePropertyGate({ ...base, scope: "PROPERTY", properties: [] })
    ).toEqual({ blocked: true, state: "NO_RIGHTS" });
    // ...and neither does an enterprise user without CONTROLS create. Offering them a
    // "create property" button would be a dead end that 403s.
    expect(
      decidePropertyGate({ ...base, canCreateControls: false, properties: [] })
    ).toEqual({ blocked: true, state: "NO_RIGHTS" });
  });

  it("never blocks an Osta support session", () => {
    // Same carve-out assertPropertyAccess() makes: support may need to see a pending
    // property's setup in order to help with it.
    expect(
      decidePropertyGate({ ...base, isActingAsSupport: true, properties: [] })
    ).toEqual({ blocked: false });
    expect(
      decidePropertyGate({ ...base, isActingAsSupport: true, properties: [{ status: "PENDING" }] })
    ).toEqual({ blocked: false });
  });
});
