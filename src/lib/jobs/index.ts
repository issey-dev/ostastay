import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/channels/providers/registry";
import { testConnection, CONNECTION_STATUS } from "@/lib/channels/connection";
import { pruneSyncLogs } from "@/lib/channels/sync-log";
import { pushAllEnabledLinks } from "@/lib/channels/push";
import { pollAllConnections } from "@/lib/channels/inbound/poll";
import { convertEligibleBookings } from "@/lib/channels/inbound/convert";
import { redactErrorMessage } from "@/lib/channels/redact";
import { sendPlatformMail, getPlatformAlertRecipients, isPlatformSmtpConfigured } from "@/lib/mailer";
import { buildChannelAlertEmail, type ChannelAlertConnection } from "@/lib/email-templates";
import { isIdleExpired, revokeSession } from "@/lib/session-store";
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
 * Email the platform's ops mailbox that channel connections have just broken.
 *
 * Never throws and never blocks the job: alerting is a side channel, and a mail server
 * being down must not turn a keep-alive sweep that did its work into a FAILED run.
 *
 * Silent when PLATFORM_ALERT_EMAIL or platform SMTP is unset — a deployment without an ops
 * mailbox is a legitimate configuration, not a fault to log on every sweep.
 */
async function alertChannelFailures(connections: ChannelAlertConnection[]): Promise<void> {
  if (connections.length === 0) return;
  const recipients = getPlatformAlertRecipients();
  if (recipients.length === 0 || !isPlatformSmtpConfigured()) return;

  try {
    const mail = buildChannelAlertEmail({ connections });
    await sendPlatformMail({
      to: recipients.join(", "),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch (e) {
    console.error("Failed to send channel-manager alert email:", e);
  }
}

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
      select: { id: true, name: true, lastTokenRefreshAt: true, provider: true, status: true },
    });

    const due = connections.filter((c) => getProvider(c.provider).needsKeepAlive(c.lastTokenRefreshAt));
    if (due.length === 0) {
      return { itemsProcessed: 0, summary: `${connections.length} connection(s), none due` };
    }

    let refreshed = 0;
    const failures: string[] = [];
    // Only connections that JUST broke — a working credential that has stopped working.
    // Alerting on "is currently failing" instead would re-send every sweep for as long as
    // the fault lasts, which is how an alert mailbox becomes one nobody reads. A
    // connection that was already ERROR is a known problem and stays silent.
    const newlyFailed: { name: string; provider: string; error: string | null }[] = [];

    for (const c of due) {
      // testConnection records its own outcome on the connection and never throws — a
      // credential that is already dead must not abort the keep-alive for the others.
      const result = await testConnection(c.id);
      if (result.status === CONNECTION_STATUS.CONNECTED) {
        refreshed += 1;
      } else {
        failures.push(c.name);
        if (c.status === CONNECTION_STATUS.CONNECTED) {
          newlyFailed.push({
            name: c.name,
            provider: c.provider,
            // Redacted again on the way out: lastError is short and operator-readable, but
            // it can quote a provider message, and email leaves the system entirely.
            error: result.lastError ? redactErrorMessage(result.lastError) : null,
          });
        }
      }
    }

    if (newlyFailed.length > 0) {
      const enterprise = await prisma.enterprise.findUnique({
        where: { id: enterpriseId },
        select: { name: true },
      });
      await alertChannelFailures(
        newlyFailed.map((f) => ({
          enterpriseName: enterprise?.name ?? "Unknown enterprise",
          connectionName: f.name,
          provider: f.provider,
          error: f.error,
        }))
      );
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

/**
 * Poll the channel manager for recent bookings.
 *
 * The safety net behind the webhook, not a replacement for it. A webhook that is never
 * delivered leaves no trace anywhere — and a missed booking is a guest arriving to a room
 * nobody knows about. That failure must not depend on a single delivery succeeding, so it
 * is swept for as well. Beds24 itself endorses using both.
 *
 * Cheap to run often: ingestion is idempotent on the channel's booking id, so re-reading an
 * overlapping window costs a few no-op updates rather than duplicates.
 */
export const channelBookingPollJob: Job = {
  name: "channel-booking-poll",
  description: "Fetch recent bookings from the channel manager (fallback for missed webhooks)",
  run: async (enterpriseId) => {
    const results = await pollAllConnections(enterpriseId);
    const created = results.reduce((n, r) => n + r.created, 0);
    const updated = results.reduce((n, r) => n + r.updated, 0);
    const overbookings = results.reduce((n, r) => n + r.overbookings, 0);
    const failed = results.filter((r) => r.status === "FAILED");

    const parts = [`${created} new, ${updated} updated`];
    if (overbookings > 0) parts.push(`${overbookings} OVERBOOKING(S)`);
    if (failed.length > 0) parts.push(`failed: ${failed.map((f) => f.connectionName).join(", ")}`);

    return {
      itemsProcessed: created,
      summary: results.length === 0 ? "No connections to poll" : parts.join("; "),
    };
  },
};

/**
 * Convert every RECEIVED inbound booking that is now eligible into a real Reservation.
 *
 * Runs right after the poll job in this list so a booking picked up this sweep gets a
 * conversion attempt in the same pass, not a full cycle later — but it is not IN the poll
 * job, because conversion also needs to retry bookings that failed for a reason an operator
 * can fix in between runs (no default rate plan configured yet, a stop-sale that has since
 * lifted), independent of whether anything new was polled.
 */
export const channelBookingConvertJob: Job = {
  name: "channel-booking-convert",
  description: "Convert eligible inbound channel bookings into reservations",
  run: async (enterpriseId) => {
    const results = await convertEligibleBookings(enterpriseId);
    const converted = results.filter((r) => r.status === "CONVERTED");
    const pending = results.filter((r) => r.status === "PENDING");
    const failed = results.filter((r) => r.status === "FAILED");

    const parts = [`${converted.length} converted`];
    if (pending.length > 0) parts.push(`${pending.length} still pending`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);

    return {
      itemsProcessed: converted.length,
      summary: results.length === 0 ? "No bookings awaiting conversion" : parts.join(", "),
    };
  },
};

/**
 * Sign out sessions that have gone idle past their property's timeout.
 *
 * Idle enforcement (src/lib/scope.ts) is otherwise entirely reactive: a session is only
 * marked IDLE when IT makes another request — the idle-check the browser fires on its own
 * inactivity clock, or just any ordinary navigation. A session nobody ever asks about again
 * (the tab was closed, the laptop slept, the network dropped) never gets that request, so it
 * never gets revoked — it sits in the Hub's Active Sessions list looking "active" (with a
 * correctly large but easy-to-miss idle time) until its full session length runs out. This
 * sweep is the safety net for exactly that case; a live user is still normally caught by the
 * reactive path well before this runs.
 *
 * An enterprise-scoped session (an admin, a Hub-only user) doesn't record which property it
 * was last working in — that only lives in a request cookie (see resolveSessionPropertyId in
 * scope.ts), which a background job has no access to. For those sessions this applies the
 * same fallback the live check uses when there is no cookie: the enterprise's first active
 * property, ordered by creation. Exact for a single-property enterprise; an approximation for
 * a multi-property one with different idle windows per property, same as a fresh cookieless
 * request would get.
 */
export const sessionIdleSweepJob: Job = {
  name: "session-idle-sweep",
  description: "Sign out sessions idle past their property's timeout",
  run: async (enterpriseId) => {
    const properties = await prisma.property.findMany({
      where: { enterpriseId },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, sessionIdleMinutes: true },
    });
    const propertyById = new Map(properties.map((p) => [p.id, p]));
    // First ACTIVE property in creation order — matches resolveSessionPropertyId's own
    // cookie-absent fallback exactly.
    const fallbackProperty = properties.find((p) => p.status === "ACTIVE");

    const sessions = await prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() }, user: { enterpriseId } },
      select: { id: true, jti: true, propertyId: true, lastSeenAt: true },
    });

    let revoked = 0;
    for (const s of sessions) {
      const property = (s.propertyId ? propertyById.get(s.propertyId) : undefined) ?? fallbackProperty;
      if (property && isIdleExpired(s.lastSeenAt, property.sessionIdleMinutes)) {
        await revokeSession(s.jti, "IDLE");
        revoked += 1;
      }
    }

    return {
      itemsProcessed: revoked,
      summary:
        sessions.length === 0
          ? "No live sessions"
          : revoked === 0
            ? `${sessions.length} live session(s), none idle`
            : `Signed out ${revoked} of ${sessions.length} live session(s)`,
    };
  },
};

export const JOBS: readonly Job[] = [
  channelKeepAliveJob,
  channelLogPruneJob,
  channelAriPushJob,
  channelBookingPollJob,
  channelBookingConvertJob,
  sessionIdleSweepJob,
];

export function findJob(name: string): Job | undefined {
  return JOBS.find((j) => j.name === name);
}
