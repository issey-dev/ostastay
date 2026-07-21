// Shared maintenance vocabulary — the one list both UIs (housekeeping board's
// Report Issue dialog, Inventory's WorkOrderManager) and the API validation use,
// replacing the two divergent hardcoded lists that had drifted apart.

export const MAINTENANCE_ISSUE_TYPES = [
  { value: "HVAC", label: "HVAC (A/C, Heating)" },
  { value: "PLUMBING", label: "Plumbing (Leaks, Toilets)" },
  { value: "ELECTRICAL", label: "Electrical (Lights, Power)" },
  { value: "GENERAL", label: "General (Furniture, Paint)" },
] as const;

export const MAINTENANCE_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const MAINTENANCE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const isValidMaintenancePriority = (v: unknown): v is MaintenancePriority =>
  typeof v === "string" && (MAINTENANCE_PRIORITIES as readonly string[]).includes(v);
export const isValidMaintenanceStatus = (v: unknown): v is MaintenanceStatus =>
  typeof v === "string" && (MAINTENANCE_STATUSES as readonly string[]).includes(v);
export const isValidMaintenanceIssueType = (v: unknown): boolean =>
  typeof v === "string" && MAINTENANCE_ISSUE_TYPES.some((t) => t.value === v);
