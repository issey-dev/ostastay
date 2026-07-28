import { prisma } from "@/lib/db";
import { needsKeepAlive } from "@/lib/channels/beds24";
import { testConnection } from "@/lib/channels/connection";
import { pruneSyncLogs } from "@/lib/channels/sync-log";
import { pushAllEnabledLinks } from "@/lib/channels/push";
import type { Job } from "@/lib/jobs/runner";

// The job registry. Adding a job here is all that is needed for cron to pick it up —
// /api/jobs/run iterates this list.
//
// Every job must be safe to run repeatedly: cron delivery is at-least-once, retries happen,
// and a run can be taken over after a crash. None of these may assume "exactly once".

// How long channel-manager exchange logs are kept. Long enough to investigate a problem
// reported a month later, short enough that the table does not grow without bound.
export const SYNC_LOG_RETENTION_DAYS = 60;

/**
 * Keep channel-manager credentials alive.
 *
 * This closes the real operational gap from the connection screen: Beds24 refresh tokens
 * die if unused for 30 days, so a connection nobody touches breaks silently and can only be
 * recovered with a fresh invite code from the operator. testConnection() exercises the
 * refresh token, which resets that idle clock — the "health check" and the "keep alive" are
 * genuinely the same operation.
 *
 * Only connections that actually need it are touched (needsKeepAlive fires with days to
 * spare, not on the final day), so this stays cheap even run hourly.
 */
export const channelKeepAliveJob: Job = {
  name: "channel-keepalive",
  description: "Refresh channel-manager credentials before they lapse",
  run: async (enterpriseId) => {
    const connections = await prisma.channelConnection.findMany({
      where: { enterpriseId, refreshToken: { not: null } },
      select: { id: true, name: true, lastTokenRefreshAt: true },
    });

    const due = connections.filter((c) => needsKeepAlive(c.lastTokenRefreshAt));
    if (due.length === 0) {
      return { itemsProcessed: 0, summary: `${connections.length} connection(s), none due` };
    }

    let refreshed = 0;
    const failures: string[] = [];
    for (const c of due) {
      // testConnection records its own outcome on the connection and never throws — a
      // credential that is already dead must not abort the keep-alive for the others.
      const result = await testConnection(c.id);
      if (result.status === "CONNECTED") refreshed += 1;
      else failures.push(c.name);
    }

    return {
      itemsProcessed: refreshed,
      summary:
        failures.length === 0
          ? `Refreshed ${refreshed} of ${due.length} due`
          : `Refreshed ${refreshed} of ${due.length} due; still failing: ${failures.join(", ")}`,
    };
  },
};

/**
 * Trim the channel-manager exchange log.
 *
 * ChannelSyncLog gains a row for every exchange, so a property syncing continuously grows
 * it without limit. The prune mechanism shipped with the Logs screen; this is what actually
 * runs it.
 */
export const channelLogPruneJob: Job = {
  name: "channel-log-prune",
  description: `Delete channel-manager log entries older than ${SYNC_LOG_RETENTION_DAYS} days`,
  run: async (enterpriseId) => {
    const removed = await pruneSyncLogs(enterpriseId, SYNC_LOG_RETENTION_DAYS);
    return {
      itemsProcessed: removed,
      summary: `Removed ${removed} entr${removed === 1 ? "y" : "ies"} older than ${SYNC_LOG_RETENTION_DAYS} days`,
    };
  },
};

/**
 * Publish availability to the channel manager for every property that is sharing.
 *
 * This is what makes the integration live rather than a one-off: inventory changes
 * constantly (bookings, cancellations, room moves, stop-sales), and a channel told once and
 * never again is worse than one never told at all — it is confidently wrong.
 *
 * Scheduled rather than event-driven for now, deliberately. A push per inventory change
 * would mean a burst of desk activity becoming a burst of API calls straight into a rate
 * limit; a periodic sweep coalesces all of it into one push per property. The cost is
 * staleness bounded by the cron interval, which is the standard trade for channel
 * management. Event-driven invalidation can refine this later without changing what is
 * pushed.
 *
 * pushAllEnabledLinks skips anything not actually sharing, so this is cheap when idle.
 */
export const channelAriPushJob: Job = {
  name: "channel-ari-push",
  description: "Publish availability to the channel manager for properties that are sharing",
  run: async (enterpriseId) => {
    const results = await pushAllEnabledLinks(enterpriseId);
    const pushed = results.filter((r) => r.status === "PUSHED");
    const failed = results.filter((r) => r.status === "FAILED");

    return {
      itemsProcessed: pushed.length,
      summary:
        results.length === 0
          ? "No properties are sharing"
          : failed.length === 0
            ? `Pushed ${pushed.length} of ${results.length} property(ies)`
            : `Pushed ${pushed.length} of ${results.length}; failed: ${failed
                .map((f) => f.propertyName)
                .join(", ")}`,
    };
  },
};

export const JOBS: readonly Job[] = [channelKeepAliveJob, channelLogPruneJob, channelAriPushJob];

export function findJob(name: string): Job | undefined {
  return JOBS.find((j) => j.name === name);
}
