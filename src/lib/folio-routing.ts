import { prisma } from "@/lib/db";

// Resolve where a charge should actually land given any standing routing rule.
// A FolioRoutingRule redirects charges of a given ChargeCode on a source
// reservation INTO a target folio (another window on the same reservation, or
// another in-house room's folio). If no rule matches — or the target folio has
// since been closed — the charge stays on the folio it was posted to.
export async function resolveRoutingTargetFolioId(
  reservationId: string,
  chargeCodeId: string,
  defaultFolioId: string
): Promise<string> {
  const rule = await prisma.folioRoutingRule.findUnique({
    where: { reservationId_chargeCodeId: { reservationId, chargeCodeId } },
    include: { targetFolio: { select: { id: true, isClosed: true } } },
  });
  if (rule && rule.targetFolio && !rule.targetFolio.isClosed) {
    return rule.targetFolioId;
  }
  return defaultFolioId;
}
