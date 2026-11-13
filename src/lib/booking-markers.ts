// Booking markers and Source profile settings (Agent Portal plan A-18, A-21, A-22, Phase 3).
// Client-safe: no server imports, so the Tape Chart, lists and the Hub editor share it.
//
// A marker is an icon chip plus a coloured edge on a booking. Status keeps the bar's fill;
// the marker only adds, so status and source never fight for the same channel. Tentative
// bars are additionally hatched (drawn by the Tape Chart, not a marker).
//
// Resolution, first match wins:
//   1. The booking's Source profile, when it carries its own icon/colour.
//   2. The property's ordered BookingMarker rules (seeded with DEFAULT_MARKER_RULES).
//   3. Nothing (plain status colour, as before).

export const SETTLEMENT_MODES = ["AGENT_NET", "AGENT_GROSS", "GUEST_DIRECT"] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];
export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = {
  AGENT_NET: "Agent pays, net of commission",
  AGENT_GROSS: "Agent pays the full amount",
  GUEST_DIRECT: "Guest pays at the hotel",
};
export function isSettlementMode(v: unknown): v is SettlementMode {
  return typeof v === "string" && (SETTLEMENT_MODES as readonly string[]).includes(v);
}

/** Icons a property may pick (names of exports from @/components/icons). */
export const MARKER_ICONS = [
  "Briefcase",
  "Clock",
  "Building2",
  "Users",
  "Globe",
  "Link2",
  "AlertTriangle",
  "Star",
  "Crown",
  "Award",
  "Heart",
  "Gift",
  "Flag",
  "Tag",
  "Plane",
  "Ship",
  "Sun",
  "Sparkles",
] as const;
export type MarkerIcon = (typeof MARKER_ICONS)[number];
export function isMarkerIcon(v: unknown): v is MarkerIcon {
  return typeof v === "string" && (MARKER_ICONS as readonly string[]).includes(v);
}

/**
 * Twelve colours that read in light and dark. Classes are literal strings so Tailwind keeps
 * them: `chip` for the icon chip, `edge` for the bar's left edge, `dot` for legends.
 */
export const MARKER_COLORS = {
  sky: { label: "Sky", chip: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300", edge: "border-l-sky-500", dot: "bg-sky-500" },
  blue: { label: "Blue", chip: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", edge: "border-l-blue-500", dot: "bg-blue-500" },
  indigo: { label: "Indigo", chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300", edge: "border-l-indigo-500", dot: "bg-indigo-500" },
  violet: { label: "Violet", chip: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300", edge: "border-l-violet-500", dot: "bg-violet-500" },
  fuchsia: { label: "Fuchsia", chip: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300", edge: "border-l-fuchsia-500", dot: "bg-fuchsia-500" },
  rose: { label: "Rose", chip: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", edge: "border-l-rose-500", dot: "bg-rose-500" },
  red: { label: "Red", chip: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300", edge: "border-l-red-500", dot: "bg-red-500" },
  orange: { label: "Orange", chip: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300", edge: "border-l-orange-500", dot: "bg-orange-500" },
  amber: { label: "Amber", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300", edge: "border-l-amber-500", dot: "bg-amber-500" },
  lime: { label: "Lime", chip: "bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300", edge: "border-l-lime-500", dot: "bg-lime-500" },
  teal: { label: "Teal", chip: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300", edge: "border-l-teal-500", dot: "bg-teal-500" },
  slate: { label: "Slate", chip: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300", edge: "border-l-slate-500", dot: "bg-slate-500" },
} as const;
export type MarkerColor = keyof typeof MARKER_COLORS;
export const MARKER_COLOR_KEYS = Object.keys(MARKER_COLORS) as MarkerColor[];
export function isMarkerColor(v: unknown): v is MarkerColor {
  return typeof v === "string" && v in MARKER_COLORS;
}

/** The colours a new Source is offered first: ones not already used by another Source. */
export function nextUnusedColor(used: Iterable<string | null | undefined>): MarkerColor {
  const taken = new Set([...used].filter(Boolean));
  // Amber is tentative and violet overflow by default, so Sources start elsewhere.
  const order: MarkerColor[] = ["sky", "teal", "rose", "lime", "fuchsia", "orange", "indigo", "blue", "red", "slate", "violet", "amber"];
  return order.find((c) => !taken.has(c)) ?? order[0];
}

/** What a marker rule matches on. */
export const MARKER_MATCHES = [
  "SOURCE", // any booking with a Source profile (that has no icon/colour of its own)
  "SPECIFIC_SOURCE", // one Source profile (matchValue = upid)
  "TRAVEL_AGENT", // a Travel Agent and no Source
  "TENTATIVE",
  "CONFIRMATION_REQUESTED",
  "OVERFLOW",
  "GROUP", // a group pickup with no Source
  "WEBSITE",
  "CHANNEL",
  "VIP", // primary guest has a VIP level (matchValue = level, empty = any)
] as const;
export type MarkerMatch = (typeof MARKER_MATCHES)[number];
export const MARKER_MATCH_LABELS: Record<MarkerMatch, string> = {
  SOURCE: "Booking from a Source",
  SPECIFIC_SOURCE: "A specific Source",
  TRAVEL_AGENT: "Travel agent booking with no Source",
  TENTATIVE: "Tentative",
  CONFIRMATION_REQUESTED: "Confirmation requested",
  OVERFLOW: "Overflow",
  GROUP: "Group pickup with no Source",
  WEBSITE: "Brand website",
  CHANNEL: "Channel",
  VIP: "VIP guest",
};

export type MarkerRule = {
  id?: string;
  label: string;
  match: MarkerMatch;
  matchValue?: string | null;
  icon: MarkerIcon;
  colorToken: MarkerColor;
  isActive?: boolean;
};

/** Seeded so the Tape Chart works with zero setup (A-22; tune with the customer later, Q-27). */
export const DEFAULT_MARKER_RULES: MarkerRule[] = [
  { label: "Confirmation requested", match: "CONFIRMATION_REQUESTED", icon: "Clock", colorToken: "amber" },
  { label: "Tentative", match: "TENTATIVE", icon: "Clock", colorToken: "amber" },
  { label: "Overflow", match: "OVERFLOW", icon: "Building2", colorToken: "violet" },
  { label: "Source", match: "SOURCE", icon: "Briefcase", colorToken: "sky" },
  { label: "Travel agent", match: "TRAVEL_AGENT", icon: "Briefcase", colorToken: "slate" },
  { label: "Group", match: "GROUP", icon: "Users", colorToken: "teal" },
  { label: "Brand website", match: "WEBSITE", icon: "Globe", colorToken: "blue" },
  { label: "Channel", match: "CHANNEL", icon: "Link2", colorToken: "indigo" },
];

/** The facts about a booking the markers read. */
export type MarkerFacts = {
  status: string;
  origin?: string | null;
  isOverflow?: boolean | null;
  confirmationRequestedAt?: string | Date | null;
  groupBlockId?: string | null;
  travelAgentId?: string | null;
  vipLevel?: string | null;
  source?: { upid: string; name: string; markerIcon?: string | null; markerColor?: string | null } | null;
};

export type ResolvedMarker = { icon: MarkerIcon; color: MarkerColor; label: string };

function matches(rule: MarkerRule, f: MarkerFacts): boolean {
  switch (rule.match) {
    case "SOURCE":
      return !!f.source;
    case "SPECIFIC_SOURCE":
      return !!f.source && f.source.upid === rule.matchValue;
    case "TRAVEL_AGENT":
      return !f.source && !!f.travelAgentId;
    case "TENTATIVE":
      return f.status === "TENTATIVE";
    case "CONFIRMATION_REQUESTED":
      return f.status === "TENTATIVE" && !!f.confirmationRequestedAt;
    case "OVERFLOW":
      return !!f.isOverflow;
    case "GROUP":
      return !f.source && !!f.groupBlockId;
    case "WEBSITE":
      return f.origin === "WEBSITE";
    case "CHANNEL":
      return f.origin === "CHANNEL";
    case "VIP":
      return !!f.vipLevel && (!rule.matchValue || rule.matchValue === f.vipLevel);
  }
}

/**
 * The marker for a booking. The Source's own icon/colour wins over the rules — but only
 * for "who booked it": a tentative or overflow booking still shows that state first,
 * because that is what the desk must act on. Returns null for a plain desk booking.
 */
export function resolveMarker(f: MarkerFacts, rules: MarkerRule[] = DEFAULT_MARKER_RULES): ResolvedMarker | null {
  const active = rules.filter((r) => r.isActive !== false);
  const state = active.find((r) => ["CONFIRMATION_REQUESTED", "TENTATIVE", "OVERFLOW"].includes(r.match) && matches(r, f));
  if (state) return { icon: state.icon, color: state.colorToken, label: state.label };
  if (f.source && isMarkerIcon(f.source.markerIcon) && isMarkerColor(f.source.markerColor)) {
    return { icon: f.source.markerIcon, color: f.source.markerColor, label: f.source.name };
  }
  const hit = active.find((r) => matches(r, f));
  if (!hit) return null;
  return {
    icon: hit.icon,
    // A Source with only a colour set keeps the rule's icon in its own colour.
    color: hit.match === "SOURCE" && f.source && isMarkerColor(f.source.markerColor) ? f.source.markerColor : hit.colorToken,
    label: hit.match === "SOURCE" || hit.match === "SPECIFIC_SOURCE" ? (f.source?.name ?? hit.label) : hit.label,
  };
}
