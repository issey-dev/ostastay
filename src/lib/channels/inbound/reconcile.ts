import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/channels/providers/registry";
import { getFeeRuleById, computeReservationFee } from "@/lib/fee-rules";
import { SYSTEM_CANCEL_REASONS } from "@/lib/reservations/options";
import { emitForReservation } from "@/lib/agent-api/events";
import { logActivity } from "@/lib/activity-log";
import { systemContext } from "@/lib/reservations/system-context";
import { parseDateKey, toDateKey } from "@/lib/date-only";
import { notifyChannelBookingCancelled, notifyChannelBookingReview } from "@/lib/notifications/producers";

// What happens when a channel cancels or changes a booking that ALREADY became a reservation.
//
// Owner's rule, DECISIONS.md "Channel bookings changed or cancelled after they became a
// reservation" (2026-11-23), for every channel manager:
//   - a cancellation is applied automatically only when it is SAFE (see unsafeToCancel());
//   - any other cancellation, and every date / room / guest-count change, is FLAGGED for the
//     desk on the reservation, never applied automatically;
//   - every cancellation or change raises a notification.
//
// The channel is the authority on its own bookings — the guest cancelled at the OTA, and
// nothing here can undo that — so the question is only how fast the PMS follows, and whether a
// person must decide something first (money on the folio, a guest in the house, linked add-ons).
//
// Idempotent: it compares the channel's current state with the reservation's, so re-running it
// for an unchanged booking (every poll does) is a no-op, and a flag clears itself once the desk
// has made the reservation match.

const CHANNEL_CANCELLED = "CHANNEL_CANCELLED";
/** Reservation statuses a safe automatic cancellation may start from. */
const AUTO_CANCELLABLE = ["RESERVED", "TENTATIVE"];

export type ReconcileOutcome =
  | { outcome: "NONE" }
  | { outcome: "CANCELLED" }
  | { outcome: "FLAGGED"; action: "CANCEL" | "CHANGE"; reason: string }
  | { outcome: "CLEARED" };

/** Calendar day of a stored date, whether it was stored as local or UTC midnight. */
function dayKey(d: Date | null | undefined): string | null {
  const local = parseDateKey(d ?? null);
  return local ? toDateKey(local) : null;
}

async function loadForReconcile(inboundId: string) {
  return prisma.channelInboundBooking.findUnique({
    where: { id: inboundId },
    include: {
      connection: { select: { provider: true } },
      roomType: { select: { name: true } },
      reservation: {
        include: {
          assignments: { include: { roomType: { select: { name: true } } }, orderBy: { startDate: "asc" } },
          folios: { select: { lineItems: { select: { isVoid: true } }, payments: { select: { id: true } } } },
        },
      },
    },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadForReconcile>>>;
type LoadedReservation = NonNullable<Loaded["reservation"]>;

/**
 * Why a channel cancellation must NOT be applied automatically, or null when it is safe.
 * Each condition is one the owner listed; a cancellation fee rule is added because posting a
 * fee (or deciding not to) is a money decision, the same as an existing folio posting.
 */
export async function unsafeToCancel(r: LoadedReservation): Promise<string | null> {
  if (!AUTO_CANCELLABLE.includes(r.status)) {
    return r.status === "IN_HOUSE"
      ? "the guest is already checked in"
      : `the reservation is ${r.status.toLowerCase().replace("_", " ")}`;
  }

  const posted = r.folios.some((f) => f.payments.length > 0 || f.lineItems.some((li) => !li.isVoid));
  if (posted) return "there are payments or charges on the folio";

  // "Edited by staff since it arrived": any activity a real user recorded on this reservation
  // after it was created. The conversion itself logs as the synthetic "system" user.
  const staffEdit = await prisma.userActivityLog.findFirst({
    where: {
      entityType: "Reservation",
      entityId: r.id,
      createdAt: { gt: r.createdAt },
      userId: { notIn: ["system"] },
      NOT: { userId: null },
    },
    select: { id: true },
  });
  if (staffEdit) return "staff have changed the reservation since it arrived";

  const [spa, excursion, transfer] = await Promise.all([
    prisma.spaAppointmentParticipant.count({ where: { reservationId: r.id } }),
    prisma.excursionBooking.count({ where: { reservationId: r.id } }),
    prisma.reservationTransport.count({ where: { reservationId: r.id } }),
  ]);
  const linked = [spa && "Spa", excursion && "Excursion", transfer && "Transfer"].filter(Boolean);
  if (linked.length > 0) return `it has linked ${linked.join(", ")} bookings`;

  const rule = await getFeeRuleById(r.cancellationFeeRuleId, "CANCELLATION");
  if (rule?.chargeCodeId && (await computeReservationFee(rule, r)) > 0.005) {
    return "a cancellation fee rule applies";
  }
  return null;
}

/** What differs between the channel's booking and the reservation, in plain words. */
export function describeChanges(b: Loaded, r: LoadedReservation): string[] {
  const changes: string[] = [];
  const [ba, bd, ra, rd] = [dayKey(b.arrival), dayKey(b.departure), dayKey(r.checkInDate), dayKey(r.checkOutDate)];
  if (ba && bd && (ba !== ra || bd !== rd)) changes.push(`dates ${ra} → ${rd} became ${ba} → ${bd}`);
  const currentTypeId = r.assignments[0]?.roomTypeId ?? null;
  if (b.roomTypeId && currentTypeId && b.roomTypeId !== currentTypeId) {
    changes.push(`room type ${r.assignments[0]?.roomType?.name ?? "?"} became ${b.roomType?.name ?? "?"}`);
  }
  if (b.adults != null && b.adults !== r.adults) changes.push(`adults ${r.adults} became ${b.adults}`);
  if (b.children != null && b.children !== r.children) changes.push(`children ${r.children} became ${b.children}`);
  return changes;
}

async function setPending(b: Loaded, action: "CANCEL" | "CHANGE", reason: string) {
  if (b.pendingAction === action && b.pendingReason === reason) return false;
  await prisma.channelInboundBooking.update({
    where: { id: b.id },
    data: { pendingAction: action, pendingReason: reason, pendingSince: new Date() },
  });
  return true;
}

async function clearPending(b: Loaded) {
  if (!b.pendingAction) return false;
  await prisma.channelInboundBooking.update({
    where: { id: b.id },
    data: { pendingAction: null, pendingReason: null, pendingSince: null },
  });
  return true;
}

/** Cancel the reservation the way the system's other automatic cancellations do (options.ts). */
async function cancelAutomatically(b: Loaded, r: LoadedReservation): Promise<boolean> {
  const now = new Date();
  const reason = b.channelName ? `Cancelled at ${b.channelName}` : SYSTEM_CANCEL_REASONS[CHANNEL_CANCELLED];
  const done = await prisma.$transaction(async (tx) => {
    // Conditional on the status we judged safe still being current: a desk action racing
    // this one wins, and this run simply re-evaluates next time.
    const claimed = await tx.reservation.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReasonCode: CHANNEL_CANCELLED, cancellationReason: reason },
    });
    if (claimed.count === 0) return false;
    await tx.folio.updateMany({ where: { reservationId: r.id, isClosed: false }, data: { isClosed: true } });
    await tx.eRegistrationLink.updateMany({
      where: { reservationId: r.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now },
    });
    await tx.channelInboundBooking.update({
      where: { id: b.id },
      data: { pendingAction: null, pendingReason: null, pendingSince: null },
    });
    return true;
  });
  if (!done) return false;

  await logActivity({
    ctx: systemContext(b.enterpriseId),
    module: "RESERVATIONS",
    action: "CANCELLED",
    entityType: "Reservation",
    entityId: r.id,
    description: `Reservation ${r.confirmationNo}: ${r.status} → CANCELLED (${reason}, applied automatically)`,
  });
  await emitForReservation(r.id, "booking.cancelled").catch(() => {});
  return true;
}

/**
 * Bring a CONVERTED channel booking's reservation in line with the channel, per the owner's
 * rule. Safe to call any number of times. Returns what it did.
 */
export async function reconcileConvertedBooking(inboundId: string): Promise<ReconcileOutcome> {
  const b = await loadForReconcile(inboundId);
  if (!b || b.status !== "CONVERTED" || !b.reservation) return { outcome: "NONE" };
  const r = b.reservation;
  const provider = getProvider(b.connection.provider);

  if (provider.isCancelledStatus(b.channelStatus)) {
    if (r.status === "CANCELLED") return (await clearPending(b)) ? { outcome: "CLEARED" } : { outcome: "NONE" };

    const unsafe = await unsafeToCancel(r);
    if (!unsafe && (await cancelAutomatically(b, r))) {
      await notifyChannelBookingCancelled({
        enterpriseId: b.enterpriseId, propertyId: r.propertyId, reservationId: r.id,
        confirmationNo: r.confirmationNo, channelName: b.channelName,
      });
      return { outcome: "CANCELLED" };
    }
    const reason = `Cancelled at the channel, not applied automatically because ${unsafe ?? "the reservation just changed"}.`;
    if (await setPending(b, "CANCEL", reason)) {
      await notifyChannelBookingReview({
        enterpriseId: b.enterpriseId, propertyId: r.propertyId, reservationId: r.id,
        confirmationNo: r.confirmationNo, channelName: b.channelName, action: "CANCEL", reason,
      });
    }
    return { outcome: "FLAGGED", action: "CANCEL", reason };
  }

  // A live booking: any difference from the reservation is a change for the desk.
  if (r.status === "CANCELLED" || r.status === "CHECKED_OUT") {
    // The channel still shows it live but the PMS has closed it (e.g. the desk cancelled at
    // the guest's request first). Nothing to apply to; leave it to the desk and the channel.
    return (await clearPending(b)) ? { outcome: "CLEARED" } : { outcome: "NONE" };
  }
  const changes = describeChanges(b, r);
  if (changes.length === 0) return (await clearPending(b)) ? { outcome: "CLEARED" } : { outcome: "NONE" };

  const reason = `Changed at the channel: ${changes.join("; ")}.`;
  if (await setPending(b, "CHANGE", reason)) {
    await notifyChannelBookingReview({
      enterpriseId: b.enterpriseId, propertyId: r.propertyId, reservationId: r.id,
      confirmationNo: r.confirmationNo, channelName: b.channelName, action: "CHANGE", reason,
    });
  }
  return { outcome: "FLAGGED", action: "CHANGE", reason };
}

/**
 * Clear a pending flag that the desk has already dealt with, WITHOUT applying anything.
 * Used when the reservation is read: a flagged cancellation whose reservation the desk has
 * since cancelled, or a flagged change the desk has since applied, stops showing at once
 * rather than waiting for the channel's next delivery. Never cancels on its own — that only
 * happens when the channel sends something (reconcileConvertedBooking).
 */
export async function clearResolvedPending(inboundId: string): Promise<boolean> {
  const b = await loadForReconcile(inboundId);
  if (!b || !b.pendingAction || !b.reservation) return false;
  const r = b.reservation;
  const resolved =
    b.pendingAction === "CANCEL"
      ? r.status === "CANCELLED"
      : r.status === "CANCELLED" || r.status === "CHECKED_OUT" || describeChanges(b, r).length === 0;
  return resolved ? clearPending(b) : false;
}
