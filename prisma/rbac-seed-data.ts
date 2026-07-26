// Shared system-role definitions used by prisma/seed-operations.ts, prisma/seed-profiles.ts,
// and src/app/api/auth/seed/route.ts, so all three seeders agree on one set of default
// roles instead of drifting. These map the *intent* of the old free-text role strings
// (see the schema's former `// Role: ...` comment and src/components/settings/team-manager.tsx's
// ROLES array) onto the new per-module CRUD matrix — they're starting points an Enterprise
// admin can freely edit afterward via Controls > Users & Roles, not fixed forever.

export const MODULES = [
  "FRONT_DESK",
  "RESERVATIONS",
  "GROUP_BLOCKS",
  "TAPE_CHART",
  // Property Availability grid + Stop-Sale restrictions. Kept in sync with
  // src/lib/modules.ts's MODULES by hand (prisma/ scripts can't import from src/).
  "AVAILABILITY",
  "PROFILES",
  "HOUSEKEEPING",
  "MAINTENANCE",
  "CASHIERING",
  "POS",
  "NIGHT_AUDIT",
  "DEBTORS",
  "REVENUE",
  "REPORTS",
  "CONTROLS",
  // Read-only audit trail (User Activity Log). Rows are machine-written via
  // src/lib/activity-log.ts — the create/update/delete bits are meaningless for it;
  // only canView matters. Deliberately granted to Admin/Manager only by default
  // (they get FULL automatically via their all-modules matrices below).
  "ACTIVITY_LOG",
  // Excursions bookings (see .agents/docs/EXCURSIONS_PLAN.md) — kept in sync with
  // src/lib/modules.ts's own MODULES array by hand (this file can't import from src/
  // since prisma/ scripts run standalone via tsx). If these two lists ever drift,
  // src/lib/scope.ts's backfillMissingRolePermissions() self-heals existing roles on
  // their next login, but a brand-new enterprise seeded via ensureRoles() below would
  // still miss the default here until both lists agree.
  "EXCURSIONS",
  // Spa bookings (see .agents/docs/SPA_PLAN.md) — same add-on shape and same
  // hand-sync caveat as EXCURSIONS above.
  "SPA",
] as const;

export type ModuleName = (typeof MODULES)[number];

type Perm = { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean };

const FULL: Perm = { canView: true, canCreate: true, canUpdate: true, canDelete: true };
const VIEW_ONLY: Perm = { canView: true, canCreate: false, canUpdate: false, canDelete: false };
const NONE: Perm = { canView: false, canCreate: false, canUpdate: false, canDelete: false };
const EDIT_NO_DELETE: Perm = { canView: true, canCreate: true, canUpdate: true, canDelete: false };

function matrix(overrides: Partial<Record<ModuleName, Perm>>): Record<ModuleName, Perm> {
  const base = Object.fromEntries(MODULES.map((m) => [m, NONE])) as Record<ModuleName, Perm>;
  return { ...base, ...overrides };
}

export const SYSTEM_ROLE_DEFS: Record<string, Record<ModuleName, Perm>> = {
  // Full access everywhere, including Controls (Users & Roles, Licensing, Support Access).
  Admin: matrix(Object.fromEntries(MODULES.map((m) => [m, FULL])) as Record<ModuleName, Perm>),

  // Historically identical to Admin in this app (app-sidebar.tsx's "ADMIN and MANAGER see
  // everything" branch) — kept as its own role so an enterprise can later differentiate them.
  Manager: matrix(Object.fromEntries(MODULES.map((m) => [m, FULL])) as Record<ModuleName, Perm>),

  // Matches today's sidebar FRONT_DESK allow-list exactly (front-office, reservations,
  // group blocks, tape chart, profiles, housekeeping, maintenance, cashiering, POS, night
  // audit) — no Revenue/Reports/Controls access.
  "Front Desk": matrix({
    FRONT_DESK: EDIT_NO_DELETE,
    RESERVATIONS: EDIT_NO_DELETE,
    GROUP_BLOCKS: EDIT_NO_DELETE,
    TAPE_CHART: EDIT_NO_DELETE,
    // View the availability grid and toggle Stop-Sale (setting Open/Closed is gated on
    // canUpdate — see api/availability/restrictions).
    AVAILABILITY: EDIT_NO_DELETE,
    PROFILES: EDIT_NO_DELETE,
    HOUSEKEEPING: EDIT_NO_DELETE,
    MAINTENANCE: EDIT_NO_DELETE,
    CASHIERING: EDIT_NO_DELETE,
    POS: EDIT_NO_DELETE,
    NIGHT_AUDIT: EDIT_NO_DELETE,
    EXCURSIONS: EDIT_NO_DELETE,
    SPA: EDIT_NO_DELETE,
  }),

  // Matches today's sidebar HOUSEKEEPING allow-list (Housekeeping, Maintenance only).
  Housekeeping: matrix({
    HOUSEKEEPING: FULL,
    MAINTENANCE: VIEW_ONLY,
  }),

  // Named in team-manager.tsx's legacy ROLES list but had no sidebar/proxy branch of its
  // own before this change (silently fell through to "sees everything") — given a real,
  // narrower matrix now.
  Maintenance: matrix({
    MAINTENANCE: FULL,
    HOUSEKEEPING: VIEW_ONLY,
  }),

  // DEBTORS added here (not Front Desk) — Accounts Receivable is back-office billing
  // work closely related to Cashiering's settlement responsibilities; can create/view/
  // update credit accounts and record payments, but not delete an account once it has
  // transaction history. Other roles get none by default; an enterprise admin can
  // grant DEBTORS to any role later via Controls > Users & Roles with no code change.
  // PROFILES: EDIT_NO_DELETE is also granted — "Create Credit Account" reuses the
  // existing Profile create/edit form (a credit account IS a COMPANY/TRAVEL_AGENT
  // Profile), so managing debtor accounts requires being able to create/edit Profiles.
  Cashier: matrix({
    CASHIERING: FULL,
    POS: EDIT_NO_DELETE,
    FRONT_DESK: VIEW_ONLY,
    DEBTORS: EDIT_NO_DELETE,
    PROFILES: EDIT_NO_DELETE,
  }),

  Reservations: matrix({
    RESERVATIONS: FULL,
    TAPE_CHART: FULL,
    AVAILABILITY: FULL,
    GROUP_BLOCKS: EDIT_NO_DELETE,
    PROFILES: EDIT_NO_DELETE,
    FRONT_DESK: VIEW_ONLY,
  }),
};

// Osta's own internal support role — Controls access only (to review a target
// enterprise's configuration once a SupportAccessGrant is approved); no operational
// modules, since support's job is troubleshooting configuration, not running a desk.
export const SUPPORT_ROLE_DEFS: Record<string, Record<ModuleName, Perm>> = {
  "Osta Support": matrix({
    CONTROLS: VIEW_ONLY,
  }),
  "Osta Support Admin": matrix(Object.fromEntries(MODULES.map((m) => [m, FULL])) as Record<ModuleName, Perm>),
};

export async function ensureRoles(
  prisma: {
    role: {
      // Deliberate `any`: a minimal structural shape so the real (fully-typed) Prisma
      // client is assignable here. A stricter arg type breaks assignability from Prisma's
      // generated RolePermissionUpsertArgs under strictFunctionTypes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsert: (args: any) => Promise<{ id: string; name: string }>;
    };
  },
  enterpriseId: string,
  defs: Record<string, Record<ModuleName, Perm>>,
  isSystem: boolean
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, perms] of Object.entries(defs)) {
    const role = await prisma.role.upsert({
      where: { enterpriseId_name: { enterpriseId, name } },
      update: {},
      create: {
        enterpriseId,
        name,
        isSystem,
        permissions: {
          create: MODULES.map((module) => ({ module, ...perms[module] })),
        },
      },
    });
    ids[name] = role.id;
  }
  return ids;
}
