import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { pushCalendar, toConnectionError } from "@/lib/channels/beds24";
import { getValidAccessToken, makeLogSink } from "@/lib/channels/connection";
import { computeChannelAvailability, resolveWindow } from "@/lib/channels/sync";
import { buildCalendarPayload, countNights, type Beds24RoomCalendar } from "@/lib/channels/payload";

// The outbound push — the first thing in this integration that actually reaches an OTA.
//
// Everything before it computed, logged or configured; nothing left the building. From here
// a mistake is visible to guests, so the guards below are not defensive padding, they are
// the feature.

// How far ahead inventory is published. Long enough to cover normal booking lead time,
// short enough that one push stays small and a mistake has a bounded blast radius.
export const PUSH_WINDOW_DAYS = 60;

export type PushResult = {
  linkId: string;
  propertyName: string;
  status: "PUSHED" | "DRY_RUN" | "SKIPPED" | "FAILED";
  reason?: string;
  roomTypeCount: number;
  nightCount: number;
  /** Only populated for a dry run — the exact body that WOULD be sent. */
  payload?: Beds24RoomCalendar[];
};

/**
 * Push availability for one link.
 *
 * Refuses, rather than pushes, when:
 *  - sharing is off. `syncEnabled` is the operator's explicit consent to publish, and it is
 *    checked HERE as well as in the UI — a job, a retry or a future caller must not be able
 *    to publish a property nobody turned on.
 *  - the connection has no credentials.
 *  - the plan contains no room types. An empty payload is not a harmless no-op: it would be
 *    a push that says nothing while looking like a success, hiding a broken mapping.
 *
 * `dryRun` returns the payload without sending. That is the only way to see the exact body
 * before it goes to an OTA, and the payload shape is not yet verified against a live
 * account (see src/lib/channels/payload.ts), so it matters.
 */
export async function pushAvailabilityForLink(opts: {
  enterpriseId: string;
  linkId: string;
  dryRun?: boolean;
  days?: number;
}): Promise<PushResult> {
  const { enterpriseId, linkId, dryRun = false } = opts;

  const link = await prisma.channelPropertyLink.findUnique({
    where: { id: linkId },
    include: {
      connection: { select: { id: true, enterpriseId: true, name: true, refreshToken: true } },
      property: { select: { name: true } },
    },
  });
  if (!link || link.connection.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Link not found");
  }

  const base = { linkId, propertyName: link.property.name };

  // A dry run is allowed while sharing is off — inspecting what WOULD be sent before
  // enabling is exactly the point. A real push is not.
  if (!dryRun && !link.syncEnabled) {
    return { ...base, status: "SKIPPED", reason: "Sharing is off for this property", roomTypeCount: 0, nightCount: 0 };
  }
  if (!link.connection.refreshToken) {
    return { ...base, status: "SKIPPED", reason: "Connection has no credentials", roomTypeCount: 0, nightCount: 0 };
  }

  const { from, to } = resolveWindow(null, opts.days ?? PUSH_WINDOW_DAYS);
  const plan = await computeChannelAvailability({ enterpriseId, linkId, from, to });
  const payload = buildCalendarPayload(plan);

  if (payload.length === 0) {
    return {
      ...base,
      status: "SKIPPED",
      reason: "No room types are mapped and shared",
      roomTypeCount: 0,
      nightCount: 0,
    };
  }

  const roomTypeCount = payload.length;
  const nightCount = countNights(payload);

  if (dryRun) {
    return { ...base, status: "DRY_RUN", roomTypeCount, nightCount, payload };
  }

  const sink = makeLogSink({
    enterpriseId,
    connectionName: link.connection.name,
    connectionId: link.connection.id,
  });

  try {
    // getValidAccessToken re-mints from the refresh token when needed, and doing so also
    // resets Beds24's 30-day idle clock — so a property that is actively syncing keeps its
    // own credentials alive without the keep-alive job having to.
    const accessToken = await getValidAccessToken(link.connection.id);
    await pushCalendar(accessToken, payload, sink);
    return { ...base, status: "PUSHED", roomTypeCount, nightCount };
  } catch (e) {
    // Never rethrows: a push failure for one property must not abort a job sweeping the
    // rest, and the exchange log already carries the detail. pushCalendar's own sink has
    // recorded the failed exchange before this point.
    return { ...base, status: "FAILED", reason: toConnectionError(e), roomTypeCount, nightCount };
  }
}

/**
 * Push every link that is actually sharing, for one enterprise. Used by the scheduled job.
 *
 * Sequential for the same reason the job runner is: these are outbound calls to a
 * rate-limited provider, and firing them at every property at once is how an integration
 * gets throttled.
 */
export async function pushAllEnabledLinks(enterpriseId: string): Promise<PushResult[]> {
  const links = await prisma.channelPropertyLink.findMany({
    where: { syncEnabled: true, connection: { enterpriseId } },
    select: { id: true },
  });

  const results: PushResult[] = [];
  for (const l of links) {
    results.push(await pushAvailabilityForLink({ enterpriseId, linkId: l.id }));
  }
  return results;
}
