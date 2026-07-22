import type { ReportDef } from "@/lib/reports/types";
import { FRONT_DESK_REPORTS } from "@/lib/reports/defs/front-desk";
import { RESERVATION_REPORTS } from "@/lib/reports/defs/reservations";

// Every report in the system. Add a module's defs array here to register it.
export const REPORTS: ReportDef[] = [...FRONT_DESK_REPORTS, ...RESERVATION_REPORTS];

export function getReport(key: string): ReportDef | null {
  return REPORTS.find((r) => r.key === key) ?? null;
}

// Display order + labels for the report catalog UI.
export const MODULE_ORDER: { module: ReportDef["module"]; label: string }[] = [
  { module: "FRONT_DESK", label: "Front Desk" },
  { module: "RESERVATIONS", label: "Reservations" },
  { module: "REVENUE", label: "Revenue" },
  { module: "FINANCIAL", label: "Financial" },
  { module: "HOUSEKEEPING", label: "Housekeeping" },
];

// The catalog the parameter-form UI consumes (defs minus the server-only run fn).
export function reportCatalog() {
  return REPORTS.map((r) => ({
    key: r.key,
    module: r.module,
    name: r.name,
    description: r.description,
    params: r.params,
  }));
}
