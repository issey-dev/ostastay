import { prisma } from "@/lib/db";
import { toUtcMidnight } from "@/lib/business-date";

// Rolling the business date forward over several days WITHOUT running an End-of-Day for
// each one (app-owner request, 2026-08-03: "in cases when hotel closes for a certain
// period"). Night Audit stays the only way to close a day that had activity — this is
// strictly for skipping days that had none.
//
// The safety rule, in the app owner's words: "this can be done only if there are no
// reservations/activities for the period pushing forward". A skipped day is never
// audited, so anything operational left inside the range would be silently stepped over:
// arrivals that never became no-shows, departures never checked out, room charges never
// posted, a cashier shift never reconciled. Each of those is therefore a hard blocker,
// reported individually so the operator sees WHAT is in the way rather than a flat "no".
//
// FORWARD ONLY, and never onto the current date — the business date is the anchor every
// posting is stamped with, so moving it backwards would retro-date financial history.

export type RollBlocker = {
  kind: "ARRIVALS" | "DEPARTURES" | "IN_HOUSE" | "OPEN_FOLIO" | "OPEN_SHIFT";
  count: number;
  /** Operator-facing explanation of what must be cleared first. */
  message: string;
};

export type RollPreview = {
  from: string;
  to: string;
  days: number;
  blockers: RollBlocker[];
  canRoll: boolean;
};

/** Validate the requested target against the current business date. Returns an error
 *  message, or null when the range itself is acceptable. */
export function validateRollTarget(current: Date, target: Date): string | null {
  const from = toUtcMidnight(current);
  const to = toUtcMidnight(target);
  if (Number.isNaN(to.getTime())) return "Pick a valid date to roll to.";
  if (to.getTime() === from.getTime()) return "The business date is already set to that day.";
  if (to.getTime() < from.getTime()) {
    // Postings are stamped with the business date; moving it back would retro-date them.
    return "The business date can only move forward.";
  }
  return null;
}

export function daysBetween(current: Date, target: Date): number {
  return Math.round((toUtcMidnight(target).getTime() - toUtcMidnight(current).getTime()) / 86_400_000);
}

/**
 * Everything operational sitting inside [current, target) that a skipped day would step
 * over. The half-open range is deliberate: `current` IS the day being skipped first, and
 * `target` is the day the property reopens on — activity ON the target day is fine,
 * because that day will be worked normally.
 */
export async function findRollBlockers(propertyId: string, current: Date, target: Date): Promise<RollBlocker[]> {
  const from = toUtcMidnight(current);
  const to = toUtcMidnight(target);
  const blockers: RollBlocker[] = [];

  const [arrivals, departures, inHouse, openFolios, openShifts] = await Promise.all([
    // Bookings due to arrive during the closure — skipping past them would leave them
    // neither checked in nor marked no-show.
    prisma.reservation.count({
      where: { propertyId, status: { in: ["RESERVED", "CONFIRMED"] }, checkInDate: { gte: from, lt: to } },
    }),
    // Stays due to end during the closure.
    prisma.reservation.count({
      where: { propertyId, status: "IN_HOUSE", checkOutDate: { gte: from, lt: to } },
    }),
    // Anyone in the hotel at all: their room charges are posted per night by Night
    // Audit, so skipping days would silently lose that revenue.
    prisma.reservation.count({
      where: { propertyId, status: "IN_HOUSE" },
    }),
    // Money still owed on a stay that has already ended — Night Audit is where these
    // surface, so rolling past them buries them.
    prisma.folio.count({
      where: { propertyId, isClosed: false, reservation: { status: "CHECKED_OUT" } },
    }),
    // CashierShift has no status column — an open shift is one that was never closed.
    prisma.cashierShift.count({ where: { propertyId, closedAt: null } }),
  ]);

  if (arrivals > 0)
    blockers.push({
      kind: "ARRIVALS",
      count: arrivals,
      message: `${arrivals} booking${arrivals > 1 ? "s are" : " is"} due to arrive in this period — cancel, move, or mark them no-show first.`,
    });
  if (departures > 0)
    blockers.push({
      kind: "DEPARTURES",
      count: departures,
      message: `${departures} stay${departures > 1 ? "s are" : " is"} due to check out in this period — check them out or extend them first.`,
    });
  if (inHouse > 0)
    blockers.push({
      kind: "IN_HOUSE",
      count: inHouse,
      message: `${inHouse} guest${inHouse > 1 ? "s are" : " is"} still in-house — run End-of-Day normally so their nightly charges are posted.`,
    });
  if (openFolios > 0)
    blockers.push({
      kind: "OPEN_FOLIO",
      count: openFolios,
      message: `${openFolios} checked-out folio${openFolios > 1 ? "s are" : " is"} still open — settle or transfer ${openFolios > 1 ? "them" : "it"} first.`,
    });
  if (openShifts > 0)
    blockers.push({
      kind: "OPEN_SHIFT",
      count: openShifts,
      message: `${openShifts} cashier shift${openShifts > 1 ? "s are" : " is"} still open — close ${openShifts > 1 ? "them" : "it"} first.`,
    });

  return blockers;
}
