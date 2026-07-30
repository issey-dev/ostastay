import { prisma } from "@/lib/db";
import { perNightTypeAvailability } from "@/lib/availability";
import { parseBeds24Booking, isCancelledStatus, type ParsedBooking } from "@/lib/channels/inbound/parse";

// Records a booking received from the channel manager.
//
// Phase 1 (see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md): receive, normalise, detect
// problems, record. It does NOT create a Reservation — see the note on
// ChannelInboundBooking in schema.prisma for why that is a separate slice.
//
// Two properties matter more than anything else here:
//
//  1. IDEMPOTENCY. Webhook delivery is at-least-once and the poller deliberately re-reads
//     an overlapping window, so the same booking arrives repeatedly. Every arrival after
//     the first must update in place, never insert again — a duplicated OTA booking is a
//     duplicated guest.
//
//  2. OVERBOOK DETECTION. Per D-7 rule 4 an inbound booking is ACCEPTED even when it
//     exceeds availability — the channel manager already confirmed it to the guest, so
//     refusing is not genuinely available to us. But it must be flagged, so the desk finds
//     out days ahead rather than at the door.

export type IngestSource = "WEBHOOK" | "POLL";

export type IngestResult = {
  externalBookingId: string | null;
  status: "CREATED" | "UPDATED" | "REJECTED";
  isOverbooking: boolean;
  problem?: string;
};

/**
 * Resolve which of OUR room types a channel room id refers to, via the mapping tables.
 *
 * Scoped through the connection, so a room id can only ever resolve to a property that
 * connection actually covers.
 */
async function resolveRoomType(connectionId: string, externalRoomId: string | null) {
  if (!externalRoomId) return null;
  const map = await prisma.channelRoomTypeMap.findFirst({
    where: { externalRoomId, link: { connectionId } },
    select: { roomTypeId: true, link: { select: { propertyId: true } } },
  });
  return map ? { roomTypeId: map.roomTypeId, propertyId: map.link.propertyId } : null;
}

/**
 * Would accepting this booking exceed what we actually have?
 *
 * Checks every night of the stay against the SAME availability calculation the rest of the
 * app uses. Note this asks about availability as it stands now — the booking itself is not
 * yet a Reservation, so it is not counted twice.
 */
async function detectOverbooking(opts: {
  propertyId: string;
  roomTypeId: string;
  arrival: Date;
  departure: Date;
}): Promise<{ isOverbooking: boolean; note: string | null }> {
  const nights = await perNightTypeAvailability({
    propertyId: opts.propertyId,
    roomTypeId: opts.roomTypeId,
    startDate: opts.arrival,
    endDate: opts.departure,
  });

  const full = nights.filter((n) => n.available <= 0);
  if (full.length === 0) return { isOverbooking: false, note: null };

  return {
    isOverbooking: true,
    note:
      full.length === nights.length
        ? `No rooms of this type are available for any night of this stay (${full.length} night(s))`
        : `No rooms of this type are available on ${full.map((n) => n.date).join(", ")}`,
  };
}

/**
 * Record one raw booking. Never throws for bad data — an unparseable booking is stored with
 * its problem noted, because a payload we cannot read is exactly the one worth keeping.
 */
export async function ingestBooking(opts: {
  enterpriseId: string;
  connectionId: string;
  raw: unknown;
  source: IngestSource;
  /** Defaults to Beds24's parser. Pass the connected provider's own when it differs. */
  parse?: (raw: unknown) => ParsedBooking;
  /** Defaults to Beds24's cancellation words. Pass the connected provider's own when it differs. */
  isCancelled?: (status: string | null) => boolean;
}): Promise<IngestResult> {
  const { enterpriseId, connectionId, raw, source, parse = parseBeds24Booking, isCancelled = isCancelledStatus } = opts;
  const parsed: ParsedBooking = parse(raw);
  const rawPayload = safeStringify(raw);

  // Without a booking id there is no idempotency key, so storing it would risk duplicating
  // on the next delivery. Rejected — but the raw body is still recorded in the exchange log
  // by the caller, so nothing is actually lost.
  if (!parsed.externalBookingId) {
    return {
      externalBookingId: null,
      status: "REJECTED",
      isOverbooking: false,
      problem: parsed.problem ?? "No booking id",
    };
  }

  const mapping = await resolveRoomType(connectionId, parsed.externalRoomId);
  const problems: string[] = [];
  if (parsed.problem) problems.push(parsed.problem);
  if (!mapping && parsed.externalRoomId) {
    // A booking for a room we do not recognise. Kept rather than dropped: it is a real
    // booking a real guest holds, and the fix is a mapping change, not a lost reservation.
    problems.push(`Channel room "${parsed.externalRoomId}" is not mapped to a room type`);
  }

  // Only meaningful for a live booking we can actually place. A cancellation cannot
  // overbook anything, and an unmapped one cannot be checked.
  let overbooking = { isOverbooking: false, note: null as string | null };
  const cancelled = isCancelled(parsed.channelStatus);
  if (mapping && parsed.arrival && parsed.departure && !cancelled) {
    overbooking = await detectOverbooking({
      propertyId: mapping.propertyId,
      roomTypeId: mapping.roomTypeId,
      arrival: parsed.arrival,
      departure: parsed.departure,
    });
  }

  const data = {
    enterpriseId,
    connectionId,
    externalBookingId: parsed.externalBookingId,
    channelName: parsed.channelName,
    source,
    externalRoomId: parsed.externalRoomId,
    roomTypeId: mapping?.roomTypeId ?? null,
    propertyId: mapping?.propertyId ?? null,
    guestFirstName: parsed.guestFirstName,
    guestLastName: parsed.guestLastName,
    guestEmail: parsed.guestEmail,
    arrival: parsed.arrival,
    departure: parsed.departure,
    adults: parsed.adults,
    children: parsed.children,
    totalAmount: parsed.totalAmount,
    currency: parsed.currency,
    channelStatus: parsed.channelStatus,
    problem: problems.length > 0 ? problems.join("; ") : null,
    isOverbooking: overbooking.isOverbooking,
    overbookingNote: overbooking.note,
    rawPayload,
  };

  const existing = await prisma.channelInboundBooking.findUnique({
    where: { connectionId_externalBookingId: { connectionId, externalBookingId: parsed.externalBookingId } },
    select: { id: true, acknowledgedAt: true },
  });

  if (existing) {
    await prisma.channelInboundBooking.update({
      where: { id: existing.id },
      data: {
        ...data,
        // A modification the desk has NOT yet seen must not stay acknowledged — clearing it
        // pulls the row back into view. Acknowledging is about a specific state of the
        // booking, not the booking forever.
        ...(overbooking.isOverbooking ? { acknowledgedAt: null, acknowledgedById: null } : {}),
      },
    });
    return {
      externalBookingId: parsed.externalBookingId,
      status: "UPDATED",
      isOverbooking: overbooking.isOverbooking,
      problem: data.problem ?? undefined,
    };
  }

  await prisma.channelInboundBooking.create({ data });
  return {
    externalBookingId: parsed.externalBookingId,
    status: "CREATED",
    isOverbooking: overbooking.isOverbooking,
    problem: data.problem ?? undefined,
  };
}

/** Ingest a batch, isolating failures so one bad booking cannot drop the rest. */
export async function ingestBookings(opts: {
  enterpriseId: string;
  connectionId: string;
  bookings: unknown[];
  source: IngestSource;
  parse?: (raw: unknown) => ParsedBooking;
  isCancelled?: (status: string | null) => boolean;
}): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const raw of opts.bookings) {
    try {
      results.push(
        await ingestBooking({
          enterpriseId: opts.enterpriseId,
          connectionId: opts.connectionId,
          raw,
          source: opts.source,
          parse: opts.parse,
          isCancelled: opts.isCancelled,
        })
      );
    } catch (e) {
      console.error("inbound ingest failed", e);
      results.push({
        externalBookingId: null,
        status: "REJECTED",
        isOverbooking: false,
        problem: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
  return results;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "null";
  } catch {
    return '"<unserialisable payload>"';
  }
}
