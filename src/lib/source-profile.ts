import { prisma } from "@/lib/db";
import { isMarkerColor, isMarkerIcon, isSettlementMode, nextUnusedColor } from "@/lib/booking-markers";

// The Source-only fields of a profile, parsed from a create/update body (Agent Portal plan
// Phase 3). Invalid values are dropped rather than stored. `undefined` = leave unchanged.
export function sourceFieldsFromBody(body: Record<string, unknown>) {
  const out: {
    settlementMode?: string | null;
    earlyAccessDays?: number | null;
    portalAutoConfirm?: boolean;
    markerIcon?: string | null;
    markerColor?: string | null;
  } = {};
  if ("settlementMode" in body) out.settlementMode = isSettlementMode(body.settlementMode) ? body.settlementMode : null;
  if ("earlyAccessDays" in body) {
    const n = body.earlyAccessDays === "" || body.earlyAccessDays === null ? null : Number(body.earlyAccessDays);
    out.earlyAccessDays = n === null || !Number.isInteger(n) || n < 0 || n > 365 ? null : n;
  }
  if (typeof body.portalAutoConfirm === "boolean") out.portalAutoConfirm = body.portalAutoConfirm;
  if ("markerIcon" in body) out.markerIcon = isMarkerIcon(body.markerIcon) ? body.markerIcon : null;
  if ("markerColor" in body) out.markerColor = isMarkerColor(body.markerColor) ? body.markerColor : null;
  return out;
}

/** A new Source gets the next palette colour no other Source of the enterprise uses (A-22). */
export async function defaultSourceColor(enterpriseId: string): Promise<string> {
  const used = await prisma.profile.findMany({
    where: { enterpriseId, profileType: "SOURCE", markerColor: { not: null } },
    select: { markerColor: true },
  });
  return nextUnusedColor(used.map((u) => u.markerColor));
}
