import { prisma } from "@/lib/db";
import {
  DEFAULT_MARKER_RULES,
  MARKER_MATCHES,
  isMarkerColor,
  isMarkerIcon,
  type MarkerMatch,
  type MarkerRule,
} from "@/lib/booking-markers";

// A property's booking marker rules (Agent Portal plan A-22). No rows = the seeded defaults,
// so the Tape Chart works with zero setup; saving writes the whole ordered list.

export async function getMarkerRules(propertyId: string): Promise<MarkerRule[]> {
  const rows = await prisma.bookingMarker.findMany({ where: { propertyId }, orderBy: { sortOrder: "asc" } });
  if (rows.length === 0) return DEFAULT_MARKER_RULES.map((r) => ({ ...r, isActive: true }));
  return rows
    .filter((r) => (MARKER_MATCHES as readonly string[]).includes(r.match) && isMarkerIcon(r.icon) && isMarkerColor(r.colorToken))
    .map((r) => ({
      id: r.id,
      label: r.label,
      match: r.match as MarkerMatch,
      matchValue: r.matchValue,
      icon: r.icon as MarkerRule["icon"],
      colorToken: r.colorToken as MarkerRule["colorToken"],
      isActive: r.isActive,
    }));
}

export function parseMarkerRules(raw: unknown): MarkerRule[] | string {
  if (!Array.isArray(raw)) return "rules must be a list";
  if (raw.length > 40) return "At most 40 rules";
  const out: MarkerRule[] = [];
  for (const [i, r] of raw.entries()) {
    const x = (r ?? {}) as Record<string, unknown>;
    const label = typeof x.label === "string" ? x.label.trim().slice(0, 60) : "";
    if (!label) return `Rule ${i + 1}: a label is required`;
    if (!(MARKER_MATCHES as readonly string[]).includes(String(x.match))) return `Rule ${i + 1}: unknown condition`;
    if (!isMarkerIcon(x.icon)) return `Rule ${i + 1}: pick an icon from the list`;
    if (!isMarkerColor(x.colorToken)) return `Rule ${i + 1}: pick a colour from the palette`;
    if (x.match === "SPECIFIC_SOURCE" && !x.matchValue) return `Rule ${i + 1}: choose the source`;
    out.push({
      label,
      match: x.match as MarkerMatch,
      matchValue: typeof x.matchValue === "string" && x.matchValue ? x.matchValue : null,
      icon: x.icon,
      colorToken: x.colorToken,
      isActive: x.isActive !== false,
    });
  }
  return out;
}

export async function saveMarkerRules(propertyId: string, rules: MarkerRule[]) {
  await prisma.$transaction(async (tx) => {
    await tx.bookingMarker.deleteMany({ where: { propertyId } });
    if (rules.length > 0) {
      await tx.bookingMarker.createMany({
        data: rules.map((r, i) => ({
          propertyId,
          sortOrder: i,
          label: r.label,
          match: r.match,
          matchValue: r.matchValue ?? null,
          icon: r.icon,
          colorToken: r.colorToken,
          isActive: r.isActive !== false,
        })),
      });
    }
  });
}
