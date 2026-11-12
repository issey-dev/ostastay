import type { Module, Action } from "@/lib/modules";

// Role capabilities — Agent Portal plan §10 "Capabilities" (Phase 0b, owner 2026-11-11).
//
// The four actions per module stay. On top, each module carries named single switches for
// what view/create/update/delete cannot express ("may overbook", "sees rates"). Rules:
//
// - The catalogue is CODE, not data: a capability cannot exist without a check behind it.
//   Every entry below is enforced somewhere with hasCapability()/requireCapability().
// - A role with no RoleCapability row for a capability gets its DEFAULT, derived from that
//   role's own module permissions — exactly what the role could effectively do before
//   capabilities existed. So nobody gains or loses anything on upgrade.
// - A row (granted true/false) overrides the default for that role.
// - Across several roles the effective value is OR, the same rule as module permissions
//   (src/lib/role-permissions.ts). That is why "Suppress rates" is stored as its positive
//   twin `figures.see`: a user holding one role that sees rates sees rates.
//
// Client-safe: no server imports, so the roles screen renders from the same list.

type Has = (module: Module, action: Action) => boolean;

export type CapabilityDef = {
  key: string;
  group: string;
  /** Module whose screen this lives under on the roles editor. */
  module: Module;
  label: string;
  description: string;
  /** What a role could effectively do before this capability existed. */
  defaultFor: (has: Has) => boolean;
  /** Shown inverted on the roles screen (e.g. figures.see is edited as "Suppress rates"). */
  invertedLabel?: string;
  /** Needs money figures to be useful; a role that cannot see figures cannot hold it. */
  needsFigures?: boolean;
};

export const CAPABILITIES = [
  // ── Reservations ──────────────────────────────────────────────────────────
  {
    key: "reservations.overbook",
    group: "Reservations",
    module: "RESERVATIONS",
    label: "Overbook a room type",
    description: "Confirm the overbooking prompt and sell a room type past what is free.",
    defaultFor: (has) => has("RESERVATIONS", "create") || has("RESERVATIONS", "update"),
  },
  {
    key: "reservations.exceedSellLimit",
    group: "Reservations",
    module: "RESERVATIONS",
    label: "Exceed the sell limit",
    description: "Book past the night's sell limit (the manager's override).",
    defaultFor: (has) => has("AVAILABILITY", "delete"),
  },
  {
    key: "reservations.overrideStopSale",
    group: "Reservations",
    module: "RESERVATIONS",
    label: "Override a stop sale",
    description: "Book a night that is closed by stop sale.",
    defaultFor: (has) => has("AVAILABILITY", "update"),
  },
  {
    key: "reservations.manageOption",
    group: "Reservations",
    module: "RESERVATIONS",
    label: "Confirm, extend or release an option",
    description: "Turn a tentative booking into a confirmed one, move its option date, or release it.",
    defaultFor: (has) => has("RESERVATIONS", "update"),
  },
  {
    key: "reservations.markOverflow",
    group: "Reservations",
    module: "RESERVATIONS",
    label: "Mark or clear Overflow",
    description: "Place a booking at a partner hotel when the house is full, or move it back.",
    defaultFor: (has) => has("RESERVATIONS", "update"),
  },
  // ── Availability ──────────────────────────────────────────────────────────
  {
    key: "availability.stopSale",
    group: "Availability",
    module: "AVAILABILITY",
    label: "Set and lift stop sale",
    description: "Close or reopen nights for sale.",
    defaultFor: (has) => has("AVAILABILITY", "update"),
  },
  {
    key: "availability.sellLimits",
    group: "Availability",
    module: "AVAILABILITY",
    label: "Edit sell limits",
    description: "Set how many rooms past capacity may be sold on a night.",
    defaultFor: (has) => has("AVAILABILITY", "update"),
  },
  // ── Front Desk ────────────────────────────────────────────────────────────
  {
    key: "frontDesk.reverseCheckIn",
    group: "Front Desk",
    module: "FRONT_DESK",
    label: "Undo a check-in",
    description: "Put an in-house guest back to reserved.",
    defaultFor: (has) => has("RESERVATIONS", "update"),
  },
  {
    key: "frontDesk.reverseCheckOut",
    group: "Front Desk",
    module: "FRONT_DESK",
    label: "Reverse a check-out",
    description: "Reopen a departed stay.",
    defaultFor: (has) => has("RESERVATIONS", "update"),
  },
  {
    key: "frontDesk.eRegistrationLink",
    group: "Front Desk",
    module: "FRONT_DESK",
    label: "Send an eRegistration link",
    description: "Create or resend the guest's online registration link.",
    defaultFor: (has) => has("RESERVATIONS", "update"),
  },
  // ── Billing ───────────────────────────────────────────────────────────────
  {
    key: "billing.advanceFolio",
    group: "Billing",
    module: "CASHIERING",
    label: "Generate an Advance Folio",
    description: "Post every remaining night of an in-house stay on today's date.",
    defaultFor: (has) => has("CASHIERING", "update"),
    needsFigures: true,
  },
  {
    key: "billing.voidBill",
    group: "Billing",
    module: "CASHIERING",
    label: "Void a bill",
    description: "Void a finalised bill and reopen its folio.",
    defaultFor: (has) => has("CASHIERING", "update"),
    needsFigures: true,
  },
  // ── Rates and figures ─────────────────────────────────────────────────────
  {
    key: "figures.see",
    group: "Rates and figures",
    module: "REVENUE",
    label: "See rates and figures",
    invertedLabel: "Suppress rates",
    description:
      "When suppressed, rates, charge lines, totals and revenue are removed from every screen, print and export for this role. The balance due stays visible so the desk can still collect.",
    defaultFor: () => true,
  },
  // ── Night Audit ───────────────────────────────────────────────────────────
  {
    key: "nightAudit.run",
    group: "Night Audit",
    module: "NIGHT_AUDIT",
    label: "Run Night Audit",
    description: "Start the Night Audit and roll the business date.",
    defaultFor: (has) => has("NIGHT_AUDIT", "create"),
  },
  // ── Sources and blocks ────────────────────────────────────────────────────
  {
    key: "groups.decideSlotRequest",
    group: "Sources and blocks",
    module: "GROUP_BLOCKS",
    label: "Approve or decline a slot request",
    description: "Turn a Source's slot request into a held block, or decline it.",
    defaultFor: (has) => has("GROUP_BLOCKS", "update"),
  },
  {
    key: "profiles.portalLogins",
    group: "Sources and blocks",
    module: "PROFILES",
    label: "Manage portal logins",
    description: "Add, suspend and reset the agent portal logins on a Source profile.",
    defaultFor: (has) => has("PROFILES", "update"),
  },
  {
    key: "debtors.payCommission",
    group: "Sources and blocks",
    module: "DEBTORS",
    label: "Pay or offset commission",
    description: "Approve commission and record a payout or an offset against invoices.",
    defaultFor: (has) => has("DEBTORS", "update"),
    needsFigures: true,
  },
  // ── Reports ───────────────────────────────────────────────────────────────
  {
    key: "reports.export",
    group: "Reports",
    module: "REPORTS",
    label: "Export to file",
    description: "Download reports as PDF, spreadsheet or delimited text.",
    defaultFor: (has) => has("REPORTS", "view"),
  },
] as const satisfies readonly CapabilityDef[];

export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

export const CAPABILITY_KEYS: readonly CapabilityKey[] = CAPABILITIES.map((c) => c.key);

const BY_KEY = new Map<string, CapabilityDef>(CAPABILITIES.map((c) => [c.key, c]));

export function capabilityDef(key: string): CapabilityDef | undefined {
  return BY_KEY.get(key);
}

export function isCapabilityKey(key: unknown): key is CapabilityKey {
  return typeof key === "string" && BY_KEY.has(key);
}

type PermRow = { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean };

export function hasFromRows(rows: Map<string, PermRow> | Iterable<PermRow & { module: string }>): Has {
  const map = rows instanceof Map ? rows : new Map([...rows].map((r) => [r.module, r]));
  return (module, action) => {
    const p = map.get(module);
    if (!p) return false;
    return action === "view" ? p.canView : action === "create" ? p.canCreate : action === "update" ? p.canUpdate : p.canDelete;
  };
}

/** One role's effective capabilities: its overrides on top of the defaults its permissions imply. */
export function roleCapabilities(
  permissions: Iterable<PermRow & { module: string }>,
  overrides: Iterable<{ capability: string; granted: boolean }>
): Set<CapabilityKey> {
  const has = hasFromRows(permissions);
  const byKey = new Map([...overrides].map((o) => [o.capability, o.granted]));
  const out = new Set<CapabilityKey>();
  for (const c of CAPABILITIES) {
    const granted = byKey.has(c.key) ? !!byKey.get(c.key) : c.defaultFor(has);
    if (granted) out.add(c.key);
  }
  // A role that cannot see figures cannot hold a capability that needs them.
  if (!out.has("figures.see")) {
    for (const c of CAPABILITIES) if ((c as CapabilityDef).needsFigures) out.delete(c.key);
  }
  return out;
}

/** Several roles: OR, the same rule as mergeRolePermissions. */
export function mergeCapabilities(perRole: Iterable<Set<CapabilityKey>>): Set<CapabilityKey> {
  const out = new Set<CapabilityKey>();
  for (const s of perRole) for (const k of s) out.add(k);
  return out;
}

/** A plain-language one-liner for the top of the roles editor. */
export function summarizeRole(
  permissions: Iterable<PermRow & { module: string }>,
  caps: Set<CapabilityKey>
): string {
  const has = hasFromRows(permissions);
  const parts: string[] = [];
  const can: string[] = [];
  if (has("RESERVATIONS", "create")) can.push("book");
  if (has("FRONT_DESK", "update")) can.push("check in and out");
  if (has("CASHIERING", "create")) can.push("post charges and payments");
  if (has("HOUSEKEEPING", "update")) can.push("change room status");
  if (has("NIGHT_AUDIT", "create")) can.push("run Night Audit");
  if (has("USERS", "update")) can.push("manage users");
  if (can.length) parts.push(`Can ${can.join(", ")}`);
  const cannot: string[] = [];
  if (!caps.has("figures.see")) cannot.push("see rates");
  if (has("RESERVATIONS", "create") && !caps.has("reservations.overbook")) cannot.push("overbook");
  if (has("CASHIERING", "view") && !caps.has("billing.voidBill")) cannot.push("void bills");
  if (has("REPORTS", "view") && !caps.has("reports.export")) cannot.push("export reports");
  if (cannot.length) parts.push(`cannot ${cannot.join(", ")}`);
  return parts.length ? parts.join("; ") + "." : "No access.";
}
