import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { perNightTypeAvailability, formatLocalDay } from "@/lib/availability";
import { resolveRatesForLink } from "@/lib/channels/rates";

// The outbound half of the sync engine: what we would publish to the channel manager for a
// linked property, and why.
//
// This module COMPUTES and EXPLAINS; it does not push. The HTTP push lands next, on top of
// this. Separating them means the numbers can be reviewed against a real property — through
// the Hub's preview — before anything is ever sent to an OTA, which is the only cheap moment
// to catch a mapping mistake.
//
// Implements the owner's D-7 ruling (.agents/docs/DECISIONS.md, 2026-07-27):
//   1. Publish ACTUAL available inventory; never include overbooking allowance. Clamp to 0.
//   2. Overbooking stays manual-only at the desk — nothing here can create one.
//   3. Group-block held rooms are withheld until the block's cutoff, then released.
//   5. Stop-sale CLOSES the room type at the channel rather than merely pushing 0.

// Whether a group block's outstanding holds reduce what we publish.
//
// Deliberately BOTH live statuses, matching the booking overbook guard's default rather
// than the Property Availability grid (which shows DEFINITE only). A tentative block is
// still a real claim on rooms until its cutoff passes, and publishing those rooms would
// mean the block firming up produces exactly the channel-caused overbook rule 1 exists to
// prevent. The cost is deliberate under-selling while a block is tentative; the cutoff
// release is what bounds it.
const BLOCK_STATUSES_THAT_HOLD = ["TENTATIVE", "DEFINITE"];

export type ChannelNight = {
  date: string;
  /** Rooms we would publish. Always >= 0. Forced to 0 when closed. */
  available: number;
  /** True when a stop-sale applies — the room type must be CLOSED at the channel, not just zeroed. */
  closed: boolean;
  /**
   * Prices for this night, keyed by the CHANNEL's rate id.
   *
   * A rate id is ABSENT when that plan has no resolvable price for the night. Absent means
   * "we don't know", and it must never be pushed as 0 — zero is a real price that would put
   * rooms on sale for nothing. See src/lib/channels/rates.ts.
   */
  prices: Record<string, number>;
};

export type ChannelRoomTypePlan = {
  roomTypeId: string;
  roomTypeName: string;
  roomTypeCode: string;
  externalRoomId: string;
  nights: ChannelNight[];
};

export type ChannelAvailabilityPlan = {
  linkId: string;
  propertyId: string;
  propertyName: string;
  externalPropertyId: string;
  syncEnabled: boolean;
  from: string;
  to: string;
  roomTypes: ChannelRoomTypePlan[];
  /**
   * Room types deliberately NOT published, with the reason — so a room type missing from a
   * channel is explainable without reading code.
   */
  excluded: { roomTypeId: string; roomTypeName: string; reason: string }[];
};

const DAY_MS = 86_400_000;

/**
 * Compute what would be published for one property link over [from, to).
 *
 * Excludes, with a stated reason for each:
 *  - PSEUDO room types. These are non-physical buckets (day-use, overbooking buffer) with
 *    no real rooms behind them — publishing one would sell rooms that do not exist. The
 *    booking overbook guard already skips them; the channel must too.
 *  - Inactive room types (not sellable).
 *  - Room types the operator has held back (shared = false).
 *  - Room types with no external id — unmapped inventory cannot be addressed at the channel.
 *    The Sharing screen's readiness gate normally prevents this combination, but a room type
 *    added AFTER sharing was enabled reaches exactly this state, so it must be handled here
 *    rather than assumed away.
 */
export async function computeChannelAvailability(opts: {
  enterpriseId: string;
  linkId: string;
  from: Date;
  to: Date;
}): Promise<ChannelAvailabilityPlan> {
  const { enterpriseId, linkId, from, to } = opts;

  const link = await prisma.channelPropertyLink.findUnique({
    where: { id: linkId },
    include: {
      connection: { select: { enterpriseId: true } },
      property: { select: { id: true, name: true } },
      roomTypeMaps: true,
    },
  });
  if (!link || link.connection.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Link not found");
  }

  const roomTypes = await prisma.roomType.findMany({
    where: { propertyId: link.propertyId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, isActive: true, isPseudo: true },
  });

  const mapByRoomTypeId = new Map(link.roomTypeMaps.map((m) => [m.roomTypeId, m]));

  // One query for every stop-sale in the window, rather than per room type per night.
  // A row with roomTypeId = null is a PROPERTY-WIDE stop-sale and closes every room type
  // for that date.
  const restrictions = await prisma.availabilityRestriction.findMany({
    where: { propertyId: link.propertyId, date: { gte: from, lt: to } },
    select: { roomTypeId: true, date: true },
  });
  const closedDates = new Set<string>();
  for (const r of restrictions) {
    closedDates.add(`${r.roomTypeId ?? "*"}|${formatLocalDay(r.date.getTime())}`);
  }
  const isClosed = (roomTypeId: string, date: string) =>
    closedDates.has(`*|${date}`) || closedDates.has(`${roomTypeId}|${date}`);

  // Which room types will actually be published — resolved first so rates are fetched in
  // one pass rather than per room type.
  const publishable = roomTypes.filter((rt) => {
    const map = mapByRoomTypeId.get(rt.id);
    return !rt.isPseudo && rt.isActive && !!map && map.shared;
  });
  const ratesByRoomType = await resolveRatesForLink({
    propertyId: link.propertyId,
    linkId: link.id,
    roomTypeIds: publishable.map((rt) => rt.id),
    from,
    to,
  });

  const included: ChannelRoomTypePlan[] = [];
  const excluded: ChannelAvailabilityPlan["excluded"] = [];

  for (const rt of roomTypes) {
    if (rt.isPseudo) {
      excluded.push({ roomTypeId: rt.id, roomTypeName: rt.name, reason: "Pseudo room type — no physical rooms" });
      continue;
    }
    if (!rt.isActive) {
      excluded.push({ roomTypeId: rt.id, roomTypeName: rt.name, reason: "Room type is inactive" });
      continue;
    }
    const map = mapByRoomTypeId.get(rt.id);
    if (!map) {
      excluded.push({ roomTypeId: rt.id, roomTypeName: rt.name, reason: "Not mapped to a channel room" });
      continue;
    }
    if (!map.shared) {
      excluded.push({ roomTypeId: rt.id, roomTypeName: rt.name, reason: "Held back from sharing" });
      continue;
    }

    const nights = await perNightTypeAvailability({
      propertyId: link.propertyId,
      roomTypeId: rt.id,
      startDate: from,
      endDate: to,
      blockStatusIn: BLOCK_STATUSES_THAT_HOLD,
    });

    included.push({
      roomTypeId: rt.id,
      roomTypeName: rt.name,
      roomTypeCode: rt.code,
      externalRoomId: map.externalRoomId,
      nights: nights.map((n) => {
        const closed = isClosed(rt.id, n.date);

        // Only rate plans with a resolvable price for THIS night appear. An unpriced night
        // is omitted rather than zeroed — see rates.ts.
        const prices: Record<string, number> = {};
        for (const plan of ratesByRoomType.get(rt.id) ?? []) {
          const price = plan.prices[n.date];
          if (price != null) prices[plan.externalRateId] = price;
        }

        // Closed nights publish 0 AND carry the closed flag. Availability 0 alone is not
        // equivalent: several OTAs read it as "temporarily sold out" and keep the listing
        // live, whereas a closure removes it. Rule 5 of the D-7 ruling.
        return { date: n.date, available: closed ? 0 : n.available, closed, prices };
      }),
    });
  }

  return {
    linkId: link.id,
    propertyId: link.property.id,
    propertyName: link.property.name,
    externalPropertyId: link.externalPropertyId,
    syncEnabled: link.syncEnabled,
    from: formatLocalDay(from.getTime()),
    to: formatLocalDay(to.getTime()),
    roomTypes: included,
    excluded,
  };
}

/** Clamp a requested preview/push window to something sane. 366 (not 365) so a full year
 *  is never clipped short by falling on a leap year. */
export function resolveWindow(fromParam: string | null, days: number): { from: Date; to: Date } {
  const base = fromParam ? new Date(fromParam) : new Date();
  const start = Number.isNaN(base.getTime()) ? new Date() : base;
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const clampedDays = Math.min(Math.max(days, 1), 366);
  return { from, to: new Date(from.getTime() + clampedDays * DAY_MS) };
}
