import { prisma as defaultPrisma } from "@/lib/db";
import { getPropertySettings } from "@/lib/property-settings";
import { GREEN_TAX_GUEST_SELECT, greenTaxPax, reservationGuests } from "@/lib/green-tax-exemption";

/**
 * Green Tax basis for a saved reservation — the adults/children who pay it after the
 * exempt named guests come off (src/lib/green-tax-exemption.ts). Spread into a quote
 * input or a PostingContext so estimates, the proforma and the Advance Bill charge
 * exactly what Night Audit will.
 */
export async function reservationGreenTaxBasis(
  reservationId: string,
  db: Pick<typeof defaultPrisma, "reservation"> = defaultPrisma
): Promise<{ greenTaxAdults: number; greenTaxChildren: number }> {
  const res = await db.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: {
      propertyId: true, adults: true, children: true, infants: true, checkInDate: true,
      primaryGuest: { select: GREEN_TAX_GUEST_SELECT },
      accompanyingGuests: { select: { profile: { select: GREEN_TAX_GUEST_SELECT } } },
    },
  });
  const settings = await getPropertySettings(res.propertyId);
  const pax = greenTaxPax(res, reservationGuests(res), settings?.greenTaxExemptAge ?? 2);
  return { greenTaxAdults: pax.adults, greenTaxChildren: pax.children };
}

/** The same for guests not yet saved on a reservation (the booking form's quote). */
export async function draftGreenTaxBasis(params: {
  propertyId: string;
  adults: number;
  children: number;
  infants: number;
  checkInDate: Date;
  guestIds: string[];
}): Promise<{ greenTaxAdults: number; greenTaxChildren: number }> {
  const ids = [...new Set(params.guestIds.filter(Boolean))];
  const [guests, settings] = await Promise.all([
    ids.length ? defaultPrisma.profile.findMany({ where: { upid: { in: ids } }, select: GREEN_TAX_GUEST_SELECT }) : [],
    getPropertySettings(params.propertyId),
  ]);
  const pax = greenTaxPax(params, guests, settings?.greenTaxExemptAge ?? 2);
  return { greenTaxAdults: pax.adults, greenTaxChildren: pax.children };
}
