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
  // separate from FRONT_DESK — this is a per-property PAID ADD-ON (gated additionally
  // by PropertyModuleAccess, not just this permission), so a property without it
  // purchased shouldn't see the nav item regardless of role. Catalog/schedule
  // management (ExcursionType/Rate/Schedule) is a Controls tab gated by CONTROLS, not
  // this module — this module only covers day-to-day bookings.
  "EXCURSIONS",
  // Booking/managing Spa appointments (see .agents/docs/SPA_PLAN.md). Same shape as
  // EXCURSIONS above — a per-property PAID ADD-ON gated additionally by
  // PropertyModuleAccess, catalog/setup (treatments/rates/therapists/rooms/schedules)
  // is a Controls tab gated by CONTROLS, this module only covers day-to-day
  // appointment booking/check-in/completion.
  "SPA",
  // The FIRST enterprise-level (Hub) module — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
  // Unlike every module above it, this one is NOT property-operational: it gates the Hub
  // shell (src/app/e/[slug]/hub), where channel-manager connectivity, credentials, sharing
  // and sync logs live. It is deliberately in this same flat list rather than a separate
  // enterprise-permission concept — reusing RolePermission's CRUD bits verbatim costs
  // nothing and backfillMissingRolePermissions() self-heals existing roles. If the Hub
  // grows past ~3 modules, revisit and split MODULES by scope level (PROPERTY|ENTERPRISE).
  // Membership of the Hub is decided by HUB_MODULES in src/lib/scope.ts, not by this list.
  "INTEGRATIONS",
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
  CONTROLS: "Controls",
  ACTIVITY_LOG: "Activity Log",
  EXCURSIONS: "Excursions",
  SPA: "Spa",
  INTEGRATIONS: "Integrations",
};
