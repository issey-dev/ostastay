import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { resolveBusinessDate } from "@/lib/business-date";
import { computeReservationQuote, type ReservationQuote } from "@/lib/reservation-quote-server";
import { createReservation } from "@/lib/reservations/create-reservation";
import { systemContext } from "@/lib/reservations/system-context";
import { resolveGuestProfile } from "@/lib/profiles/resolve-guest-profile";
import { computeWebsiteAvailability, validateStayWindow } from "@/lib/website-api/availability";
import type { ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";

// Quote and book a stay from a property's brand website.
//
// A website booking goes through createReservation (src/lib/reservations/create-reservation.ts)
// — the exact service the front desk and the channel conversion use — so it obeys every
// rule a desk booking obeys: stop-sale is a hard block, the arrival floor is the property's
// business date, the confirmation number comes from the Sequence Manager, a master folio
// is opened, and the activity log records it.
//
// Two deliberate differences from the channel-conversion caller:
//   - NO acknowledgeOverbook. A channel has already confirmed the stay to the guest, so an
//     overbook is accepted and flagged (D-7 rule 4). The website is OUR OWN storefront and
//     has not confirmed anything yet — so a stay that no longer fits is refused with
//     SOLD_OUT and the guest picks other dates. The website can never overbook.
//   - NO allowPastArrival. Nothing has been promised; a past arrival is simply invalid.
//
// A stay with any UNPRICED night is refused (NO_RATE) rather than confirmed: Night Audit
// would post that night at 0, and a confirmation at a price the desk never intended is
// worse than a "please contact us" on the site.

export type WebsiteStayInput = {
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  roomTypeId: string;
  adults: number;
  children: number;
  /** Omitted = the property's configured default. Only honoured when it offers a choice. */
  mealPlanCode?: string | null;
  /** Optional paid extras, by allocation id. Only honoured when the property offers them. */
  addOnIds?: string[];
};

export type WebsiteGuestInput = {
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
};

export type WebsiteQuote = {
  propertyId: string;
  roomType: { id: string; code: string; name: string };
  ratePlan: { id: string; code: string; name: string };
  mealPlanCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  currency: string;
  pricesIncludeTaxes: boolean;
  /** Whether the stay could be booked right now (stock, stop-sale, pricing). */
  available: boolean;
  /** Rooms of this type free for every night of the stay. */
  roomsAvailable: number;
  totals: {
    roomBase: number;
    extraOccupancy: number;
    /** Everything the rate plan or meal plan includes, plus any extras the guest ticked. */
    packageAllocations: number;
    taxes: number;
    greenTax: number;
    grandTotal: number;
  };
  /**
   * Every allocation on this stay, itemised. `source` says WHY each one is here:
   * RATE_PLAN or MEAL_PLAN means it came with what the guest chose (show it as included),
   * MANUAL means they ticked it (show it as an extra they can untick).
   *
   * `mode` matters for wording: INCLUDE_IN_RATE is carved out of the room line, so its
   * amount is already inside roomBase and must NOT be added again; ADD_TO_RATE sits on
   * top. grandTotal is correct either way.
   */
  allocations: {
    id: string;
    code: string;
    name: string;
    source: "RATE_PLAN" | "MEAL_PLAN" | "MANUAL";
    mode: string;
    amount: number;
  }[];
  taxLines: { name: string; ratePercent: number; amount: number }[];
  nightly: { date: string; rate: number; roomCharge: number; taxes: number; total: number }[];
  warnings: string[];
};

export type StayFailure = { ok: false; status: number; code: string; error: string };

type StayContext = {
  property: {
    id: string;
    enterpriseId: string;
    name: string;
    code: string;
    defaultCurrency: string;
    pricesIncludeTaxes: boolean;
    checkInTime: string;
    checkOutTime: string;
  };
  settings: {
    bookingEnabled: boolean;
    mealPlanCode: string;
    minNights: number;
    maxNightsAhead: number;
    deskRemark: string | null;
    ratePlan: { id: string; code: string; name: string };
  };
  roomType: { id: string; code: string; name: string; maxOccupancy: number };
  /** The meal plan this stay is actually on, after applying the guest's choice (or not). */
  mealPlanCode: string;
  /** Allocation ids the guest ticked, after validation. */
  addOnIds: string[];
  nights: number;
  fromUtc: Date;
  toUtc: Date;
};

async function loadStayContext(propertyId: string, stay: WebsiteStayInput): Promise<{ ok: true; ctx: StayContext } | StayFailure> {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, status: "ACTIVE" },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
      code: true,
      defaultCurrency: true,
      pricesIncludeTaxes: true,
      checkInTime: true,
      checkOutTime: true,
      businessDate: true,
      websiteSettings: {
        select: {
          bookingEnabled: true,
          mealPlanCode: true,
          offerMealPlans: true,
          offerAddOns: true,
          minNights: true,
          maxNightsAhead: true,
          deskRemark: true,
          ratePlan: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  if (!property) return { ok: false, status: 404, code: "PROPERTY_NOT_FOUND", error: "Property not found." };

  const settings = property.websiteSettings;
  if (!settings || !settings.bookingEnabled) {
    return { ok: false, status: 409, code: "BOOKING_DISABLED", error: "Online booking is not available for this property." };
  }
  if (!settings.ratePlan) {
    return { ok: false, status: 409, code: "BOOKING_DISABLED", error: "Online booking is not configured for this property." };
  }

  const window = validateStayWindow({
    from: stay.checkIn,
    to: stay.checkOut,
    businessDate: resolveBusinessDate(property),
    minNights: settings.minNights,
    maxNightsAhead: settings.maxNightsAhead,
    maxNights: 62,
  });
  if (!window.ok) return { ok: false, status: window.status, code: window.code, error: window.error };

  const roomType = await prisma.roomType.findFirst({
    where: { id: stay.roomTypeId, propertyId: property.id, isActive: true, isPseudo: false },
    select: { id: true, code: true, name: true, maxOccupancy: true },
  });
  if (!roomType) return { ok: false, status: 404, code: "ROOM_TYPE_NOT_FOUND", error: "Room type not found." };

  if (!Number.isInteger(stay.adults) || stay.adults < 1) {
    return { ok: false, status: 400, code: "INVALID_OCCUPANCY", error: "At least one adult is required." };
  }
  if (!Number.isInteger(stay.children) || stay.children < 0) {
    return { ok: false, status: 400, code: "INVALID_OCCUPANCY", error: "Children cannot be negative." };
  }
  if (stay.adults + stay.children > roomType.maxOccupancy) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_OCCUPANCY",
      error: `${roomType.name} sleeps at most ${roomType.maxOccupancy}.`,
    };
  }

  // ── The guest's choices ────────────────────────────────────────────────────────
  //
  // Both are validated against what this property actually offers, not merely against
  // what exists: a site that sends a meal plan the Hub never opened up, or an allocation
  // from another property, is refused rather than quietly ignored. Silently dropping a
  // choice would quote one thing and book another.
  let mealPlanCode = settings.mealPlanCode;
  const requestedMealPlan = stay.mealPlanCode?.trim();
  if (requestedMealPlan && requestedMealPlan !== mealPlanCode) {
    if (!settings.offerMealPlans) {
      return { ok: false, status: 409, code: "MEAL_PLAN_NOT_OFFERED", error: "This property does not offer a choice of meal plan online." };
    }
    // "NONE" is the app-wide "no meal plan" sentinel and is always selectable; anything
    // else has to be one of this property's own active plans.
    if (requestedMealPlan !== "NONE") {
      const plan = await prisma.mealPlan.findFirst({
        where: { propertyId: property.id, code: requestedMealPlan, isActive: true },
        select: { code: true },
      });
      if (!plan) return { ok: false, status: 400, code: "MEAL_PLAN_NOT_FOUND", error: "That meal plan is not available at this property." };
    }
    mealPlanCode = requestedMealPlan;
  }

  const requestedAddOns = [...new Set((stay.addOnIds ?? []).filter((id) => typeof id === "string" && id))];
  let addOnIds: string[] = [];
  if (requestedAddOns.length > 0) {
    if (!settings.offerAddOns) {
      return { ok: false, status: 409, code: "ADD_ONS_NOT_OFFERED", error: "This property does not offer extras online." };
    }
    const allowed = await prisma.allocation.findMany({
      // sellSeparate is the owner-set flag for "can be attached on its own" — the same
      // gate the desk's Add-ons picker uses. An allocation that is only ever part of a
      // package cannot be bought separately here either.
      where: { id: { in: requestedAddOns }, propertyId: property.id, isActive: true, sellSeparate: true },
      select: { id: true },
    });
    if (allowed.length !== requestedAddOns.length) {
      return { ok: false, status: 400, code: "ADD_ON_NOT_FOUND", error: "One or more of the extras chosen is not available at this property." };
    }
    addOnIds = allowed.map((a) => a.id);
  }

  return {
    ok: true,
    ctx: {
      property,
      settings: { ...settings, ratePlan: settings.ratePlan },
      roomType,
      mealPlanCode,
      addOnIds,
      nights: window.nights,
      fromUtc: window.fromUtc,
      toUtc: window.toUtc,
    },
  };
}

function shapeQuote(ctx: StayContext, stay: WebsiteStayInput, quote: ReservationQuote, roomsAvailable: number, unpricedNights: number): WebsiteQuote {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const t = quote.totals;
  return {
    propertyId: ctx.property.id,
    roomType: { id: ctx.roomType.id, code: ctx.roomType.code, name: ctx.roomType.name },
    ratePlan: ctx.settings.ratePlan,
    mealPlanCode: ctx.mealPlanCode,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    nights: quote.nights,
    adults: stay.adults,
    children: stay.children,
    currency: ctx.property.defaultCurrency,
    pricesIncludeTaxes: quote.pricesIncludeTaxes,
    available: roomsAvailable > 0 && unpricedNights === 0,
    roomsAvailable,
    totals: {
      roomBase: round2(t.roomBase),
      extraOccupancy: round2(t.extraOccupancyBase),
      packageAllocations: round2(t.allocationsBase),
      taxes: round2(t.taxTotal),
      greenTax: round2(t.greenTaxTotal),
      grandTotal: round2(t.grandTotal),
    },
    allocations: quote.allocations.map((a) => ({
      id: a.allocationId,
      code: a.code,
      name: a.name,
      source: a.source,
      mode: a.mode,
      // base + tax + service charge: what this line adds to the bill, which is the figure
      // a guest is being asked to agree to. INCLUDE_IN_RATE lines are carved out of the
      // room line rather than added on top — see the field's docblock.
      amount: round2(a.base + a.tax + a.serviceCharge),
    })),
    taxLines: quote.taxLines.map((l) => ({ name: l.name, ratePercent: l.ratePercent, amount: round2(l.amount) })),
    nightly: quote.days.map((d) => ({
      date: d.date,
      rate: round2(d.rate),
      roomCharge: round2(d.roomCharge),
      taxes: round2(d.taxes),
      total: round2(d.total),
    })),
    warnings: [
      ...quote.warnings,
      ...(unpricedNights > 0 ? [`${unpricedNights} night(s) have no rate configured — this stay cannot be booked online.`] : []),
    ],
  };
}

type QuoteOutcome = {
  quote: WebsiteQuote;
  unpricedNights: number;
  /** Nights under a stop-sale — reported before "sold out", since the cause differs. */
  closedNights: number;
  /** The enterprise has no accommodation charge code, so nothing can be priced at all. */
  misconfigured: boolean;
};

async function quoteFor(ctx: StayContext, stay: WebsiteStayInput): Promise<QuoteOutcome> {
  const [availability, raw] = await Promise.all([
    computeWebsiteAvailability({ propertyId: ctx.property.id, from: stay.checkIn, to: stay.checkOut, roomTypeId: ctx.roomType.id }),
    computeReservationQuote({
      propertyId: ctx.property.id,
      assignments: [
        {
          roomTypeId: ctx.roomType.id,
          ratePlanId: ctx.settings.ratePlan.id,
          startDate: ctx.fromUtc,
          endDate: ctx.toUtc,
        },
      ],
      adults: stay.adults,
      children: stay.children,
      mealPlanCode: ctx.mealPlanCode,
      manualAllocationIds: ctx.addOnIds,
    }),
  ]);
  const rt = availability.ok ? availability.availability.roomTypes[0] : undefined;
  const roomsAvailable = rt?.minAvailable ?? 0;
  const closedNights = rt?.nights.filter((n) => n.closed).length ?? 0;
  // computeReservationQuote skips pricing entirely (and does not count the nights as
  // unpriced) when the enterprise has no accommodation charge code — it only warns. To the
  // website that is the same as "no rate": nothing can be confirmed at a real price.
  const misconfigured = raw.warnings.some((w) => /accommodation charge code/i.test(w));
  const unpricedNights = misconfigured ? raw.nights : raw.segments.reduce((s, seg) => s + seg.unpricedNights, 0);
  return { quote: shapeQuote(ctx, stay, raw, roomsAvailable, unpricedNights), unpricedNights, closedNights, misconfigured };
}

export async function quoteWebsiteStay(propertyId: string, stay: WebsiteStayInput): Promise<{ ok: true; quote: WebsiteQuote } | StayFailure> {
  const loaded = await loadStayContext(propertyId, stay);
  if (!loaded.ok) return loaded;
  const { quote } = await quoteFor(loaded.ctx, stay);
  return { ok: true, quote };
}

export type WebsiteBookingResult = {
  bookingId: string;
  confirmationNo: string;
  reservationId: string;
  status: string;
  /** True when this response replays an earlier booking made with the same Idempotency-Key. */
  replayed: boolean;
  property: { id: string; name: string; checkInTime: string; checkOutTime: string };
  guest: { firstName: string; lastName: string | null; email: string };
  quote: WebsiteQuote;
};

export async function createWebsiteBooking(opts: {
  key: ResolvedWebsiteKey;
  propertyId: string;
  stay: WebsiteStayInput;
  guest: WebsiteGuestInput;
  remarks: string | null;
  idempotencyKey: string | null;
  requestIp: string | null;
}): Promise<{ ok: true; booking: WebsiteBookingResult } | StayFailure> {
  const { key, propertyId, stay, remarks, idempotencyKey, requestIp } = opts;
  const guest = {
    firstName: opts.guest.firstName.trim(),
    lastName: opts.guest.lastName?.trim() || null,
    email: opts.guest.email.trim().toLowerCase(),
    phone: opts.guest.phone?.trim() || null,
  };

  // Idempotent replay: the same key + Idempotency-Key answers with the SAME booking.
  if (idempotencyKey) {
    const existing = await prisma.websiteBooking.findUnique({
      where: { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } },
      select: { id: true, status: true, reservationId: true, propertyId: true },
    });
    if (existing?.status === "CONFIRMED" && existing.reservationId) {
      if (existing.propertyId !== propertyId) {
        return { ok: false, status: 409, code: "IDEMPOTENCY_CONFLICT", error: "This Idempotency-Key was already used for a different request." };
      }
      const replay = await buildResult(existing.id, true);
      if (replay) return { ok: true, booking: replay };
    }
  }

  const loaded = await loadStayContext(propertyId, stay);
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;

  const { quote, unpricedNights, closedNights } = await quoteFor(ctx, stay);

  // The audit row's id doubles as the desk-searchable reference (Reservation.externalRef).
  const bookingId = randomUUID();
  const externalRef = `WEB-${bookingId.slice(0, 8).toUpperCase()}`;

  const baseRow = {
    id: bookingId,
    enterpriseId: ctx.property.enterpriseId,
    propertyId: ctx.property.id,
    keyId: key.id,
    idempotencyKey,
    guestFirstName: guest.firstName,
    guestLastName: guest.lastName,
    guestEmail: guest.email,
    guestPhone: guest.phone,
    arrival: ctx.fromUtc,
    departure: ctx.toUtc,
    roomTypeId: ctx.roomType.id,
    adults: stay.adults,
    children: stay.children,
    remarks: remarks?.trim() || null,
    mealPlanCode: ctx.mealPlanCode,
    addOnIds: ctx.addOnIds,
    quotedTotal: quote.totals.grandTotal,
    currency: ctx.property.defaultCurrency,
    requestIp,
  };

  // Pre-checks. createReservation would refuse these too; checking first gives the site
  // a specific code, and every refusal is recorded so the Hub can see what was attempted.
  if (unpricedNights > 0) {
    const error = "One or more nights have no rate configured. Please contact the property.";
    await recordFailure(baseRow, error);
    return { ok: false, status: 409, code: "NO_RATE", error };
  }
  if (closedNights > 0) {
    const error = "The property is not accepting bookings for one or more of the selected dates.";
    await recordFailure(baseRow, error);
    return { ok: false, status: 409, code: "STOP_SALE", error };
  }
  if (quote.roomsAvailable < 1) {
    const error = "No rooms of this type are available for the selected dates.";
    await recordFailure(baseRow, error);
    return { ok: false, status: 409, code: "SOLD_OUT", error };
  }

  const primaryGuestId = await resolveGuestProfile({
    enterpriseId: ctx.property.enterpriseId,
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email,
    phone: guest.phone,
    originPropertyId: ctx.property.id,
  });

  const remarkLines = [
    `Booked via website (ref ${externalRef})`,
    ctx.settings.deskRemark?.trim() || null,
    remarks?.trim() ? `Guest remarks: ${remarks.trim()}` : null,
    guest.phone ? `Phone: ${guest.phone}` : null,
  ].filter(Boolean) as string[];

  const result = await createReservation(systemContext(ctx.property.enterpriseId, `website-key:${key.id}`), {
    propertyId: ctx.property.id,
    primaryGuestId,
    checkInDate: stay.checkIn,
    checkOutDate: stay.checkOut,
    roomTypeId: ctx.roomType.id,
    ratePlanId: ctx.settings.ratePlan.id,
    adults: stay.adults,
    children: stay.children,
    mealPlan: ctx.mealPlanCode,
    // The extras the guest ticked, attached exactly as the desk's Add-ons picker attaches
    // them, so Night Audit posts them without knowing where the booking came from.
    manualAllocationIds: ctx.addOnIds,
    remarks: remarkLines.join("\n"),
    externalRef,
    // Deliberately absent: acknowledgeOverbook, allowPastArrival — see the file header.
  });

  if (!result.ok) {
    // Record the attempt (a FAILED row is replaced on retry with the same Idempotency-Key)
    // so the Hub can see what the site tried and why it was refused.
    await recordFailure(baseRow, result.error);
    if (result.status === 409) {
      const code = result.requiresOverbookConfirm ? "SOLD_OUT" : "STOP_SALE";
      const error = result.requiresOverbookConfirm
        ? "No rooms of this type are available for the selected dates."
        : "The property is not accepting bookings for one or more of the selected dates.";
      return { ok: false, status: 409, code, error };
    }
    return { ok: false, status: result.status, code: "BOOKING_REJECTED", error: result.error };
  }

  await prisma.websiteBooking.upsert({
    where: idempotencyKey ? { keyId_idempotencyKey: { keyId: key.id, idempotencyKey } } : { id: bookingId },
    create: { ...baseRow, status: "CONFIRMED", reservationId: result.reservation.id, problem: null },
    update: { ...baseRow, status: "CONFIRMED", reservationId: result.reservation.id, problem: null },
  });

  const booking = await buildResult(bookingId, false);
  if (!booking) {
    // The reservation exists (the desk can see it by externalRef); only the response
    // assembly failed. Report it honestly rather than pretend nothing was booked.
    return { ok: false, status: 500, code: "INTERNAL_ERROR", error: `Booking was created (ref ${externalRef}) but could not be returned. Please contact the property.` };
  }
  return { ok: true, booking };
}

async function recordFailure(row: Parameters<typeof prisma.websiteBooking.create>[0]["data"] & { id: string; keyId: string; idempotencyKey: string | null }, problem: string) {
  const data = { ...row, status: "FAILED", reservationId: null, problem };
  try {
    if (row.idempotencyKey) {
      await prisma.websiteBooking.upsert({
        where: { keyId_idempotencyKey: { keyId: row.keyId, idempotencyKey: row.idempotencyKey } },
        create: data,
        update: { ...data, id: undefined },
      });
    } else {
      await prisma.websiteBooking.create({ data });
    }
  } catch (e) {
    console.error("Failed to record website booking attempt:", e);
  }
}

/** Look up a booking the site made earlier. Email must match — the confirmation number alone is not a secret. */
export async function lookupWebsiteBooking(opts: {
  key: ResolvedWebsiteKey;
  confirmationNo: string;
  email: string;
}): Promise<{ ok: true; booking: WebsiteBookingResult } | StayFailure> {
  const email = opts.email.trim().toLowerCase();
  const row = await prisma.websiteBooking.findFirst({
    where: {
      keyId: opts.key.id,
      status: "CONFIRMED",
      guestEmail: email,
      reservation: { confirmationNo: opts.confirmationNo.trim() },
    },
    select: { id: true },
  });
  if (!row) return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", error: "No booking matches that confirmation number and email." };
  const booking = await buildResult(row.id, false);
  if (!booking) return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", error: "No booking matches that confirmation number and email." };
  return { ok: true, booking };
}

async function buildResult(websiteBookingId: string, replayed: boolean): Promise<WebsiteBookingResult | null> {
  const row = await prisma.websiteBooking.findUnique({
    where: { id: websiteBookingId },
    include: {
      reservation: { select: { id: true, confirmationNo: true, status: true } },
      property: { select: { id: true, name: true, checkInTime: true, checkOutTime: true } },
    },
  });
  if (!row?.reservation) return null;

  const stay: WebsiteStayInput = {
    checkIn: row.arrival.toISOString().slice(0, 10),
    checkOut: row.departure.toISOString().slice(0, 10),
    roomTypeId: row.roomTypeId,
    adults: row.adults,
    children: row.children,
    // Re-quote on what was actually booked, not on today's defaults — otherwise a guest
    // who chose Half Board and an airport transfer is shown a total for neither.
    mealPlanCode: row.mealPlanCode,
    addOnIds: row.addOnIds,
  };
  // Re-quote from the live reservation so the figures always match what the desk sees.
  // If the property's website settings changed since (e.g. rate plan removed), fall back
  // to the figure quoted at booking time rather than fail the lookup.
  const requoted = await quoteWebsiteStay(row.propertyId, stay).catch(() => null);
  const quote: WebsiteQuote = requoted && requoted.ok
    ? requoted.quote
    : {
        propertyId: row.propertyId,
        roomType: { id: row.roomTypeId, code: "", name: "" },
        ratePlan: { id: "", code: "", name: "" },
        mealPlanCode: row.mealPlanCode ?? "NONE",
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        nights: Math.round((row.departure.getTime() - row.arrival.getTime()) / 86_400_000),
        adults: row.adults,
        children: row.children,
        currency: row.currency ?? "",
        pricesIncludeTaxes: true,
        available: true,
        roomsAvailable: 0,
        totals: { roomBase: 0, extraOccupancy: 0, packageAllocations: 0, taxes: 0, greenTax: 0, grandTotal: row.quotedTotal ?? 0 },
        allocations: [],
        taxLines: [],
        nightly: [],
        warnings: ["Live pricing is unavailable; showing the total quoted at booking time."],
      };

  return {
    bookingId: row.id,
    confirmationNo: row.reservation.confirmationNo,
    reservationId: row.reservation.id,
    status: row.reservation.status,
    replayed,
    property: row.property,
    guest: { firstName: row.guestFirstName, lastName: row.guestLastName, email: row.guestEmail },
    quote: { ...quote, available: true },
  };
}
