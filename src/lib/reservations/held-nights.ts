import type { Prisma } from "@prisma/client"
import { toUtcMidnight } from "@/lib/business-date"
import { getPropertySettings } from "@/lib/property-settings"
import { resolveChargeCode, MissingChargeCodeError } from "@/lib/posting/resolve-charge-code"
import { postStayNight, STAY_NIGHT_INCLUDE } from "@/lib/night-audit/stay-night"

// A late arrival's HELD nights (owner, 2026-09-24). Under Night Audit's no-show "hold one
// night" / "front desk decides" a guest can check in after the audit of their arrival
// night already ran — that night was never charged (the audit only charges guests in
// house). The room was held for them, so it is charged at check-in, at the booked rate,
// through the audit's own posting (stay-night.ts) and dated today's business date; the
// desk may instead WAIVE it with a reason (CASHIERING delete, as for a void). The arrival
// date is not changed either way. Green Tax is not levied on a held night — it is a levy
// on nights stayed, and the guest was not there.

const DAY_MS = 24 * 60 * 60 * 1000

/** The nights already audited before the guest arrived: arrival night up to (not incl.) today. */
export function heldNights(
  reservation: { checkInDate: Date; checkOutDate: Date; advanceBilledThrough?: Date | null },
  businessDate: Date
): Date[] {
  const nights: Date[] = []
  const today = toUtcMidnight(businessDate).getTime()
  const out = toUtcMidnight(reservation.checkOutDate).getTime()
  // A night an Advance Bill already charged is not charged again.
  const billedThrough = reservation.advanceBilledThrough ? toUtcMidnight(reservation.advanceBilledThrough).getTime() : -Infinity
  for (let d = toUtcMidnight(reservation.checkInDate).getTime(); d < today && d < out; d += DAY_MS) {
    if (d > billedThrough) nights.push(new Date(d))
  }
  return nights
}

export const formatNight = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

/** Post every held night on the reservation's billing folio. Call inside the check-in transaction. */
export async function chargeHeldNights(
  tx: Prisma.TransactionClient,
  { reservationId, folioId, businessDate }: { reservationId: string; folioId: string; businessDate: Date }
): Promise<number> {
  const res = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: STAY_NIGHT_INCLUDE })
  const nights = heldNights(res, businessDate)
  if (nights.length === 0) return 0

  const property = await tx.property.findUniqueOrThrow({ where: { id: res.propertyId }, select: { id: true, pricesIncludeTaxes: true } })
  const settings = await getPropertySettings(property.id, tx)
  const fallbackRoomCode = await resolveChargeCode({ propertyId: property.id }, "ACCOMMODATION", { client: tx, settings })
  if (!fallbackRoomCode) throw new MissingChargeCodeError("ACCOMMODATION")
  const baseRatePlan = await tx.ratePlan.findFirst({ where: { propertyId: property.id, isLocked: true }, select: { id: true } })

  // The same routing the audit applies: a standing rule per code, else the block master
  // folio for a bill-to-master group pickup, else the reservation's own folio.
  const rules = await tx.folioRoutingRule.findMany({
    where: { reservationId },
    include: { targetFolio: { select: { isClosed: true } } },
  })
  const routing = new Map(rules.filter((r) => r.targetFolio && !r.targetFolio.isClosed).map((r) => [r.chargeCodeId, r.targetFolioId]))
  const master =
    res.groupBlockId && res.groupBillToMaster
      ? await tx.folio.findFirst({ where: { groupBlockId: res.groupBlockId, isMaster: true, isClosed: false }, select: { id: true } })
      : null
  const target = master?.id ?? folioId

  for (const night of nights) {
    await postStayNight(
      tx,
      res,
      { night, postDate: toUtcMidnight(businessDate), folioId: target, description: `Room Charge — held night ${formatNight(night)}`, levyNightly: false },
      {
        settings,
        pricesIncludeTaxes: property.pricesIncludeTaxes,
        fallbackRoomCode,
        baseRatePlan,
        impliedGreenTaxGenerate: [],
        routeTo: (_reservationId, chargeCodeId, defaultFolioId) => routing.get(chargeCodeId) ?? defaultFolioId,
      }
    )
  }
  return nights.length
}
