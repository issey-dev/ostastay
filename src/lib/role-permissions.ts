import { MODULES, type Module } from "@/lib/modules";

// Merging several roles into one effective permission set.
//
// A user may hold more than one role (2026-08-04, owner). Access is the UNION of what
// every held role grants, per module per action — the owner's example: Role 1 grants
// permissions 1 and 2, Role 2 grants 2 and 3, a user holding both has 1, 2 and 3.
//
// This is the most security-sensitive function in the app: it decides what every request
// may do. It is deliberately pure and dependency-free so it can be exhaustively tested
// without a database, and so the merge rule lives in exactly one place rather than being
// re-derived inside requireSession.
//
// The rule is OR, never "most permissive role wins". Those differ: a role granting only
// `view` on CASHIERING and another granting only `delete` on CASHIERING combine to
// view+delete, not to whichever role looks stronger overall.

export type PermissionRow = {
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type RolePermissionLike = PermissionRow & { module: string };

export const NO_ACCESS: PermissionRow = {
  canView: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
};

/**
 * OR two permission rows together.
 *
 * Kept separate from the loop below so the "how do two grants combine" question has one
 * answer, and so a future change (a deny-overrides rule, say) has one place to land.
 */
export function orPermissions(a: PermissionRow, b: PermissionRow): PermissionRow {
  return {
    canView: a.canView || b.canView,
    canCreate: a.canCreate || b.canCreate,
    canUpdate: a.canUpdate || b.canUpdate,
    canDelete: a.canDelete || b.canDelete,
  };
}

/**
 * The effective permission map for a user holding these roles.
 *
 * Every module in MODULES is present in the result, explicitly NO_ACCESS when no role
 * mentions it — so a caller can never accidentally treat "module missing from the map"
 * as anything other than denied. A user with no roles at all gets a full map of denials
 * rather than an empty one, for the same reason.
 *
 * Unknown modules (a stale RolePermission row for a module since removed from MODULES)
 * are ignored rather than carried through: granting access to a module the app no longer
 * defines can only ever be noise, and letting it into the map would make the map's key
 * set unpredictable.
 */
export function mergeRolePermissions(
  roles: Array<{ permissions: RolePermissionLike[] }>
): Map<string, PermissionRow> {
  const known = new Set<string>(MODULES);
  const merged = new Map<string, PermissionRow>();

  for (const mod of MODULES) merged.set(mod, { ...NO_ACCESS });

  for (const role of roles) {
    for (const p of role.permissions) {
      if (!known.has(p.module)) continue;
      merged.set(p.module, orPermissions(merged.get(p.module)!, p));
    }
  }

  return merged;
}

/** The action names, matching the four boolean columns. */
export type Action = "view" | "create" | "update" | "delete";

export function permissionAllows(row: PermissionRow | undefined, action: Action): boolean {
  if (!row) return false;
  switch (action) {
    case "view":
      return row.canView;
    case "create":
      return row.canCreate;
    case "update":
      return row.canUpdate;
    case "delete":
      return row.canDelete;
  }
}

/** True when at least one of these modules is viewable — used by the Hub gate. */
export function anyModuleViewable(
  permissions: Map<string, PermissionRow>,
  modules: readonly Module[]
): boolean {
  return modules.some((m) => permissions.get(m)?.canView === true);
}
