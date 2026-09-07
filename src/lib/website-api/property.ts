import { prisma } from "@/lib/db";
import { resolveBusinessDate } from "@/lib/business-date";

// The property as a brand website sees it. Shaped narrowly and deliberately: identity,
// location, contact, policies, sellable room types with their features, and the booking
// configuration the Hub set. Nothing operational (business date is the one exception —
// the site needs "today" to know the earliest bookable arrival), nothing about other
// properties, nothing about rates (those come from the availability endpoint).

export type PublicRoomTypeFeature = { category: string; code: string; label: string };

export type PublicRoomType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  baseOccupancy: number;
  maxOccupancy: number;
  /** Physical sellable rooms of this type right now — informational only. */
  totalRooms: number;
  features: PublicRoomTypeFeature[];
};

export type PublicMealPlan = {
  code: string;
  name: string;
  /** The one a booking uses when the guest expresses no preference. */
  isDefault: boolean;
};

/**
 * A paid extra the guest can tick — a transfer, a spa treatment, a set dinner.
 *
 * No price here on purpose. What an allocation costs depends on the party and the length
 * of stay (per adult, per child, and on its own posting rhythm — every night, arrival
 * night, departure night), so a single figure on a catalogue entry would be a number that
 * is right for nobody. Send the selection to the quote endpoint and show the line it
 * returns, which is the same arithmetic Night Audit will post.
 */
export type PublicAddOn = {
  id: string;
  code: string;
  name: string;
  /** FNB | TRANSFER | SPA | EXCURSION | OTHER — for grouping on the site. */
  type: string;
  /** EVERY_NIGHT | ARRIVAL_NIGHT | DEPARTURE_NIGHT — how often it is charged. */
  postingRhythm: string;
};

export type PublicPropertyBooking = {
  /** False when the Hub has disabled booking or has not chosen a rate plan to sell. */
  enabled: boolean;
  /** Human-readable reason when enabled is false. */
  reason: string | null;
  ratePlan: { id: string; code: string; name: string } | null;
  /** The meal plan a booking uses unless the guest picks another. */
  mealPlanCode: string;
  /** Whether the guest may choose their meal plan at all. */
  mealPlanSelectable: boolean;
  /**
   * Whether choosing a different meal plan changes the price. True when the property
   * prices per person off the meal plan's linked allocations; false when the rate plan
   * carries the price and the meal plan is a label. Say so honestly on the site rather
   * than implying a choice costs something when it does not.
   */
  mealPlanAffectsPrice: boolean;
  mealPlans: PublicMealPlan[];
  /** Optional paid extras. Empty when the property does not sell any online. */
  addOns: PublicAddOn[];
  minNights: number;
  maxNightsAhead: number;
};

export type PublicPropertySummary = {
  id: string;
  code: string;
  name: string;
  headline: string | null;
  currency: string;
  timeZone: string;
  starRating: number | null;
  imageUrl: string | null;
  bookingEnabled: boolean;
};

export type PublicProperty = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  headline: string | null;
  description: string | null;
  imageUrls: string[];
  logoUrl: string | null;
  brandColor: string | null;
  starRating: number | null;
  address: string | null;
  location: { latitude: number; longitude: number } | null;
  contact: { phone: string | null; email: string | null };
  checkInTime: string;
  checkOutTime: string;
  currency: string;
  timeZone: string;
  /** Whether displayed and quoted prices already include taxes. */
  pricesIncludeTaxes: boolean;
  /** The property's operational "today" (YYYY-MM-DD) — the earliest arrival it will accept. */
  businessDate: string;
  policies: string | null;
  facilities: { name: string; description: string | null }[];
  roomTypes: PublicRoomType[];
  booking: PublicPropertyBooking;
};

const DEFAULT_SETTINGS = { minNights: 1, maxNightsAhead: 365, mealPlanCode: "NONE", bookingEnabled: true };

function bookingFrom(
  settings: {
    bookingEnabled: boolean;
    ratePlan: { id: string; code: string; name: string } | null;
    mealPlanCode: string;
    offerMealPlans: boolean;
    offerAddOns: boolean;
    minNights: number;
    maxNightsAhead: number;
  } | null,
  catalogue: { mealPlans: PublicMealPlan[]; addOns: PublicAddOn[]; mealPlanAffectsPrice: boolean }
): PublicPropertyBooking {
  const empty = {
    ratePlan: null,
    mealPlanCode: DEFAULT_SETTINGS.mealPlanCode,
    mealPlanSelectable: false,
    mealPlanAffectsPrice: catalogue.mealPlanAffectsPrice,
    mealPlans: [] as PublicMealPlan[],
    addOns: [] as PublicAddOn[],
    minNights: DEFAULT_SETTINGS.minNights,
    maxNightsAhead: DEFAULT_SETTINGS.maxNightsAhead,
  };
  if (!settings) {
    return { enabled: false, reason: "Online booking has not been set up for this property.", ...empty };
  }

  // A choice is only offered when the Hub switched it on AND there is more than one thing
  // to choose between — a single meal plan rendered as a picker is a control that does
  // nothing.
  const mealPlanSelectable = settings.offerMealPlans && catalogue.mealPlans.length > 1;
  const base = {
    ratePlan: settings.ratePlan,
    mealPlanCode: settings.mealPlanCode,
    mealPlanSelectable,
    mealPlanAffectsPrice: catalogue.mealPlanAffectsPrice,
    mealPlans: mealPlanSelectable ? catalogue.mealPlans : [],
    addOns: settings.offerAddOns ? catalogue.addOns : [],
    minNights: settings.minNights,
    maxNightsAhead: settings.maxNightsAhead,
  };
  if (!settings.bookingEnabled) return { enabled: false, reason: "Online booking is currently switched off.", ...base };
  if (!settings.ratePlan) return { enabled: false, reason: "No rate plan has been chosen for online booking.", ...base };
  return { enabled: true, reason: null, ...base };
}

export async function listPublicProperties(propertyIds: string[]): Promise<PublicPropertySummary[]> {
  if (propertyIds.length === 0) return [];
  const rows = await prisma.property.findMany({
    where: { id: { in: propertyIds }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      defaultCurrency: true,
      timeZone: true,
      starRating: true,
      websiteSettings: {
        select: { headline: true, imageUrls: true, bookingEnabled: true, ratePlanId: true },
      },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    headline: p.websiteSettings?.headline ?? null,
    currency: p.defaultCurrency,
    timeZone: p.timeZone,
    starRating: p.starRating,
    imageUrl: p.websiteSettings?.imageUrls[0] ?? null,
    bookingEnabled: !!p.websiteSettings?.bookingEnabled && !!p.websiteSettings?.ratePlanId,
  }));
}

export async function getPublicProperty(propertyId: string): Promise<PublicProperty | null> {
  const p = await prisma.property.findFirst({
    where: { id: propertyId, status: "ACTIVE" },
    select: {
      id: true,
      enterpriseId: true,
      code: true,
      name: true,
      legalName: true,
      logoUrl: true,
      bannerColor: true,
      starRating: true,
      address: true,
      latitude: true,
      longitude: true,
      contactPhone: true,
      contactEmail: true,
      checkInTime: true,
      checkOutTime: true,
      defaultCurrency: true,
      timeZone: true,
      pricesIncludeTaxes: true,
      allocationCalculationMode: true,
      businessDate: true,
      mealPlans: { where: { isActive: true }, orderBy: { name: "asc" }, select: { code: true, name: true } },
      // The add-on catalogue. `sellSeparate` is the owner-set flag meaning "can be
      // attached to a reservation on its own" — the same list the desk's Add-ons picker
      // offers, not a second one configured for the website.
      allocations: {
        where: { isActive: true, sellSeparate: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, code: true, name: true, type: true, postingRhythm: true },
      },
      facilities: { select: { name: true, description: true }, orderBy: { name: "asc" } },
      websiteSettings: {
        select: {
          headline: true,
          description: true,
          imageUrls: true,
          policies: true,
          bookingEnabled: true,
          mealPlanCode: true,
          offerMealPlans: true,
          offerAddOns: true,
          minNights: true,
          maxNightsAhead: true,
          ratePlan: { select: { id: true, code: true, name: true } },
        },
      },
      roomTypes: {
        where: { isActive: true, isPseudo: false },
        orderBy: { name: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          baseOccupancy: true,
          maxOccupancy: true,
          features: { select: { category: true, code: true } },
          _count: { select: { rooms: { where: { status: { notIn: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } } } } },
        },
      },
    },
  });
  if (!p) return null;

  // Feature codes resolve to display labels through the enterprise's own SystemCode LOV
  // (BED_TYPE / ROOM_VIEW / ROOM_AMENITY). One query for every code the property uses.
  const codes = new Set<string>();
  for (const rt of p.roomTypes) for (const f of rt.features) codes.add(`${f.category}|${f.code}`);
  const labels = new Map<string, string>();
  if (codes.size > 0) {
    const rows = await prisma.systemCode.findMany({
      where: {
        enterpriseId: p.enterpriseId,
        category: { in: ["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"] },
      },
      select: { category: true, code: true, value: true },
    });
    for (const r of rows) labels.set(`${r.category}|${r.code}`, r.value);
  }

  return {
    id: p.id,
    code: p.code,
    name: p.name,
    legalName: p.legalName,
    headline: p.websiteSettings?.headline ?? null,
    description: p.websiteSettings?.description ?? null,
    imageUrls: p.websiteSettings?.imageUrls ?? [],
    logoUrl: p.logoUrl,
    brandColor: p.bannerColor,
    starRating: p.starRating,
    address: p.address,
    location: p.latitude != null && p.longitude != null ? { latitude: p.latitude, longitude: p.longitude } : null,
    contact: { phone: p.contactPhone, email: p.contactEmail },
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    currency: p.defaultCurrency,
    timeZone: p.timeZone,
    pricesIncludeTaxes: p.pricesIncludeTaxes,
    businessDate: resolveBusinessDate(p).toISOString().slice(0, 10),
    policies: p.websiteSettings?.policies ?? null,
    facilities: p.facilities,
    roomTypes: p.roomTypes.map((rt) => ({
      id: rt.id,
      code: rt.code,
      name: rt.name,
      description: rt.description,
      baseOccupancy: rt.baseOccupancy,
      maxOccupancy: rt.maxOccupancy,
      totalRooms: rt._count.rooms,
      features: rt.features.map((f) => ({
        category: f.category,
        code: f.code,
        label: labels.get(`${f.category}|${f.code}`) ?? f.code,
      })),
    })),
    booking: bookingFrom(p.websiteSettings ?? null, {
      mealPlans: p.mealPlans.map((m) => ({
        code: m.code,
        name: m.name,
        isDefault: m.code === (p.websiteSettings?.mealPlanCode ?? "NONE"),
      })),
      addOns: p.allocations,
      // Under RATE_PLAN the rate plan carries the price and the meal plan is a label; only
      // MEAL_PLAN mode makes the choice cost anything. See Property.allocationCalculationMode.
      mealPlanAffectsPrice: p.allocationCalculationMode === "MEAL_PLAN",
    }),
  };
}
