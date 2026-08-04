import { describe, it, expect } from "vitest";
import {
  mergeRolePermissions,
  orPermissions,
  permissionAllows,
  anyModuleViewable,
  NO_ACCESS,
  type RolePermissionLike,
} from "@/lib/role-permissions";
import { MODULES } from "@/lib/modules";

// The merge that decides what every request in the app may do, once a user can hold more
// than one role (2026-08-04, owner). Access is the UNION of every held role's grants, per
// module per action.
//
// This file is deliberately exhaustive: a bug here either over-grants (a cashier deleting
// reservations) or locks every tenant out. It is pure, so there is no excuse not to be.

const perm = (
  module: string,
  bits: Partial<Omit<RolePermissionLike, "module">> = {}
): RolePermissionLike => ({
  module,
  canView: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  ...bits,
});

const role = (...permissions: RolePermissionLike[]) => ({ permissions });

const FULL = { canView: true, canCreate: true, canUpdate: true, canDelete: true };

describe("orPermissions", () => {
  it("unions each action independently", () => {
    expect(
      orPermissions(
        { canView: true, canCreate: false, canUpdate: false, canDelete: false },
        { canView: false, canCreate: false, canUpdate: false, canDelete: true }
      )
    ).toEqual({ canView: true, canCreate: false, canUpdate: false, canDelete: true });
  });

  it("is not 'the stronger row wins' — a view-only and a delete-only combine to both", () => {
    // These differ, and conflating them is the obvious way to get this wrong: the result
    // is view+delete, not the row that looks more permissive overall.
    const viewOnly = { canView: true, canCreate: false, canUpdate: false, canDelete: false };
    const deleteOnly = { canView: false, canCreate: false, canUpdate: false, canDelete: true };
    const merged = orPermissions(viewOnly, deleteOnly);
    expect(merged).not.toEqual(viewOnly);
    expect(merged).not.toEqual(deleteOnly);
    expect(merged.canView && merged.canDelete).toBe(true);
  });

  it("never invents a grant neither side had", () => {
    expect(orPermissions(NO_ACCESS, NO_ACCESS)).toEqual(NO_ACCESS);
  });
});

describe("mergeRolePermissions — the owner's example", () => {
  // "Role 1 has permission 1 and 2, Role 2 has permission 2 and 3; a user given both
  // gets 1, 2 and 3."
  it("unions disjoint and overlapping grants across roles", () => {
    const r1 = role(
      perm("RESERVATIONS", { canView: true }),
      perm("CASHIERING", { canView: true })
    );
    const r2 = role(
      perm("CASHIERING", { canView: true }),
      perm("HOUSEKEEPING", { canView: true })
    );
    const m = mergeRolePermissions([r1, r2]);
    expect(m.get("RESERVATIONS")!.canView).toBe(true);
    expect(m.get("CASHIERING")!.canView).toBe(true);
    expect(m.get("HOUSEKEEPING")!.canView).toBe(true);
  });

  it("combines different ACTIONS on the same module from different roles", () => {
    const viewer = role(perm("REVENUE", { canView: true }));
    const editor = role(perm("REVENUE", { canUpdate: true }));
    const m = mergeRolePermissions([viewer, editor]);
    expect(m.get("REVENUE")).toEqual({
      canView: true, canCreate: false, canUpdate: true, canDelete: false,
    });
  });
});

describe("mergeRolePermissions — denials", () => {
  it("returns every module, explicitly denied, for a user with no roles", () => {
    // Never an empty map: a caller must not be able to read 'module absent' as anything
    // other than denied.
    const m = mergeRolePermissions([]);
    expect(m.size).toBe(MODULES.length);
    for (const mod of MODULES) expect(m.get(mod)).toEqual(NO_ACCESS);
  });

  it("denies a module no role mentions", () => {
    const m = mergeRolePermissions([role(perm("RESERVATIONS", FULL))]);
    expect(m.get("NIGHT_AUDIT")).toEqual(NO_ACCESS);
  });

  it("a role granting view never silently confers delete", () => {
    const m = mergeRolePermissions([role(perm("PROFILES", { canView: true }))]);
    expect(m.get("PROFILES")!.canDelete).toBe(false);
    expect(m.get("PROFILES")!.canCreate).toBe(false);
    expect(m.get("PROFILES")!.canUpdate).toBe(false);
  });

  it("a role that grants nothing at all cannot widen another role", () => {
    const grants = role(perm("POS", { canView: true }));
    const empty = role();
    expect(mergeRolePermissions([grants, empty])).toEqual(mergeRolePermissions([grants]));
  });

  it("all-denied rows do not override a grant, whichever order they arrive in", () => {
    const grant = role(perm("DEBTORS", FULL));
    const deny = role(perm("DEBTORS", {}));
    expect(mergeRolePermissions([grant, deny]).get("DEBTORS")).toEqual(FULL);
    expect(mergeRolePermissions([deny, grant]).get("DEBTORS")).toEqual(FULL);
  });
});

describe("mergeRolePermissions — robustness", () => {
  it("ignores a stale row for a module the app no longer defines", () => {
    const m = mergeRolePermissions([role(perm("A_REMOVED_MODULE", FULL))]);
    expect(m.has("A_REMOVED_MODULE")).toBe(false);
    expect(m.size).toBe(MODULES.length);
  });

  it("is order-independent", () => {
    const a = role(perm("SPA", { canView: true }), perm("EXCURSIONS", { canCreate: true }));
    const b = role(perm("SPA", { canDelete: true }));
    expect(mergeRolePermissions([a, b])).toEqual(mergeRolePermissions([b, a]));
  });

  it("is idempotent — holding the same role twice changes nothing", () => {
    const r = role(perm("REPORTS", { canView: true, canUpdate: true }));
    expect(mergeRolePermissions([r, r])).toEqual(mergeRolePermissions([r]));
  });

  it("handles duplicate rows for one module inside a single role", () => {
    const r = role(perm("CONTROLS", { canView: true }), perm("CONTROLS", { canDelete: true }));
    expect(mergeRolePermissions([r]).get("CONTROLS")).toEqual({
      canView: true, canCreate: false, canUpdate: false, canDelete: true,
    });
  });

  it("does not mutate the caller's rows", () => {
    const row = perm("TAPE_CHART", { canView: true });
    const before = { ...row };
    mergeRolePermissions([role(row), role(perm("TAPE_CHART", { canDelete: true }))]);
    expect(row).toEqual(before);
  });

  it("scales to a full-access role without dropping a module", () => {
    const everything = role(...MODULES.map((m) => perm(m, FULL)));
    const merged = mergeRolePermissions([everything]);
    for (const mod of MODULES) expect(merged.get(mod)).toEqual(FULL);
  });
});

describe("permissionAllows", () => {
  it("maps each action to its own column", () => {
    const row = { canView: true, canCreate: false, canUpdate: true, canDelete: false };
    expect(permissionAllows(row, "view")).toBe(true);
    expect(permissionAllows(row, "create")).toBe(false);
    expect(permissionAllows(row, "update")).toBe(true);
    expect(permissionAllows(row, "delete")).toBe(false);
  });

  it("denies when the row is missing entirely", () => {
    expect(permissionAllows(undefined, "view")).toBe(false);
  });
});

describe("anyModuleViewable", () => {
  it("is true when one of the listed modules is viewable", () => {
    const m = mergeRolePermissions([role(perm("INTEGRATIONS", { canView: true }))]);
    expect(anyModuleViewable(m, ["INTEGRATIONS"])).toBe(true);
  });

  it("is false when the module is held but not viewable", () => {
    // create-without-view is nonsense in practice, but the gate must key on view alone.
    const m = mergeRolePermissions([role(perm("INTEGRATIONS", { canCreate: true }))]);
    expect(anyModuleViewable(m, ["INTEGRATIONS"])).toBe(false);
  });

  it("is false for an empty module list", () => {
    expect(anyModuleViewable(mergeRolePermissions([]), [])).toBe(false);
  });
});
