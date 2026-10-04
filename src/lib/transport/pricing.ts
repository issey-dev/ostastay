// Transport pricing — which rate applies to a booking, and what it comes to. Pure: no
// database, so the rules are unit-tested directly (tests/business-rules/transport-rules.test.ts).
//
// The amount is the price as configured prices are entered everywhere in this app — gross
// or net per the property's "prices include taxes". Tax itself is never computed here; the
// posting engine (postCharge → resolveOutletChargeTax) does it, using the rate's tax mode.

export type RateLike = {
  id: string
  routeId: string
  transportTypeId: string | null
  providerId: string | null
  direction: string // PICKUP | DROP_OFF | BOTH
  pricingBasis: string // PER_PERSON | PER_VEHICLE | PER_TRIP
  price: number
  adultPrice: number
  childPrice: number
  infantPrice: number
  validFrom: Date | null
  validTo: Date | null
  isActive: boolean
}

export type RateQuery = {
  routeId: string
  direction: string // PICKUP | DROP_OFF
  serviceDate: Date // UTC midnight
  transportTypeId?: string | null
  providerId?: string | null
}

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** Whether a rate may price this booking at all. */
export function rateApplies(rate: RateLike, q: RateQuery): boolean {
  if (!rate.isActive || rate.routeId !== q.routeId) return false
  if (rate.direction !== "BOTH" && rate.direction !== q.direction) return false
  const d = day(q.serviceDate)
  if (rate.validFrom && day(rate.validFrom) > d) return false
  if (rate.validTo && day(rate.validTo) < d) return false
  // A rate tied to a provider or a transport type prices only bookings using it.
  if (rate.providerId && rate.providerId !== (q.providerId ?? null)) return false
  if (rate.transportTypeId && q.transportTypeId && rate.transportTypeId !== q.transportTypeId) return false
  return true
}

/**
 * The most specific enabled rate for the booking: a provider match beats a transport-type
 * match beats an exact direction; ties go to the rate whose validity started most recently
 * (a seasonal rate over the year-round one). Null = complimentary (a route may have no rate).
 */
export function selectRate<T extends RateLike>(rates: T[], q: RateQuery): T | null {
  const candidates = rates.filter((r) => rateApplies(r, q))
  if (candidates.length === 0) return null
  const score = (r: T) =>
    (r.providerId ? 4 : 0) + (r.transportTypeId ? 2 : 0) + (r.direction === q.direction ? 1 : 0)
  return candidates.sort((a, b) => {
    const s = score(b) - score(a)
    if (s !== 0) return s
    return (b.validFrom ? b.validFrom.getTime() : 0) - (a.validFrom ? a.validFrom.getTime() : 0)
  })[0]
}

export type Party = { adults: number; children: number; infants: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/** What the rate comes to for this party (before the tax engine). */
export function rateAmount(
  rate: Pick<RateLike, "pricingBasis" | "price" | "adultPrice" | "childPrice" | "infantPrice">,
  party: Party,
  vehicleCount = 1
): number {
  switch (rate.pricingBasis) {
    case "PER_VEHICLE":
      return round2(rate.price * Math.max(1, vehicleCount))
    case "PER_TRIP":
      return round2(rate.price)
    default:
      return round2(rate.adultPrice * party.adults + rate.childPrice * party.children + rate.infantPrice * party.infants)
  }
}

/** The posting engine's outlet-shaped tax override for a rate's tax mode. */
export function taxOverrideFor(
  taxMode: string,
  taxProfile: { rates: Array<{ name: string; ratePercent: number; calculateOn: string; order: number; effectiveFrom: Date; effectiveTo: Date | null }> } | null
): { taxOverrideMode: string; taxProfile: typeof taxProfile } | null {
  if (taxMode === "DEFAULT") return { taxOverrideMode: "DEFAULT_ENGINE", taxProfile: null }
  if (taxMode === "CUSTOM" && taxProfile) return { taxOverrideMode: "CUSTOM", taxProfile }
  return null
}
