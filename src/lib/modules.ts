// The canonical module list — mirrors the sidebar's nav items 1:1 (see
// src/components/app-sidebar.tsx). No server-only imports here, so both
// src/lib/scope.ts (server) and client components (the Controls UI) can use it.
export const MODULES = [
  "FRONT_DESK",
  "RESERVATIONS",
  "GROUP_BLOCKS",
  "TAPE_CHART",
  "PROFILES",
  "HOUSEKEEPING",
  "MAINTENANCE",
  "CASHIERING",
  "POS",
  "NIGHT_AUDIT",
  "REVENUE",
  "REPORTS",
  "CONTROLS",
] as const;

export type Module = (typeof MODULES)[number];
export type Action = "view" | "create" | "update" | "delete";

export const MODULE_LABELS: Record<Module, string> = {
  FRONT_DESK: "Front Desk",
  RESERVATIONS: "Reservations",
  GROUP_BLOCKS: "Group Blocks",
  TAPE_CHART: "Tape Chart",
  PROFILES: "Profiles & CRM",
  HOUSEKEEPING: "Housekeeping",
  MAINTENANCE: "Maintenance",
  CASHIERING: "Cashiering",
  POS: "Point of Sale",
  NIGHT_AUDIT: "Night Audit",
  REVENUE: "Revenue",
  REPORTS: "Daily Reports",
  CONTROLS: "Controls",
};
