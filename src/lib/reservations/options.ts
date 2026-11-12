import { prisma } from "@/lib/db";
import { getPropertySettings } from "@/lib/property-settings";
import { toUtcMidnight } from "@/lib/business-date";
import { findTypeAvailabilityConflicts } from "@/lib/availability";
import { logActivity } from "@/lib/activity-log";
import { requireCapability, type AuthContext } from "@/lib/scope";

// Tentative bookings and their option date — Agent Portal plan A-5, A-12, A-13, A-14, §5.2
// (Phase 1, 9.1.0).
//
// TENTATIVE is a real reservation status, not a flag on RESERVED: it holds inventory until
// its optionDate, shows everywhere with its own label, and is confirmed by a person
// (TENTATIVE → RESERVED) after they have checked whatever needs checking. An option that
// runs out is RELEASED: the booking becomes CANCELLED with the system reason
// OPTION_EXPIRED and is kept as a record — nothing is deleted.
//
// Expiry runs in a job (option-expiry) AND is enforced lazily on read (expireOptionsSoon),
// so a stopped job never leaves expired options holding rooms.

export const TENTATIVE = "TENTATIVE";
export const OPTION_EXPIRED = "OPTION_EXPIRED";

/** Structured cancellation reasons the system itself writes. Staff and agents pick theirs
 *  from the property's list (SystemCode AGENT_CANCEL_REASON); these are reserved. */
export const SYSTEM_CANCEL_REASONS: Record<string, string> = {
  [OPTION_EXPIRED]: "Released (option expired)",
  AGENT_CANCELLED: "Cancelled by the agent",
  HOTEL_CANCELLED: "Cancelled by the hotel",
};

export class OptionError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** End of a property-local day, as the deadline an option runs to. Dates in the PMS are
 *  stored as UTC-midnight day keys, so "end of D" is the next midnight minus a second. */
export function endOfOptionDay(d: Date): Date {
  return new Date(toUtcMidnight(d).getTime() + DAY - 1000);
}

/**
 * A20/A-14: the option date a new tentative booking gets.
 *  1. Its block's cutoff date, when it has one and it is still ahead.
 *  2. Otherwise arrival − optionDaysBeforeArrival (default 30).
 *  3. A booking made after that point (late, or inside a block's elasticity after the
 *     cutoff) gets shortOptionHours from now (default 48), but never past arrival.
 */
export function computeOptionDate(opts: {
  checkInDate: Date;
  now: Date;
  blockCutoff?: Date | null;
  optionDaysBeforeArrival?: number;
  shortOptionHours?: number;
}): Date {
  const days = opts.optionDaysBeforeArrival ?? 30;
  const shortHours = opts.shortOptionHours ?? 48;
  const arrival = toUtcMidnight(opts.checkInDate);
  if (opts.blockCutoff && endOfOptionDay(opts.blockCutoff) > opts.now) {
    return endOfOptionDay(opts.blockCutoff);
  }
  const byArrival = endOfOptionDay(new Date(arrival.getTime() - days * DAY));
  if (byArrival > opts.now) return byArrival;
  const short = new Date(opts.now.getTime() + shortHours * 60 * 60 * 1000);
  // An option can never run past the arrival day itself.
  return short < arrival ? short : new Date(Math.max(opts.now.getTime(), arrival.getTime() - 1000));
}

export async function optionDateFor(propertyId: string, checkInDate: Date, blockCutoff?: Date | null, now = new Date()) {
  const s = await getPropertySettings(propertyId);
  return computeOptionDate({
    checkInDate,
    now,
    blockCutoff,
    optionDaysBeforeArrival: s.optionDaysBeforeArrival,
    shortOptionHours: s.shortOptionHours,
  });
}

/**
 * Release every tentative booking whose option has run out. Idempotent and safe on several
 * replicas: each row is claimed with a conditional update (status still TENTATIVE and the
 * option still past), so a confirmation racing the expiry cannot both win.
 */
export async function expireDueOptions(opts: { propertyId?: string; enterpriseId?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const due = await prisma.reservation.findMany({
    where: {
      status: TENTATIVE,
      optionDate: { lt: now },
      ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
      ...(opts.enterpriseId ? { property: { enterpriseId: opts.enterpriseId } } : {}),
    },
    select: { id: true, confirmationNo: true, propertyId: true },
    take: 500,
  });
  let released = 0;
  for (const r of due) {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.reservation.updateMany({
        where: { id: r.id, status: TENTATIVE, optionDate: { lt: now } },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReasonCode: OPTION_EXPIRED,
          cancellationReason: SYSTEM_CANCEL_REASONS[OPTION_EXPIRED],
        },
      });
      if (claimed.count === 0) return false;
      await tx.folio.updateMany({ where: { reservationId: r.id, isClosed: false }, data: { isClosed: true } });
      await tx.eRegistrationLink.updateMany({
        where: { reservationId: r.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      return true;
    });
    if (done) released++;
  }
  return released;
}

// Lazy enforcement on read, throttled per property so a busy screen does not turn every
// read into a write. A minute of lag is fine: the job is the primary path.
const lastSweep = new Map<string, number>();
export async function expireOptionsSoon(propertyId: string, now = Date.now()): Promise<void> {
  const last = lastSweep.get(propertyId) ?? 0;
  if (now - last < 60_000) return;
  lastSweep.set(propertyId, now);
  try {
    await expireDueOptions({ propertyId, now: new Date(now) });
  } catch (e) {
    // Never fail a read because the sweep failed; the job will try again.
    console.error("option expiry sweep failed", e);
  }
}

/** Test seam: forget the throttle. */
export function resetOptionSweepThrottle() {
  lastSweep.clear();
}

type Loaded = {
  id: string;
  propertyId: string;
  status: string;
  confirmationNo: string;
  optionDate: Date | null;
  checkInDate: Date;
};

async function load(ctx: AuthContext, id: string): Promise<Loaded> {
  const r = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      propertyId: true,
      status: true,
      confirmationNo: true,
      optionDate: true,
      checkInDate: true,
      property: { select: { enterpriseId: true } },
    },
  });
  if (!r || r.property.enterpriseId !== ctx.enterpriseId) throw new OptionError(404, "Reservation not found");
  if (ctx.scope === "PROPERTY" && ctx.propertyId !== r.propertyId) throw new OptionError(404, "Reservation not found");
  return r;
}

/** TENTATIVE → RESERVED. One conditional update: a confirmation racing the expiry job
 *  (or another confirmation) cannot both win; the loser gets BOOKING_LOCKED. */
export async function confirmTentative(ctx: AuthContext, id: string, note?: string | null) {
  requireCapability(ctx, "reservations.manageOption");
  const r = await load(ctx, id);
  if (r.status !== TENTATIVE) {
    throw new OptionError(409, `Only a tentative booking can be confirmed (this one is ${r.status.toLowerCase()}).`, "BOOKING_LOCKED");
  }
  const now = new Date();
  const claimed = await prisma.reservation.updateMany({
    where: { id, status: TENTATIVE, OR: [{ optionDate: null }, { optionDate: { gte: now } }] },
    data: {
      status: "RESERVED",
      confirmedAt: now,
      confirmedBy: ctx.userId,
      ...(note ? { confirmationNote: note } : {}),
    },
  });
  if (claimed.count === 0) {
    throw new OptionError(409, "This option has just expired or changed. Reload and check it before confirming.", "BOOKING_LOCKED");
  }
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "CONFIRM",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: tentative → confirmed${note ? ` (${note})` : ""}`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}

/** Many at once (Group Blocks "Confirm selected"). Each one is claimed on its own, so a
 *  booking that expired meanwhile is reported, not silently skipped. */
export async function confirmMany(ctx: AuthContext, ids: string[], note?: string | null) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      await confirmTentative(ctx, id, note);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  return results;
}

/** Move the option date of a tentative booking (staff keep a booking past its deadline). */
export async function extendOption(ctx: AuthContext, id: string, newDate: Date) {
  requireCapability(ctx, "reservations.manageOption");
  const r = await load(ctx, id);
  if (r.status !== TENTATIVE) throw new OptionError(409, "Only a tentative booking has an option to extend.", "BOOKING_LOCKED");
  const deadline = endOfOptionDay(newDate);
  if (deadline <= new Date()) throw new OptionError(400, "The new option date must be in the future.");
  if (toUtcMidnight(newDate) > toUtcMidnight(r.checkInDate)) {
    throw new OptionError(400, "An option cannot run past the arrival date.");
  }
  const claimed = await prisma.reservation.updateMany({ where: { id, status: TENTATIVE }, data: { optionDate: deadline } });
  if (claimed.count === 0) throw new OptionError(409, "This booking has just changed. Reload it.", "BOOKING_LOCKED");
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "UPDATE",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: option extended to ${deadline.toISOString().slice(0, 10)}`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}

/** Release a tentative booking now: CANCELLED with a reason code, kept as a record. */
export async function releaseTentative(
  ctx: AuthContext,
  id: string,
  opts: { reasonCode?: string | null; reason?: string | null; requireReason?: boolean } = {}
) {
  requireCapability(ctx, "reservations.manageOption");
  const r = await load(ctx, id);
  if (r.status !== TENTATIVE) throw new OptionError(409, "Only a tentative booking can be released.", "BOOKING_LOCKED");
  const reason = opts.reason?.trim() || null;
  if (opts.requireReason && !reason && !opts.reasonCode) throw new OptionError(400, "A reason is required.", "REASON_REQUIRED");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.reservation.updateMany({
      where: { id, status: TENTATIVE },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReasonCode: opts.reasonCode ?? "HOTEL_CANCELLED",
        cancellationReason: reason ?? SYSTEM_CANCEL_REASONS[opts.reasonCode ?? "HOTEL_CANCELLED"] ?? null,
      },
    });
    if (claimed.count === 0) throw new OptionError(409, "This booking has just changed. Reload it.", "BOOKING_LOCKED");
    await tx.folio.updateMany({ where: { reservationId: id, isClosed: false }, data: { isClosed: true } });
  });
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "CANCELLED",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: tentative released${reason ? ` (${reason})` : ""}`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}

/** Reinstate a cancelled booking as tentative (a released option brought back at the desk).
 *  Re-runs the availability check and gives it a fresh option date. */
export async function reinstateAsTentative(ctx: AuthContext, id: string) {
  requireCapability(ctx, "reservations.manageOption");
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: { assignments: true, groupBlock: { select: { cutoffDate: true } }, property: { select: { enterpriseId: true } } },
  });
  if (!r || r.property.enterpriseId !== ctx.enterpriseId) throw new OptionError(404, "Reservation not found");
  if (r.status !== "CANCELLED") throw new OptionError(409, "Only a cancelled booking can be reinstated.", "BOOKING_LOCKED");
  const now = new Date();
  if (toUtcMidnight(r.checkInDate) <= toUtcMidnight(now)) {
    throw new OptionError(400, "Its arrival date is no longer in the future. Create a new booking instead.");
  }
  const conflicts = await findTypeAvailabilityConflicts({
    propertyId: r.propertyId,
    segments: r.assignments.map((a) => ({ roomTypeId: a.roomTypeId, startDate: a.startDate, endDate: a.endDate })),
    excludeReservationId: id,
  });
  if (conflicts.length > 0) throw new OptionError(409, `Cannot reinstate: ${conflicts.join("; ")}`);
  const optionDate = await optionDateFor(r.propertyId, r.checkInDate, r.groupBlock?.cutoffDate ?? null, now);
  const claimed = await prisma.reservation.updateMany({
    where: { id, status: "CANCELLED" },
    data: { status: TENTATIVE, optionDate, cancelledAt: null, cancellationReason: null, cancellationReasonCode: null },
  });
  if (claimed.count === 0) throw new OptionError(409, "This booking has just changed. Reload it.", "BOOKING_LOCKED");
  await prisma.folio.updateMany({ where: { reservationId: id, isDebtorAccount: false }, data: { isClosed: false } });
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "UPDATE",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: reinstated as tentative, option to ${optionDate.toISOString().slice(0, 10)}`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}
