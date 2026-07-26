import { prisma } from "@/lib/db";
import { toUtcMidnight } from "@/lib/business-date";

// Stop-Sale / availability restrictions. A row in AvailabilityRestriction means the date
// is CLOSED (not open to sell); no row means OPEN (the default). A row with roomTypeId
// null closes the date property-wide (every room type); with roomTypeId set it closes
// only that type. See prisma/schema.prisma > AvailabilityRestriction. Open/Closed is the
// only restriction type today — no CTA/CTD/min-stay.

const DAY_MS = 86_400_000;

/** UTC-midnight epoch ms for a date — the canonical key restriction dates are stored on. */
function utcDayMs(d: Date): number {
  return toUtcMidnight(d).getTime();
}

/** Format a UTC-midnight ms back to YYYY-MM-DD for human-readable conflict messages. */
function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type RestrictionSegment = {
  roomTypeId: string;
  startDate: Date;
  endDate: Date;
};

// Every closed date overlapping a window, split into property-wide closures (apply to all
// types) and per-room-type closures. One query; the caller decides how to use it (booking
// enforcement, or the availability grid's Closed flags). Window is [startMs, endMs) in
// UTC-midnight ms — end is exclusive (nights, not calendar days).
export async function getClosedDates(opts: {
  propertyId: string;
  windowStart: number;
  windowEnd: number;
  roomTypeIds?: string[];
}): Promise<{ propertyLevel: Set<number>; byRoomType: Map<string, Set<number>> }> {
  const { propertyId, windowStart, windowEnd, roomTypeIds } = opts;
  const rows = await prisma.availabilityRestriction.findMany({
    where: {
      propertyId,
      date: { gte: new Date(windowStart), lt: new Date(windowEnd) },
      ...(roomTypeIds ? { OR: [{ roomTypeId: null }, { roomTypeId: { in: roomTypeIds } }] } : {}),
    },
    select: { roomTypeId: true, date: true },
  });

  const propertyLevel = new Set<number>();
  const byRoomType = new Map<string, Set<number>>();
  for (const r of rows) {
    const ms = utcDayMs(r.date);
    if (r.roomTypeId === null) {
      propertyLevel.add(ms);
    } else {
      let set = byRoomType.get(r.roomTypeId);
      if (!set) {
        set = new Set<number>();
        byRoomType.set(r.roomTypeId, set);
      }
      set.add(ms);
    }
  }
  return { propertyLevel, byRoomType };
}

// HARD Stop-Sale guard for new/edited reservations: a stay is blocked when any night it
// occupies is closed for its room type OR closed property-wide. Unlike the soft
// overbooking guard (findTypeAvailabilityConflicts), there is no acknowledge/override —
// "Closed" means the hotel cannot sell those dates. Returns human-readable conflict
// strings (empty = sellable). A stay occupies the nights [checkIn, checkOut) — the
// checkout day is not a night, so a closure on the departure date never blocks a stay.
//
// `existingSegments` (edit path only) are the reservation's segments BEFORE the edit. A
// (roomType, night) it already occupied isn't a NEW sale, so a Stop-Sale set after the
// reservation was made never blocks editing an unrelated field — mirroring how an
// inactive room type only blocks when the segment actually changes to it.
export async function findStopSaleConflicts(opts: {
  propertyId: string;
  segments: RestrictionSegment[];
  existingSegments?: RestrictionSegment[];
}): Promise<string[]> {
  const { propertyId, segments, existingSegments } = opts;
  if (segments.length === 0) return [];

  // Nights the reservation already held (per type, and across all types) — exempt from
  // Stop-Sale since they aren't newly sold by this edit.
  const heldByType = new Map<string, Set<number>>();
  const heldAny = new Set<number>();
  for (const seg of existingSegments ?? []) {
    let set = heldByType.get(seg.roomTypeId);
    if (!set) {
      set = new Set<number>();
      heldByType.set(seg.roomTypeId, set);
    }
    for (let night = utcDayMs(seg.startDate); night < utcDayMs(seg.endDate); night += DAY_MS) {
      set.add(night);
      heldAny.add(night);
    }
  }

  const windowStart = Math.min(...segments.map((s) => utcDayMs(s.startDate)));
  const windowEnd = Math.max(...segments.map((s) => utcDayMs(s.endDate)));
  if (windowEnd <= windowStart) return [];

  const typeIds = [...new Set(segments.map((s) => s.roomTypeId))];
  const { propertyLevel, byRoomType } = await getClosedDates({
    propertyId,
    windowStart,
    windowEnd,
    roomTypeIds: typeIds,
  });
  if (propertyLevel.size === 0 && byRoomType.size === 0) return [];

  // Room-type names for readable messages — only when there's actually something to report.
  const roomTypes = await prisma.roomType.findMany({
    where: { id: { in: typeIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(roomTypes.map((t) => [t.id, t.name]));

  const conflicts: string[] = [];
  for (const seg of segments) {
    const segStart = utcDayMs(seg.startDate);
    const segEnd = utcDayMs(seg.endDate);
    const typeClosed = byRoomType.get(seg.roomTypeId);
    const heldForType = heldByType.get(seg.roomTypeId);
    for (let night = segStart; night < segEnd; night += DAY_MS) {
      if (propertyLevel.has(night)) {
        if (!heldAny.has(night)) {
          conflicts.push(`Sales are closed property-wide on ${fmtDay(night)} (Stop Sale)`);
        }
      } else if (typeClosed?.has(night) && !heldForType?.has(night)) {
        conflicts.push(
          `${nameById.get(seg.roomTypeId) ?? "This room type"} is on Stop Sale (closed) on ${fmtDay(night)}`
        );
      }
    }
  }
  // De-dupe: two split-stay segments of the same type could both hit the same closed night.
  return [...new Set(conflicts)];
}
