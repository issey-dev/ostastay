import { describe, it, expect } from "vitest";
import { checkHardDeleteGate, checkHardDeleteTarget, HARD_DELETE_FLAG } from "@/lib/reservations/hard-delete-gate";

// Deleting a reservation is the one action that destroys history instead of marking it.
// The UI offers no delete button at all; DELETE /api/reservations/[id] survives purely as
// internal cleanup and must be unreachable by ordinary use. These pin the three input
// gates — the fourth (financial history / live stay) is enforced at the call site.

const CONF = "DMH-000000000002";

const gate = (over: Partial<Parameters<typeof checkHardDeleteGate>[0]> = {}) =>
  checkHardDeleteGate({
    flag: "true",
    isInternal: true,
    confirmationNo: CONF,
    suppliedConfirmation: CONF,
    ...over,
  });

describe("Hard-delete gate — kill switch", () => {
  it("refuses when the flag is unset, which is every normal deployment", () => {
    const r = gate({ flag: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toContain(HARD_DELETE_FLAG);
    }
  });

  it("refuses near-miss flag values rather than coercing them", () => {
    for (const flag of ["", "false", "1", "TRUE", "yes", " true"]) {
      expect(gate({ flag }).ok).toBe(false);
    }
  });

  it("keeps the endpoint dead for internal staff too until it is turned on", () => {
    const r = gate({ flag: undefined, isInternal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(HARD_DELETE_FLAG);
  });
});

describe("Hard-delete gate — internal only", () => {
  it("refuses a tenant user even with the flag on and a correct confirmation", () => {
    const r = gate({ isInternal: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toContain("Cancel the reservation instead");
    }
  });

  // Identity is checked before the kill switch specifically so this holds in the
  // real deployment shape, where the flag is unset. Checking the flag first would
  // answer every tenant's DELETE by naming an internal env var.
  it("never names the internal escape hatch to a tenant, flag on or off", () => {
    for (const flag of [undefined, "true", "false"]) {
      const r = gate({ isInternal: false, flag });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain(HARD_DELETE_FLAG);
    }
  });
});

describe("Hard-delete gate — proof of intent", () => {
  it("refuses a call with no body / no confirmation", () => {
    for (const supplied of [undefined, null, "", {}, 42, []]) {
      const r = gate({ suppliedConfirmation: supplied });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it("refuses a confirmation number belonging to a different booking", () => {
    expect(gate({ suppliedConfirmation: "DMH-000000000001" }).ok).toBe(false);
  });

  it("accepts an exact match, tolerating surrounding whitespace only", () => {
    expect(gate({ suppliedConfirmation: CONF }).ok).toBe(true);
    expect(gate({ suppliedConfirmation: `  ${CONF}  ` }).ok).toBe(true);
  });

  it("stays case-sensitive — no fuzzy matching on the one proof of intent", () => {
    expect(gate({ suppliedConfirmation: CONF.toLowerCase() }).ok).toBe(false);
  });

  it("names the expected confirmation number so an operator can retry correctly", () => {
    const r = gate({ suppliedConfirmation: "wrong" });
    if (!r.ok) expect(r.error).toContain(CONF);
  });
});

describe("Hard-delete gate — the only passing combination", () => {
  it("requires all three to line up at once", () => {
    expect(gate().ok).toBe(true);
    // Drop any single one and it closes.
    expect(gate({ flag: "false" }).ok).toBe(false);
    expect(gate({ isInternal: false }).ok).toBe(false);
    expect(gate({ suppliedConfirmation: "nope" }).ok).toBe(false);
  });
});

// Gate 4 — independent of who is asking. Previously enforced inline in the route and
// covered end-to-end by alpha-hardening.test.ts; moved here so it is pinned directly
// now that reaching the route at all requires internal + support-mode credentials.
describe("Hard-delete target — money is never erasable", () => {
  it("refuses a reservation with any posted charge or payment", () => {
    const r = checkHardDeleteTarget({ status: "RESERVED", hasFinancialHistory: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/cannot be deleted/i);
      expect(r.error).toMatch(/cancel it instead/i);
    }
  });

  it("refuses a live or departed stay even with a clean folio", () => {
    for (const status of ["IN_HOUSE", "CHECKED_OUT"]) {
      const r = checkHardDeleteTarget({ status, hasFinancialHistory: false });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it("allows a financially clean booking that never happened", () => {
    for (const status of ["RESERVED", "CANCELLED", "NO_SHOW"]) {
      expect(checkHardDeleteTarget({ status, hasFinancialHistory: false }).ok).toBe(true);
    }
  });

  it("puts money ahead of status — a dirty in-house stay reports the financial reason", () => {
    const r = checkHardDeleteTarget({ status: "IN_HOUSE", hasFinancialHistory: true });
    if (!r.ok) expect(r.error).toMatch(/posted charges or payments/i);
  });
});
