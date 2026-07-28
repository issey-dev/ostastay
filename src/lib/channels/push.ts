import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { getValidAccessToken, makeLogSink, isRateLimitPaused } from "@/lib/channels/connection";
import { computeChannelAvailability, resolveWindow } from "@/lib/channels/sync";
import { getProvider } from "@/lib/channels/providers/registry";

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
  /** Only populated for a dry run — the exact body that WOULD be sent, in the connected
   *  provider's own wire format (opaque here by design; see src/lib/channels/provider.ts). */
  payload?: unknown;
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
  /** Window start, same format resolveWindow() already accepts. Null/omitted means today —
   *  the on-demand Hub actions (Rate Plan/Inventory tabs) pass an operator-chosen range. */
  from?: string | null;
}): Promise<PushResult> {
  const { enterpriseId, linkId, dryRun = false } = opts;

  const link = await prisma.channelPropertyLink.findUnique({
    where: { id: linkId },
    include: {
      connection: {
        select: {
          id: true,
          enterpriseId: true,
          name: true,
          refreshToken: true,
          provider: true,
          rateLimitPauseThreshold: true,
          rateLimitRemaining: true,
          rateLimitResetsAt: true,
        },
      },
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
  // A dry run computes only, never calls Beds24, so it never touches the shared credit pool
  // and is exempt from the operator's self-throttle floor.
  if (!dryRun && isRateLimitPaused(link.connection)) {
    return {
      ...base,
      status: "SKIPPED",
      reason: `Paused — Beds24 rate-limit credits at or below the configured threshold (${link.connection.rateLimitRemaining} remaining)`,
      roomTypeCount: 0,
      nightCount: 0,
    };
  }

  const provider = getProvider(link.connection.provider);
  const { from, to } = resolveWindow(opts.from ?? null, opts.days ?? PUSH_WINDOW_DAYS);
  const plan = await computeChannelAvailability({ enterpriseId, linkId, from, to });
  const { payload, roomTypeCount, nightCount } = provider.buildAvailabilityPayload(plan);

  if (roomTypeCount === 0) {
    return {
      ...base,
      status: "SKIPPED",
      reason: "No room types are mapped and shared",
      roomTypeCount: 0,
      nightCount: 0,
    };
  }

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
    // resets the provider's idle clock — so a property that is actively syncing keeps its
    // own credentials alive without the keep-alive job having to.
    const accessToken = await getValidAccessToken(link.connection.id);
    await provider.pushAvailability(accessToken, payload, sink);
    return { ...base, status: "PUSHED", roomTypeCount, nightCount };
  } catch (e) {
    // Never rethrows: a push failure for one property must not abort a job sweeping the
    // rest, and the exchange log already carries the detail. pushAvailability's own sink
    // has recorded the failed exchange before this point.
    return { ...base, status: "FAILED", reason: provider.toConnectionError(e), roomTypeCount, nightCount };
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
