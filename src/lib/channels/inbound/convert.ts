import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/scope";
import { createReservation } from "@/lib/reservations/create-reservation";
import { resolveBookingDefaults } from "@/lib/channels/defaults";
import { getProvider } from "@/lib/channels/providers/registry";

// Turns a received ChannelInboundBooking into a real Reservation — the slice
// ChannelInboundBooking's own schema comment calls out as deliberately deferred: "converting
// these rows should go through a properly extracted service", i.e. createReservation
// (src/lib/reservations/create-reservation.ts), not a second copy of its rules.
//
// Deliberately idempotent and side-effect-free on anything already decided: calling this
// again on a CONVERTED, IGNORED, or terminally FAILED booking is a no-op. That is what lets
// the scheduled sweep (channelBookingConvertJob, src/lib/jobs/index.ts) retry every
// still-RECEIVED booking on every run without worrying about double-booking a guest — the
// same "safe to run repeatedly" rule every job in this codebase already follows.

export type ConvertResult = {
  bookingId: string;
  status: "CONVERTED" | "SKIPPED" | "PENDING" | "FAILED";
  reservationId?: string;
  reason?: string;
};

/**
 * A synthetic AuthContext for this one system-driven path. There is no logged-in user
 * behind a channel booking, so createReservation's assertPropertyAccess() and logActivity()
 * calls need SOMETHING to run against; ENTERPRISE scope with no property pin is the same
 * shape a real enterprise-level admin has, and logActivity tolerates a userId that resolves
 * to no real User row (see src/lib/activity-log.ts) by just recording null name/email.
 */
function systemContext(enterpriseId: string): AuthContext {
  return {
    userId: "system",
    enterpriseId,
    homeEnterpriseId: enterpriseId,
    scope: "ENTERPRISE",
    sessionPropertyId: null,
    propertyId: null,
    roleIds: [],
    permissions: new Map(),
    // Synthetic context for channel-inbound conversion — it never passes through
    // requireSession, so there is no Session row behind it.
    sessionId: "system",
    sessionJti: "system",
    isInternal: false,
    isActingAsSupport: false,
    licensedModules: new Set(),
  };
}

/**
 * Find an existing guest Profile by email within the enterprise, or create a minimal one.
 * Mirrors the same find-or-create shape the group-block pickup flow already uses
 * (src/app/api/groups/[id]/pickup/route.ts) — Profile has no email column of its own; email
 * lives in ProfileCommunication.
 *
 * A channel booking without bookings-personal scope arrives with no guest name at all (a
 * real gap, not a bug — see .agents/docs/TODO.md); "Guest" is a discoverable placeholder
 * rather than a blocked conversion, since the room is genuinely booked whether or not we yet
 * know who is coming.
 */
async function resolveGuestProfile(params: {
  enterpriseId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): Promise<string> {
  const { enterpriseId, firstName, lastName, email } = params;

  if (email) {
    const existing = await prisma.profile.findFirst({
      where: { enterpriseId, communications: { some: { type: "EMAIL", value: email } } },
      select: { upid: true },
    });
    if (existing) return existing.upid;
  }

  const created = await prisma.profile.create({
    data: {
      enterpriseId,
      profileType: "GUEST",
      firstName: firstName || "Guest",
      lastName: lastName || null,
      communications: email ? { create: [{ type: "EMAIL", value: email, isPrimary: true }] } : undefined,
    },
    select: { upid: true },
  });
  return created.upid;
}

/** Convert one booking. Safe to call on any booking in any state — see the file header. */
export async function convertInboundBooking(bookingId: string): Promise<ConvertResult> {
  const booking = await prisma.channelInboundBooking.findUnique({
    where: { id: bookingId },
    include: { connection: { select: { provider: true } } },
  });
  if (!booking) return { bookingId, status: "FAILED", reason: "Booking not found" };
  if (booking.status !== "RECEIVED") {
    return { bookingId, status: "SKIPPED", reason: `Already ${booking.status.toLowerCase()}` };
  }

  const provider = getProvider(booking.connection.provider);
  if (provider.isCancelledStatus(booking.channelStatus)) {
    await prisma.channelInboundBooking.update({ where: { id: bookingId }, data: { status: "IGNORED", problem: null } });
    return { bookingId, status: "SKIPPED", reason: "Booking is cancelled" };
  }

  // Not eligible yet, and not the conversion's fault — an unmapped room or unparseable
  // dates is exactly what ingest.ts's own `problem` field already explains. Leave it as
  // RECEIVED: mapping the room later makes it eligible on the next sweep with no extra step.
  if (!booking.roomTypeId || !booking.propertyId || !booking.arrival || !booking.departure) {
    return { bookingId, status: "PENDING", reason: booking.problem ?? "Booking is missing information required to convert" };
  }

  const defaults = await resolveBookingDefaults(booking.propertyId);
  if (defaults.problem || !defaults.ratePlanId) {
    const reason = defaults.problem ?? "No default rate plan configured";
    await prisma.channelInboundBooking.update({ where: { id: bookingId }, data: { problem: reason } });
    return { bookingId, status: "PENDING", reason };
  }

  const primaryGuestId = await resolveGuestProfile({
    enterpriseId: booking.enterpriseId,
    firstName: booking.guestFirstName,
    lastName: booking.guestLastName,
    email: booking.guestEmail,
  });

  let result;
  try {
    result = await createReservation(systemContext(booking.enterpriseId), {
      propertyId: booking.propertyId,
      primaryGuestId,
      checkInDate: booking.arrival,
      checkOutDate: booking.departure,
      roomTypeId: booking.roomTypeId,
      ratePlanId: defaults.ratePlanId,
      adults: booking.adults ?? 1,
      children: booking.children ?? 0,
      mealPlan: defaults.mealPlanCode,
      remarks: `Booked via ${booking.channelName ?? "channel manager"} (ref ${booking.externalBookingId})`,
      // First-class copy of the channel's booking id, so the desk can search a Beds24/OTA
      // reference and land on this reservation. The remarks line above stays — it is the
      // human-readable provenance; this is the matchable one.
      externalRef: booking.externalBookingId,
      // D-7 rule 4: the channel already confirmed this stay to the guest, so a booking that
      // exceeds our availability is accepted and flagged, never refused — the same
      // isOverbooking flag ingest.ts already computed for this row. This is the one place
      // that override is deliberately used for a channel-sourced booking rather than a
      // staff member's own manual decision.
      acknowledgeOverbook: true,
      // Same reasoning, for the arrival floor: a booking can reach us AFTER its own
      // arrival date (a webhook outage, a poller running behind, an OTA booking made
      // for today on a property whose business date has not rolled). The channel has
      // already confirmed that stay to the guest, so refusing it here would turn a real
      // paid booking into a FAILED conversion — the exact silent loss this pipeline
      // exists to prevent.
      allowPastArrival: true,
    });
  } catch (e) {
    // A thrown error here (e.g. the property is pending approval) is exceptional enough
    // that automatic retries are more likely to spin than to help — FAILED takes it out of
    // the sweep. The Hub can still expose a manual retry, since nothing here is destructive.
    const reason = e instanceof Error ? e.message : "Unknown error";
    await prisma.channelInboundBooking.update({ where: { id: bookingId }, data: { status: "FAILED", problem: reason } });
    return { bookingId, status: "FAILED", reason };
  }

  if (!result.ok) {
    // An ordinary validation failure (stop-sale, inactive room type, ...) can resolve
    // itself — a stop-sale can lift — so this stays RECEIVED and is retried, not abandoned.
    await prisma.channelInboundBooking.update({ where: { id: bookingId }, data: { problem: result.error } });
    return { bookingId, status: "PENDING", reason: result.error };
  }

  await prisma.channelInboundBooking.update({
    where: { id: bookingId },
    data: { status: "CONVERTED", reservationId: result.reservation.id, problem: null },
  });
  return { bookingId, status: "CONVERTED", reservationId: result.reservation.id };
}

/** Sweep every convertible booking for one enterprise. Used by the scheduled job. */
export async function convertEligibleBookings(enterpriseId: string): Promise<ConvertResult[]> {
  const bookings = await prisma.channelInboundBooking.findMany({
    where: {
      enterpriseId,
      status: "RECEIVED",
      roomTypeId: { not: null },
      propertyId: { not: null },
      arrival: { not: null },
      departure: { not: null },
    },
    select: { id: true },
  });

  const results: ConvertResult[] = [];
  for (const b of bookings) {
    results.push(await convertInboundBooking(b.id));
  }
  return results;
}
