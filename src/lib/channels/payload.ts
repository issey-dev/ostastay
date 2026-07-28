import type { ChannelAvailabilityPlan, ChannelNight } from "@/lib/channels/sync";

// Turns a computed availability plan into the body Beds24's calendar endpoint expects.
//
// ✅ VERIFIED 2026-07-28 against Beds24's OFFICIAL OpenAPI specification (read from the
// `@lionlai/beds24-v2-sdk` package, which is generated from it). The `calendar` schema is:
//
//     { roomId?: number, calendar?: [{
//         from?: string, to?: string, numAvail?: number,
//         minStay?: number, maxStay?: number, multiplier: number,
//         override?: "none" | "blackout" | "exception" | "noCheckIn" | "noCheckOut"
//                  | "noCheckInOrCheckOut",
//         price1?: number ... price16?: number,
//         channels?: { agoda?: {...}, airbnb?: {...}, ... }
//     }] }
//
// Two earlier guesses were WRONG and are corrected here:
//   - a stop-sale is `override: "blackout"`, NOT a `closed` boolean;
//   - prices are SIXTEEN NUMBERED SLOTS (price1..price16), not a map keyed by rate id.
// `roomId` is a number rather than a string.
//
// Kept PURE and separate from both the calculation and the HTTP call, so the wire format
// lives in one place and is exhaustively unit tested.

/** Beds24 supports exactly 16 price slots per room. */
export const MAX_PRICE_SLOTS = 16;

export type Beds24Override =
  | "none"
  | "blackout"
  | "exception"
  | "noCheckIn"
  | "noCheckOut"
  | "noCheckInOrCheckOut";

export type Beds24CalendarRange = {
  from: string;
  to: string;
  /**
   * Rooms sellable across this range.
   *
   * Beds24 permits a NEGATIVE value here (its spec notes this happens when a room is
   * overbooked), but we never send one: the D-7 ruling is that we publish actual
   * availability and never overbooking headroom, so the calculation clamps at 0.
   */
  numAvail: number;
  /**
   * Stop-sale is an override, not an availability of zero.
   *
   * ⚠️ Beds24's spec warns: "If you change override from blackout to none without setting
   * numAvail, numAvail will change to the maximum possible." Every range we send carries an
   * explicit numAvail, so lifting a blackout can never silently re-open a room type at full
   * capacity — do not make numAvail optional here without re-reading that sentence.
   */
  override?: Beds24Override;
} & {
  /** price1..price16 — only slots that actually have a price are included. */
  [priceSlot: string]: string | number | Beds24Override | undefined;
};

export type Beds24RoomCalendar = {
  /** Beds24's own NUMERIC room id. */
  roomId: number;
  calendar: Beds24CalendarRange[];
};

const PRICE_SLOT_RE = /^price\d+$/;

/**
 * Collapse consecutive nights carrying identical values into one range.
 *
 * `to` is INCLUSIVE — a single night has from === to. That matches Beds24's calendar and is
 * deliberately different from the half-open [from, to) convention used for stay dates
 * everywhere else in this codebase; conflating the two would push one night too many.
 */
export function compactNights(nights: ChannelNight[]): Beds24CalendarRange[] {
  const ranges: Beds24CalendarRange[] = [];

  for (const night of nights) {
    const last = ranges[ranges.length - 1];
    // Prices are part of what makes two nights "the same". Merging on availability alone
    // would swallow a price change into the preceding range and publish yesterday's rate
    // for today — a silent mispricing, worse than a failed push.
    const sameValues =
      last !== undefined &&
      last.numAvail === night.available &&
      (last.override === "blackout") === night.closed &&
      samePrices(last, night.prices);

    if (sameValues && isNextDay(last.to, night.date)) {
      last.to = night.date;
      continue;
    }

    const range: Beds24CalendarRange = {
      from: night.date,
      to: night.date,
      numAvail: night.available,
      // "none" is sent explicitly rather than omitted, so a previously blacked-out date is
      // actively re-opened rather than left in whatever state the channel had it in.
      override: night.closed ? "blackout" : "none",
    };
    for (const [slot, price] of Object.entries(night.prices)) {
      range[`price${slot}`] = price;
    }
    ranges.push(range);
  }

  return ranges;
}

/** Compare the price slots on an existing range against a night's price map. */
function samePrices(range: Beds24CalendarRange, prices: Record<string, number>): boolean {
  const rangeSlots = Object.keys(range).filter((k) => PRICE_SLOT_RE.test(k));
  const nightSlots = Object.keys(prices);
  if (rangeSlots.length !== nightSlots.length) return false;
  // A slot present in one and absent from the other is a difference, not a match —
  // "unpriced" is a distinct state from any number.
  return nightSlots.every((slot) => range[`price${slot}`] === prices[slot]);
}

// True when `next` is the calendar day immediately after `prev` (both YYYY-MM-DD).
// Parsed as UTC noon so the comparison cannot be shifted by a DST transition — local
// midnight would make one day of the year 23 or 25 hours long and break adjacency there.
function isNextDay(prev: string, next: string): boolean {
  const p = Date.parse(`${prev}T12:00:00Z`);
  const n = Date.parse(`${next}T12:00:00Z`);
  if (Number.isNaN(p) || Number.isNaN(n)) return false;
  return n - p === 86_400_000;
}

/**
 * Build the full calendar payload for a plan.
 *
 * Room types the plan excluded never appear — an excluded room type must be absent from the
 * payload entirely, not sent as zero. Sending 0 would actively close inventory at the
 * channel that the operator only meant to stop managing from here.
 *
 * A room whose external id is not numeric is skipped: Beds24's roomId is a number, and
 * coercing something non-numeric would address the wrong room or none at all.
 */
export function buildCalendarPayload(plan: ChannelAvailabilityPlan): Beds24RoomCalendar[] {
  return plan.roomTypes
    .map((rt) => ({ roomId: Number(rt.externalRoomId), calendar: compactNights(rt.nights) }))
    .filter((r) => Number.isFinite(r.roomId) && r.calendar.length > 0);
}

/** Total nights covered by a payload — for the log summary, so a push is quantifiable. */
export function countNights(payload: Beds24RoomCalendar[]): number {
  return payload.reduce(
    (total, room) =>
      total +
      room.calendar.reduce((sum, r) => {
        const from = Date.parse(`${r.from}T12:00:00Z`);
        const to = Date.parse(`${r.to}T12:00:00Z`);
        if (Number.isNaN(from) || Number.isNaN(to)) return sum;
        return sum + Math.round((to - from) / 86_400_000) + 1;
      }, 0),
    0
  );
}

/**
 * Is this a usable Beds24 price slot?
 *
 * A rate plan maps to a slot NUMBER (1–16), not an arbitrary id — Beds24 exposes a fixed set
 * of numbered price fields rather than named rates.
 */
export function isValidPriceSlot(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PRICE_SLOTS;
}
