import type { Prisma } from "@prisma/client";

// The one way to void a posted charge (SPA_PLAN.md §9's "extract a shared helper" note,
// done when Spa's cancel became the third caller after the folio void route and
// Excursions' cancel).
//
// A posting is a PARENT line plus the lines postCharge generated from it (service charge,
// GST, per-person levies — FolioLineItem.generatedFromLineItemId). Voiding only the parent
// left those generated lines live: the folio kept billing the guest tax and service on a
// charge that no longer existed. The whole posting is reversed together here.
//
// Never deletes: rows stay on the folio flagged isVoid, so the correction is visible
// history. Callers check the folio is open and the actor may void BEFORE calling this.

export async function voidPostedCharge(
  tx: Prisma.TransactionClient,
  input: { lineItemId: string; reason: string; actorName: string }
) {
  const item = await tx.folioLineItem.findUniqueOrThrow({
    where: { id: input.lineItemId },
    include: { folio: true, generatedLines: { where: { isVoid: false }, select: { id: true } } },
  });
  const ids = [item.id, ...item.generatedLines.map((l) => l.id)];
  await tx.folioLineItem.updateMany({ where: { id: { in: ids } }, data: { isVoid: true } });

  // Reservation-backed folios get a trace row recording who voided what and why. Walk-in
  // folios have no reservation to attach one to; the flagged row itself is the record.
  if (item.folio.reservationId) {
    await tx.reservationTrace.create({
      data: {
        reservationId: item.folio.reservationId,
        traceType: "FRONT_DESK",
        description: `Voided charge "${item.description}" (${item.amount.toFixed(2)}) by ${input.actorName}. Reason: ${input.reason}`,
        actionDate: new Date(),
        isResolved: true,
      },
    });
  }

  return { item, voidedLineIds: ids };
}

/** Display name for an actor's trace rows; system actors have no User row. */
export async function actorDisplayName(tx: Prisma.TransactionClient, userId: string): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return user ? `${user.firstName} ${user.lastName}`.trim() : userId;
}
