import { describe, it, expect } from "vitest";
import { MODULES, MODULE_LABELS, HUB_MODULES, moduleScope } from "@/lib/modules";
import { MODULES as SEED_MODULES, SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS } from "../../prisma/rbac-seed-data";

// The module registry, and the role defaults built from it.
//
// prisma/rbac-seed-data.ts used to keep its own hand-synced copy of MODULES. Drift there
// was invisible in the worst way: backfillMissingRolePermissions() self-heals EXISTING
// roles on their next request, so a missing entry only showed up when a brand-new
// enterprise was onboarded and its seeded roles silently lacked a default. The copy is
// gone (2026-08-05) — these tests hold that line.

describe("One module list", () => {
  it("is literally the same array, not a copy that happens to match", () => {
    // Identity, not deep equality: a re-declared list could pass toEqual today and drift
    // tomorrow, which is exactly the failure this dedupe removes.
    expect(SEED_MODULES).toBe(MODULES);
  });

  it("has no duplicate entries", () => {
    expect(new Set(MODULES).size).toBe(MODULES.length);
  });

  it("gives every module a label", () => {
    for (const m of MODULES) {
      expect(MODULE_LABELS[m], `${m} has no label`).toBeTruthy();
    }
  });

  it("has no label for a module that no longer exists", () => {
    for (const key of Object.keys(MODULE_LABELS)) {
      expect(MODULES as readonly string[]).toContain(key);
    }
  });

  it("scopes every Hub module to HUB and everything else to PROPERTY", () => {
    for (const m of MODULES) {
      const expected = (HUB_MODULES as readonly string[]).includes(m) ? "HUB" : "PROPERTY";
      expect(moduleScope(m)).toBe(expected);
    }
  });

  it("only lists real modules as Hub modules", () => {
    for (const m of HUB_MODULES) {
      expect(MODULES as readonly string[]).toContain(m);
    }
  });
});

describe("Seeded role defaults cover the whole registry", () => {
  const allDefs = { ...SYSTEM_ROLE_DEFS, ...SUPPORT_ROLE_DEFS };

  it("gives every role an explicit entry for every module", () => {
    // A missing entry is what the old drift produced: a newly seeded enterprise whose
    // role had no row at all for a module, rather than an explicit denial.
    for (const [roleName, matrix] of Object.entries(allDefs)) {
      for (const m of MODULES) {
        expect(matrix[m], `${roleName} has no entry for ${m}`).toBeDefined();
      }
    }
  });

  it("keeps Admin and Manager at full access across every module", () => {
    for (const roleName of ["Admin", "Manager"]) {
      for (const m of MODULES) {
        expect(SYSTEM_ROLE_DEFS[roleName][m], `${roleName}/${m}`).toEqual({
          canView: true, canCreate: true, canUpdate: true, canDelete: true,
        });
      }
    }
  });

  it("keeps staff administration away from operational roles", () => {
    // USERS is a Hub module: front-desk and housekeeping staff have no business editing
    // who exists or what they may do.
    for (const roleName of ["Front Desk", "Housekeeping", "Maintenance", "Cashier", "Reservations"]) {
      expect(SYSTEM_ROLE_DEFS[roleName].USERS.canView, `${roleName} can see USERS`).toBe(false);
      expect(SYSTEM_ROLE_DEFS[roleName].USERS.canUpdate, `${roleName} can edit USERS`).toBe(false);
    }
  });

  it("keeps OTA credentials away from operational roles too", () => {
    for (const roleName of ["Front Desk", "Housekeeping", "Maintenance", "Cashier", "Reservations"]) {
      expect(SYSTEM_ROLE_DEFS[roleName].INTEGRATIONS.canView, `${roleName} can see INTEGRATIONS`).toBe(false);
    }
  });
});
