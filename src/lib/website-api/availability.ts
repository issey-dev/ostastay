import { prisma } from "@/lib/db";
import { perNightTypeAvailability, formatLocalDay } from "@/lib/availability";
import { resolveBusinessDate } from "@/lib/business-date";
import { resolveWebsiteNightlyPrices } from "@/lib/website-api/rates";

// Availability + calendar prices for a property's brand website.
//
// This is the same class of external publication as the channel push, so the owner's D-7
// ruling (.agents/docs/DECISIONS.md, 2026-07-27) governs it word for word:
//   1. Publish ACTUAL available inventory; never include overbooking allowance. Clamp to 0.
//   2. Overbooking stays manual-only at the desk — the website can never create one.
//   3. Group-block held rooms are withheld until the block's cutoff, then released.
//   5. Stop-sale CLOSES the room type for the night rather than merely showing 0.
//
// The arithmetic is perNightTypeAvailability() in src/lib/availability.ts — one
// definition shared with the Property Availability grid and the channel push, so the
// website can never disagree with either.

const DAY_MS = 86_400_000;

/** A website calendar is a look-to-book view, not a bulk export. */
export const MAX_AVAILABILITY_NIGHTS = 62;

// Same choice as src/lib/channels/sync.ts: a TENTATIVE block is still a real claim on
// rooms until its cutoff passes, and selling those rooms on the website would produce
// exactly the overbook rule 1 exists to prevent.
const BLOCK_STATUSES_THAT_HOLD = ["TENTATIVE", "DEFINITE"];

export type WebsiteNight = {
  date: string;
  /** Rooms sellable this night. Always >= 0. 0 when closed. */
  available: number;
  /** A stop-sale applies — not bookable regardless of `available`. */
  closed: boolean;
  /** Room rate for the night on the configured rate plan, or null when unpriced. */
  price: number | null;
  extraAdultPrice: number | null;
  extraChildPrice: number | null;
};

export type WebsiteRoomTypeAvailability = {
  id: string;
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  nights: WebsiteNight[];
  /** Lowest `available` across the window — how many rooms could be booked for the whole stay. */
  minAvailable: number;
  /** True when every night is open, has stock, and has a price. */
  bookable: boolean;
  /** Sum of nightly room rates when every night is priced, else null. Room rate only — see quote. */
  roomRateTotal: number | null;
};

export type WebsiteAvailability = {
  propertyId: string;
  from: string;
  to: string;
  nights: number;
  currency: string;
  pricesIncludeTaxes: boolean;
  ratePlan: { id: string; code: string; name: string } | null;
  bookingEnabled: boolean;
  roomTypes: WebsiteRoomTypeAvailability[];
};

export type AvailabilityWindowError = { status: number; code: string; error: string };

/** Parse a YYYY-MM-DD as a LOCAL midnight (what dayStartMs() in availability.ts keys on). */
export function parseLocalDay(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a YYYY-MM-DD as a UTC midnight (how Reservation/PriceCalendar dates are stored). */
export function parseUtcDay(input: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validate a website's stay window against the property's booking configuration. Shared
 * by the availability, quote and booking endpoints so every one of them enforces the
 * same floor (business date), ceiling (maxNightsAhead) and minimum stay.
 */
export function validateStayWindow(opts: {
  from: string;
  to: string;
  businessDate: Date;
  minNights: number;
  maxNightsAhead: number;
  maxNights: number;
}): { ok: true; from: Date; to: Date; fromUtc: Date; toUtc: Date; nights: number } | { ok: false } & AvailabilityWindowError {
  const from = parseLocalDay(opts.from);
  const to = parseLocalDay(opts.to);
  const fromUtc = parseUtcDay(opts.from);
  const toUtc = parseUtcDay(opts.to);
  if (!from || !to || !fromUtc || !toUtc) {
    return { ok: false, status: 400, code: "INVALID_DATES", error: "Dates must be YYYY-MM-DD." };
  }
  const nights = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (nights < 1) {
    return { ok: false, status: 400, code: "INVALID_DATES", error: "Check-out must be after check-in." };
  }
  if (nights > opts.maxNights) {
    return { ok: false, status: 400, code: "STAY_TOO_LONG", error: `At most ${opts.maxNights} nights per request.` };
  }
  if (nights < opts.minNights) {
    return { ok: false, status: 400, code: "MIN_STAY", error: `Minimum stay is ${opts.minNights} night(s).` };
  }
  if (fromUtc.getTime() < opts.businessDate.getTime()) {
    return {
      ok: false,
      status: 400,
      code: "ARRIVAL_IN_PAST",
      error: `Arrival cannot be before ${opts.businessDate.toISOString().slice(0, 10)}.`,
    };
  }
  const ceiling = opts.businessDate.getTime() + opts.maxNightsAhead * DAY_MS;
  if (toUtc.getTime() > ceiling) {
    return {
      ok: false,
      status: 400,
      code: "TOO_FAR_AHEAD",
      error: `Stays can be booked at most ${opts.maxNightsAhead} nights ahead.`,
    };
  }
  return { ok: true, from, to, fromUtc, toUtc, nights };
}

export async function computeWebsiteAvailability(opts: {
  propertyId: string;
  from: string;
  to: string;
  /** Restrict to one room type (the quote/booking path). */
  roomTypeId?: string;
}): Promise<{ ok: true; availability: WebsiteAvailability } | { ok: false } & AvailabilityWindowError> {
  const property = await prisma.property.findFirst({
    where: { id: opts.propertyId, status: "ACTIVE" },
    select: {
      id: true,
      defaultCurrency: true,
      pricesIncludeTaxes: true,
      businessDate: true,
      websiteSettings: {
        select: {
          bookingEnabled: true,
          minNights: true,
          maxNightsAhead: true,
          ratePlan: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  if (!property) return { ok: false, status: 404, code: "PROPERTY_NOT_FOUND", error: "Property not found." };

  const settings = property.websiteSettings;
  const window = validateStayWindow({
    from: opts.from,
    to: opts.to,
    businessDate: resolveBusinessDate(property),
    // The calendar view should not be blocked by the minimum stay — a site may show a
    // single night's price even when it sells two-night minimums. Only quote/booking
    // enforce minNights; here it is 1.
    minNights: 1,
    maxNightsAhead: settings?.maxNightsAhead ?? 365,
    maxNights: MAX_AVAILABILITY_NIGHTS,
  });
  if (!window.ok) return window;

  const roomTypes = await prisma.roomType.findMany({
    where: {
      propertyId: property.id,
      isActive: true,
      isPseudo: false,
      ...(opts.roomTypeId ? { id: opts.roomTypeId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, baseOccupancy: true, maxOccupancy: true },
  });

  // One query for every stop-sale in the window. roomTypeId null = property-wide.
  const restrictions = await prisma.availabilityRestriction.findMany({
    where: { propertyId: property.id, date: { gte: window.fromUtc, lt: window.toUtc } },
    select: { roomTypeId: true, date: true },
  });
  const closedDates = new Set<string>();
  for (const r of restrictions) closedDates.add(`${r.roomTypeId ?? "*"}|${formatLocalDay(r.date.getTime())}`);
  const isClosed = (roomTypeId: string, date: string) =>
    closedDates.has(`*|${date}`) || closedDates.has(`${roomTypeId}|${date}`);

  const ratePlan = settings?.ratePlan ?? null;
  const prices = ratePlan
    ? await resolveWebsiteNightlyPrices({
        propertyId: property.id,
        ratePlanId: ratePlan.id,
        roomTypeIds: roomTypes.map((rt) => rt.id),
        from: window.fromUtc,
        to: window.toUtc,
      })
    : new Map();

  const out: WebsiteRoomTypeAvailability[] = [];
  for (const rt of roomTypes) {
    const perNight = await perNightTypeAvailability({
      propertyId: property.id,
      roomTypeId: rt.id,
      startDate: window.from,
      endDate: window.to,
      blockStatusIn: BLOCK_STATUSES_THAT_HOLD,
    });
    const priceByDate = prices.get(rt.id);
    let minAvailable = Number.POSITIVE_INFINITY;
    let allPriced = true;
    let roomRateTotal = 0;
    const nights: WebsiteNight[] = perNight.map((n) => {
      const closed = isClosed(rt.id, n.date);
      const available = closed ? 0 : n.available;
      const price = priceByDate?.get(n.date);
      if (price?.price == null) allPriced = false;
      else roomRateTotal += price.price;
      minAvailable = Math.min(minAvailable, available);
      return {
        date: n.date,
        available,
        closed,
        price: price?.price ?? null,
        extraAdultPrice: price?.extraAdultPrice ?? null,
        extraChildPrice: price?.extraChildPrice ?? null,
      };
    });
    if (!Number.isFinite(minAvailable)) minAvailable = 0;
    out.push({
      id: rt.id,
      code: rt.code,
      name: rt.name,
      baseOccupancy: rt.baseOccupancy,
      maxOccupancy: rt.maxOccupancy,
      nights,
      minAvailable,
      bookable: !!ratePlan && minAvailable > 0 && allPriced,
      roomRateTotal: allPriced ? Math.round(roomRateTotal * 100) / 100 : null,
    });
  }

  return {
    ok: true,
    availability: {
      propertyId: property.id,
      from: opts.from,
      to: opts.to,
      nights: window.nights,
      currency: property.defaultCurrency,
      pricesIncludeTaxes: property.pricesIncludeTaxes,
      ratePlan,
      bookingEnabled: !!settings?.bookingEnabled && !!ratePlan,
      roomTypes: out,
    },
  };
}
