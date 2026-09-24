// The canonical module list — mirrors the sidebar's nav items 1:1 (see
// src/components/app-sidebar.tsx). No server-only imports here, so both
// src/lib/scope.ts (server) and client components (the Controls UI) can use it.
export const MODULES = [
  "FRONT_DESK",
  "RESERVATIONS",
  "GROUP_BLOCKS",
  "TAPE_CHART",
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
  "ACTIVITY_LOG",
  // Booking/managing Excursions (see .agents/docs/EXCURSIONS_PLAN.md). Deliberately
  // separate from FRONT_DESK — this is a PAID ADD-ON (gated additionally by
  // EnterpriseAddonAccess, not just this permission), so an enterprise without it
  // purchased shouldn't see the nav item regardless of role. Catalog/schedule
  // management (ExcursionType/Rate/Schedule) is a Controls tab gated by CONTROLS, not
  // this module — this module only covers day-to-day bookings.
  "EXCURSIONS",
  // Booking/managing Spa appointments (see .agents/docs/SPA_PLAN.md). Same shape as
  // EXCURSIONS above — a PAID ADD-ON gated additionally by
  // EnterpriseAddonAccess, catalog/setup (treatments/rates/therapists/rooms/schedules)
  // is a Controls tab gated by CONTROLS, this module only covers day-to-day
  // appointment booking/check-in/completion.
  "SPA",
  // The Operations Dashboard (2026-09-06, owner). Until now the dashboard was the one
  // screen no module owned — every role could open it. It has a module for two reasons:
  // `view` decides who lands on it at all, and `update` is where the per-role choice of
  // WHICH WIDGETS a role sees is administered (see RoleDashboardWidget in the schema).
  //
  // Not a gate on the underlying figures: every tile is still governed by the module that
  // owns its data (REVENUE, HOUSEKEEPING, …) inside /api/dashboard/overview, so granting
  // DASHBOARD hands out no numbers a role could not already reach. It decides whether the
  // page exists for you and which of your own tiles are put in front of you.
  "DASHBOARD",
  // The FIRST enterprise-level (Hub) module — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
  // Unlike every module above it, this one is NOT property-operational: it gates the Hub
  // shell (src/app/e/[slug]/hub), where channel-manager connectivity, credentials, sharing
  // and sync logs live. It is deliberately in this same flat list rather than a separate
  // enterprise-permission concept — reusing RolePermission's CRUD bits verbatim costs
  // nothing and backfillMissingRolePermissions() self-heals existing roles. If the Hub
  // grows past ~3 modules, revisit and split MODULES by scope level (PROPERTY|ENTERPRISE).
  // Membership of the Hub is decided by HUB_MODULES in src/lib/scope.ts, not by this list.
  "INTEGRATIONS",
  // The SECOND Hub module (2026-08-04). Identity is enterprise-wide — who exists, what
  // they may do, and who is signed in — so it belongs beside Integrations rather than in
  // a property's Controls. Being a Hub module also means a PROPERTY-scoped user can never
  // hold it (hasHubAccess), which is the owner's decision that only enterprise admins
  // manage staff. The operational "list people I can assign work to" lookup is NOT this
  // module — see /api/staff, gated on HOUSEKEEPING/MAINTENANCE.
  "USERS",
  // The THIRD Hub module (2026-09-23, owner): Green Tax registration numbers — review a
  // property's yearly Reg No sequence, remove a number wrongly given (PM room, stay under
  // 12 h) with the gap-free renumbering that implies, and mark months filed with MIRA,
  // which locks them. `view` opens the page; `update` makes corrections and files months.
  "GREEN_TAX",
] as const;

export type Module = (typeof MODULES)[number];
export type Action = "view" | "create" | "update" | "delete";

export const MODULE_LABELS: Record<Module, string> = {
  FRONT_DESK: "Front Desk",
  RESERVATIONS: "Reservations",
  GROUP_BLOCKS: "Group Blocks",
  TAPE_CHART: "Tape Chart",
  AVAILABILITY: "Availability",
  PROFILES: "Client Relations",
  HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance",
  CASHIERING: "Cashiering",
  POS: "Fast Post",
  NIGHT_AUDIT: "Night Audit",
  DEBTORS: "Debtors",
  REVENUE: "Revenue",
  REPORTS: "Daily Reports",
  CONTROLS: "Property Setup",
  ACTIVITY_LOG: "Activity Log",
  EXCURSIONS: "Excursions",
  SPA: "Spa",
  DASHBOARD: "Dashboard",
  INTEGRATIONS: "Integrations",
  USERS: "Users & Access",
  GREEN_TAX: "Green Tax Registrations",
};

// ── Service add-ons ───────────────────────────────────────────────────────────────
//
// Sellable add-ons that are NOT app modules. EnterpriseAddonAccess is the right storage
// for these — it already means "this enterprise has purchased X" — but its key must not
// be forced into MODULES, because MODULES is the RBAC/nav list: anything added there
// gains a sidebar entry, a row in every role's permission matrix, and a meaningless
// requirePermission() surface. A service the platform performs on the tenant's behalf
// has none of those.
//
// PLATFORM_EMAIL (2026-08-10, owner): the enterprise may send through UPPSOLUT's SMTP
// instead of configuring their own, billed separately. Granting this does NOT change
// what a tenant sees or configures — their own SMTP under Controls always wins; this
// only decides whether there is a fallback when they have not set one up. Every message
// sent this way is recorded in EmailLog, which is what the billing figure comes from.
export const SERVICE_ADDONS = ["PLATFORM_EMAIL"] as const;

export type ServiceAddon = (typeof SERVICE_ADDONS)[number];

export const SERVICE_ADDON_LABELS: Record<ServiceAddon, string> = {
  PLATFORM_EMAIL: "Uppsolut Mail Service",
};

/**
 * Every valid EnterpriseAddonAccess key.
 *
 * The add-ons API writes this value straight into a compound primary key, so an
 * unrecognised one creates a permanent row that no UI can show or remove. Validate
 * against this, never against MODULES alone.
 */
export const ADDON_KEYS = [...MODULES, ...SERVICE_ADDONS] as const;

export type AddonKey = Module | ServiceAddon;

export function addonLabel(key: string): string {
  return (
    SERVICE_ADDON_LABELS[key as ServiceAddon] ??
    MODULE_LABELS[key as Module] ??
    key
  );
}

// ── Scope level ───────────────────────────────────────────────────────────────────
//
// Which shell a module belongs to. This lives here, not in scope.ts, because the role
// permission matrix has to render the distinction and scope.ts is server-only (it imports
// prisma). scope.ts re-exports these lists so there is still one source of truth.
//
// 2026-09-23 (owner, .agents/docs/HUB_SETUP_PLAN.md): setup moved out of the property
// dashboard into the Hub, and the Hub is now split into an ENTERPRISE area and a
// per-PROPERTY area. So:
//   - CONTROLS ("Property Setup") joins the Hub — there is no Controls page in the
//     dashboard any more.
//   - A single-property user may enter the Hub, but only reaches their own property's
//     pages, and only through PROPERTY_SETUP_MODULES.
//   - ENTERPRISE_ONLY_MODULES can never take effect for a single-property user —
//     identity is enterprise-wide.
export const HUB_MODULES = ["CONTROLS", "INTEGRATIONS", "USERS", "GREEN_TAX"] as const satisfies readonly Module[];

// Hub modules with a per-property half. Holding one of these (view) is what lets a
// single-property user into the Hub — to their own property's pages only.
export const PROPERTY_SETUP_MODULES = ["CONTROLS", "INTEGRATIONS", "GREEN_TAX"] as const satisfies readonly Module[];

// Hub modules that exist only at enterprise level. Granting one to a single-property
// user saves, but does nothing — the role editor warns about exactly this.
export const ENTERPRISE_ONLY_MODULES = ["USERS"] as const satisfies readonly Module[];

export type ModuleScope = "PROPERTY" | "HUB";

export function moduleScope(module: Module): ModuleScope {
  return (HUB_MODULES as readonly Module[]).includes(module) ? "HUB" : "PROPERTY";
}

export const MODULE_SCOPE_LABELS: Record<ModuleScope, string> = {
  PROPERTY: "Property modules",
  HUB: "Hub modules (setup & administration)",
};

export const MODULE_SCOPE_DESCRIPTIONS: Record<ModuleScope, string> = {
  PROPERTY: "Day-to-day operation of a property. Available to every user who has a work location.",
  HUB: "Setup, integrations, compliance and people — managed in the Hub. An All-Properties user reaches every property and the enterprise settings; a single-property user reaches only their own property's setup, and never Users & Access.",
};
