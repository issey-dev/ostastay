import type { ChannelAvailabilityPlan, ChannelNight } from "@/lib/channels/sync";

// Turns a computed availability plan into the body Beds24's calendar endpoint expects.
//
// Kept PURE and separate from both the calculation and the HTTP call, because it is the
// one part of the outbound path whose correctness cannot be checked against a live account
// yet (see the caveat below) — so it is the part that most needs to be exhaustively unit
// tested and easy to eyeball via dry-run.
//
// ⚠️ SHAPE NOT YET VERIFIED AGAINST A LIVE ACCOUNT.
// Beds24's own documentation states that per-date price and availability "can be read and
// set through the /inventory/rooms/calendar endpoint", but the exact field names are only
// in its account-gated Swagger. The names below follow Beds24's documented calendar
// vocabulary, and everything about this module is arranged so that being wrong is cheap:
//   - the transformation is pure and fully tested independently of the wire format,
//   - dry-run returns this payload without sending, so it can be compared against a real
//     account before anything is transmitted,
//   - if a name is wrong, it is a one-line change here and nothing else moves.
// Confirm during the sandbox spike before enabling sharing on a real property.

export type Beds24CalendarRange = {
  from: string;
  to: string;
  /** Rooms sellable across this range. */
  numAvail: number;
  /**
   * Stop-sale. Sent ALONGSIDE numAvail: 0 rather than instead of it — the D-7 ruling is
   * that a stop-sale must CLOSE the room type, and several OTAs treat availability 0 on
   * its own as "temporarily sold out" while keeping the listing live.
   */
  closed?: boolean;
};

export type Beds24RoomCalendar = {
  roomId: string;
  calendar: Beds24CalendarRange[];
};

/**
 * Collapse consecutive nights that carry identical values into one range.
 *
 * Beds24's calendar is expressed as from/to ranges, so a 90-night window of unchanged
 * availability is one entry rather than 90. Beyond payload size, this matters because
 * channel managers rate-limit and because a smaller diff is far easier for a human to read
 * in the exchange log when something has gone wrong.
 *
 * `to` is INCLUSIVE — a single night has from === to. That matches how Beds24 expresses a
 * date range on the calendar, and is deliberately different from the half-open [from, to)
 * convention used for stay dates everywhere else in this codebase; conflating the two would
 * silently push one night too many.
 */
export function compactNights(nights: ChannelNight[]): Beds24CalendarRange[] {
  const ranges: Beds24CalendarRange[] = [];

  for (const night of nights) {
    const last = ranges[ranges.length - 1];
    const sameValues =
      last !== undefined && last.numAvail === night.available && !!last.closed === night.closed;

    if (sameValues && isNextDay(last.to, night.date)) {
      last.to = night.date;
      continue;
    }

    ranges.push({
      from: night.date,
      to: night.date,
      numAvail: night.available,
      ...(night.closed ? { closed: true } : {}),
    });
  }

  return ranges;
}

// True when `next` is the calendar day immediately after `prev` (both YYYY-MM-DD).
// Parsed as UTC noon so the comparison cannot be shifted by a DST transition — using local
// midnight would make one day of the year 23 or 25 hours long and break the adjacency test
// on exactly that boundary.
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
 */
export function buildCalendarPayload(plan: ChannelAvailabilityPlan): Beds24RoomCalendar[] {
  return plan.roomTypes
    .map((rt) => ({ roomId: rt.externalRoomId, calendar: compactNights(rt.nights) }))
    .filter((r) => r.calendar.length > 0);
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
