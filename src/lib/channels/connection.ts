import type { ChannelConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import type { ChannelLogSink, RateLimitInfo } from "@/lib/channels/beds24";
import { getProvider, DEFAULT_PROVIDER_ID } from "@/lib/channels/providers/registry";

/**
 * Build the sink that turns a Beds24 exchange into a ChannelSyncLog row.
 *
 * Entries arrive ALREADY REDACTED from the client (see src/lib/channels/redact.ts) — this
 * only adds the scoping columns. Nothing here should ever re-introduce raw request or
 * response data.
 *
 * connectionId is optional because the very first exchange (validating an invite code)
 * happens before any row exists; those entries are still written, with the name the
 * operator typed, so a failed setup is visible in the log rather than vanishing.
 */
export function makeLogSink(params: {
  enterpriseId: string;
  connectionName: string;
  connectionId?: string | null;
  /** Receives each written row id, so a caller can link entries afterwards. */
  onWrite?: (logId: string) => void;
  /** Receives a rate-limit reading seen while connectionId is unset (the setup exchange),
   *  so a caller like createConnection can write it in directly once the row exists —
   *  mirrors onWrite's own reason for existing: nothing observed before the row exists
   *  should just be lost. */
  onRateLimit?: (info: RateLimitInfo) => void;
}): ChannelLogSink {
  return async (entry) => {
    const row = await prisma.channelSyncLog.create({
      data: {
        enterpriseId: params.enterpriseId,
        connectionId: params.connectionId ?? null,
        connectionName: params.connectionName,
        direction: entry.direction,
        operation: entry.operation,
        endpoint: entry.endpoint,
        ok: entry.ok,
        httpStatus: entry.httpStatus,
        latencyMs: entry.latencyMs,
        requestSummary: entry.requestSummary,
        responseSummary: entry.responseSummary,
        errorMessage: entry.errorMessage,
      },
      select: { id: true },
    });
    params.onWrite?.(row.id);

    // Passively captured off whichever call happened to carry it — there is no separate
    // "check the rate limit" request. Any exchange that didn't report it (e.g. a network
    // failure that never reached Beds24) simply has nothing to read.
    if (!entry.rateLimit) return;
    if (params.connectionId) {
      const { total, remaining, resetsInSec } = entry.rateLimit;
      await prisma.channelConnection
        .update({
          where: { id: params.connectionId },
          data: {
            rateLimitTotal: total,
            rateLimitRemaining: remaining,
            rateLimitResetsAt: new Date(Date.now() + resetsInSec * 1000),
            rateLimitObservedAt: new Date(),
          },
        })
        .catch((e) => console.error("could not record rate-limit state", e));
    } else {
      params.onRateLimit?.(entry.rateLimit);
    }
  };
}

// Service layer between the Hub's API routes and the Beds24 client. Owns the two things
// the routes must never do themselves: encryption-at-rest of the credentials, and keeping
// ChannelConnection.status honest. See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Credentials use the SAME pattern as the SMTP/SFTP secrets in EnterpriseSettings —
// encryptSecret() on write, decryptSecret() only at point of use, and never returned to a
// client. There is no "reveal" endpoint by design: a stored channel-manager token can move
// real inventory and take real bookings, so it is write-only from the UI's perspective.

export const CONNECTION_STATUS = {
  NOT_CONNECTED: "NOT_CONNECTED",
  CONNECTED: "CONNECTED",
  ERROR: "ERROR",
} as const;

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

// The only shape ever sent to the browser. Deliberately has no token fields at all,
// rather than masked ones — a field that cannot be serialised cannot be leaked by a
// future careless spread.
export type PublicConnection = {
  id: string;
  provider: string;
  name: string;
  status: string;
  hasCredentials: boolean;
  lastTokenRefreshAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  /** Whether an inbound webhook URL has been generated. The token itself is never returned
   *  — and since only its hash is stored, it could not be even if this wanted to. */
  hasWebhook: boolean;
  /** Null until the first refresh. Negative means the idle window has already lapsed. */
  daysUntilRefreshTokenExpiry: number | null;
  needsKeepAlive: boolean;
  refreshTokenIdleDays: number;
  createdAt: string;
  /** Last-observed Beds24 rate-limit state — null until the first real API call. */
  rateLimitTotal: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetsAt: string | null;
  rateLimitObservedAt: string | null;
  /** Operator-configured self-throttle floor. Null means disabled. */
  rateLimitPauseThreshold: number | null;
  /** Scheduled-poll lookback override in hours. Null means the built-in default (48). */
  pollLookbackHours: number | null;
};

export function toPublicConnection(c: ChannelConnection): PublicConnection {
  const provider = getProvider(c.provider);
  return {
    id: c.id,
    provider: c.provider,
    name: c.name,
    status: c.status,
    hasCredentials: !!c.refreshToken,
    lastTokenRefreshAt: c.lastTokenRefreshAt?.toISOString() ?? null,
    lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
    lastError: c.lastError,
    hasWebhook: !!c.webhookTokenHash,
    daysUntilRefreshTokenExpiry: provider.daysUntilRefreshTokenExpiry(c.lastTokenRefreshAt),
    needsKeepAlive: !!c.refreshToken && provider.needsKeepAlive(c.lastTokenRefreshAt),
    refreshTokenIdleDays: provider.refreshTokenIdleDays,
    createdAt: c.createdAt.toISOString(),
    rateLimitTotal: c.rateLimitTotal,
    rateLimitRemaining: c.rateLimitRemaining,
    rateLimitResetsAt: c.rateLimitResetsAt?.toISOString() ?? null,
    rateLimitObservedAt: c.rateLimitObservedAt?.toISOString() ?? null,
    rateLimitPauseThreshold: c.rateLimitPauseThreshold,
    pollLookbackHours: c.pollLookbackHours,
  };
}

export async function listConnections(enterpriseId: string): Promise<PublicConnection[]> {
  const rows = await prisma.channelConnection.findMany({
    where: { enterpriseId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublicConnection);
}

// The Osta console's cross-tenant shape: a PublicConnection plus which enterprise owns
// it. Same no-token-fields guarantee — going through toPublicConnection is the point.
export type PlatformConnection = PublicConnection & {
  enterprise: { id: string; name: string; slug: string };
};

/**
 * Every connection on the platform, across all enterprises — DELIBERATELY unscoped.
 *
 * Exists for the master-account topology (.agents/docs/DECISIONS.md, 2026-08-02): the
 * app owner runs one Beds24 account whose per-enterprise connections all drain a single
 * shared API credit pool, so the platform side needs to see and manage them in one
 * place. Only the Osta console may call this — every route in front of it must have
 * already verified ctx.isInternal, exactly like the cross-tenant property list in
 * /api/osta/properties. Tenant-facing code uses listConnections() and never this.
 */
export async function listAllConnections(): Promise<PlatformConnection[]> {
  const rows = await prisma.channelConnection.findMany({
    include: { enterprise: { select: { id: true, name: true, slug: true } } },
    orderBy: [{ enterprise: { name: "asc" } }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({ ...toPublicConnection(r), enterprise: r.enterprise }));
}

/**
 * Create a connection from a one-time Beds24 invite code.
 *
 * The exchange happens BEFORE the row is written, deliberately: a saved-but-unusable
 * connection is worse than no connection, because the Hub would then report a credential
 * it cannot actually authenticate with. If Beds24 rejects the code, nothing is persisted
 * and the operator sees the real reason.
 *
 * Invite codes are single-use, so a failure after a successful exchange would strand the
 * operator — the write therefore immediately follows the exchange with nothing in between.
 */
export async function createConnection(params: {
  enterpriseId: string;
  name: string;
  inviteCode: string;
  /** Which channel manager this connection talks to. Defaults to Beds24 — the only
   *  provider registered today — but every caller is free to name another once one exists. */
  provider?: string;
}): Promise<PublicConnection> {
  const { enterpriseId, name, inviteCode, provider: providerId = DEFAULT_PROVIDER_ID } = params;
  const provider = getProvider(providerId);

  // Logged with no connectionId — the row does not exist yet, and a REJECTED invite code
  // never creates one. Without this, the most common setup failure would leave no trace.
  // The written ids are captured so a SUCCESSFUL setup can be linked to the connection it
  // produced (below); otherwise a connection's own log would be missing the exchange that
  // created it, which is the first thing anyone looks for. The rate-limit reading is
  // captured the same way, for the same reason — it is real data this exchange saw, and
  // would otherwise be silently lost for having arrived one step too early.
  const setupLogIds: string[] = [];
  let setupRateLimit: RateLimitInfo | null = null;
  const tokens = await provider.exchangeInviteCode(
    inviteCode,
    makeLogSink({
      enterpriseId,
      connectionName: name,
      onWrite: (id) => setupLogIds.push(id),
      onRateLimit: (info) => {
        setupRateLimit = info;
      },
    })
  );
  const now = new Date();

  const created = await prisma.channelConnection.create({
    data: {
      enterpriseId,
      provider: provider.id,
      name,
      refreshToken: encryptSecret(tokens.refreshToken),
      accessToken: encryptSecret(tokens.accessToken || null),
      accessTokenExpiresAt: tokens.accessToken ? tokens.accessTokenExpiresAt : null,
      lastTokenRefreshAt: now,
      status: CONNECTION_STATUS.CONNECTED,
      lastHealthCheckAt: now,
      lastError: null,
    },
  });

  // Adopt the setup entries now that there is a connection to attach them to. Best-effort:
  // a failure here must not undo a connection that genuinely succeeded.
  if (setupLogIds.length > 0) {
    await prisma.channelSyncLog
      .updateMany({ where: { id: { in: setupLogIds } }, data: { connectionId: created.id } })
      .catch((e) => console.error("could not link setup logs to connection", e));
  }
  if (setupRateLimit) {
    const { total, remaining, resetsInSec } = setupRateLimit;
    await prisma.channelConnection
      .update({
        where: { id: created.id },
        data: {
          rateLimitTotal: total,
          rateLimitRemaining: remaining,
          rateLimitResetsAt: new Date(now.getTime() + resetsInSec * 1000),
          rateLimitObservedAt: now,
        },
      })
      .catch((e) => console.error("could not record setup rate-limit state", e));
    // `created` predates this update — re-read so the returned shape reflects it.
    return toPublicConnection(await prisma.channelConnection.findUniqueOrThrow({ where: { id: created.id } }));
  }

  return toPublicConnection(created);
}

/**
 * Return a usable access token, re-minting from the refresh token when the cached one is
 * missing or near expiry. This is the single entry point every future sync call should use
 * — it is also what keeps the refresh token alive, since exercising it resets Beds24's
 * 30-day idle clock.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error("Connection not found");
  if (!conn.refreshToken) throw new Error("Connection has no stored credentials");

  const provider = getProvider(conn.provider);
  const cached = decryptSecret(conn.accessToken);
  if (cached && !provider.isAccessTokenStale(conn.accessTokenExpiresAt)) {
    return cached;
  }

  const refreshToken = decryptSecret(conn.refreshToken);
  if (!refreshToken) throw new Error("Connection has no stored credentials");

  try {
    const fresh = await provider.refreshAccessToken(
      refreshToken,
      makeLogSink({ enterpriseId: conn.enterpriseId, connectionName: conn.name, connectionId: conn.id })
    );
    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptSecret(fresh.accessToken),
        accessTokenExpiresAt: fresh.accessTokenExpiresAt,
        lastTokenRefreshAt: new Date(),
        status: CONNECTION_STATUS.CONNECTED,
        lastError: null,
      },
    });
    return fresh.accessToken;
  } catch (e) {
    // Record WHY it failed — an operator staring at a broken connection needs the reason,
    // and a failed refresh is exactly how the 30-day idle death first shows up.
    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        status: CONNECTION_STATUS.ERROR,
        lastError: provider.toConnectionError(e),
        lastHealthCheckAt: new Date(),
      },
    });
    throw e;
  }
}

/**
 * Exercise the credentials and record the outcome. Health is OBSERVED, never assumed:
 * status only becomes CONNECTED because a real Beds24 call just succeeded. Doubles as the
 * keep-alive, since a successful refresh resets the idle clock.
 */
export async function testConnection(connectionId: string): Promise<PublicConnection> {
  const conn = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error("Connection not found");

  if (!conn.refreshToken) {
    const updated = await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        status: CONNECTION_STATUS.NOT_CONNECTED,
        lastHealthCheckAt: new Date(),
        lastError: "No credentials stored",
      },
    });
    return toPublicConnection(updated);
  }

  const provider = getProvider(conn.provider);
  const refreshToken = decryptSecret(conn.refreshToken);
  try {
    const fresh = await provider.refreshAccessToken(
      refreshToken!,
      makeLogSink({ enterpriseId: conn.enterpriseId, connectionName: conn.name, connectionId: conn.id })
    );
    const updated = await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encryptSecret(fresh.accessToken),
        accessTokenExpiresAt: fresh.accessTokenExpiresAt,
        lastTokenRefreshAt: new Date(),
        status: CONNECTION_STATUS.CONNECTED,
        lastHealthCheckAt: new Date(),
        lastError: null,
      },
    });
    return toPublicConnection(updated);
  } catch (e) {
    const updated = await prisma.channelConnection.update({
      where: { id: connectionId },
      data: {
        status: CONNECTION_STATUS.ERROR,
        lastHealthCheckAt: new Date(),
        lastError: provider.toConnectionError(e),
      },
    });
    return toPublicConnection(updated);
  }
}

/** Replace the credentials on an existing connection with a fresh invite code. */
export async function reauthorizeConnection(connectionId: string, inviteCode: string): Promise<PublicConnection> {
  const existing = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!existing) throw new Error("Connection not found");

  const provider = getProvider(existing.provider);
  const tokens = await provider.exchangeInviteCode(
    inviteCode,
    makeLogSink({
      enterpriseId: existing.enterpriseId,
      connectionName: existing.name,
      connectionId: existing.id,
    })
  );
  const now = new Date();
  const updated = await prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      refreshToken: encryptSecret(tokens.refreshToken),
      accessToken: encryptSecret(tokens.accessToken || null),
      accessTokenExpiresAt: tokens.accessToken ? tokens.accessTokenExpiresAt : null,
      lastTokenRefreshAt: now,
      status: CONNECTION_STATUS.CONNECTED,
      lastHealthCheckAt: now,
      lastError: null,
    },
  });
  return toPublicConnection(updated);
}

/**
 * Set (or clear) the operator's self-throttle floor. A negative or non-integer value is
 * rejected — the field means "pause once remaining credits reach this many", so anything
 * else could never actually be reached and would silently disable the feature.
 */
export async function setRateLimitPauseThreshold(connectionId: string, threshold: number | null): Promise<PublicConnection> {
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) {
    throw new Error("Pause threshold must be a non-negative whole number, or null to disable");
  }
  const updated = await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { rateLimitPauseThreshold: threshold },
  });
  return toPublicConnection(updated);
}

/** Ceiling on the STORED per-connection poll window: 30 days. A routine poll permanently
 *  re-reading more than a month on every run is a standing bulk export, not a safety net
 *  — a one-off catch-up should use the deep-resync path (pollConnection with an explicit
 *  lookbackHours, which has its own much higher ceiling) instead. Lives here rather than
 *  in poll.ts because poll.ts imports this module and the setter is what enforces it. */
export const MAX_STORED_LOOKBACK_HOURS = 720;

/** Set (or clear) the connection's scheduled-poll lookback window. Null = built-in default. */
export async function setPollLookbackHours(connectionId: string, hours: number | null): Promise<PublicConnection> {
  if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > MAX_STORED_LOOKBACK_HOURS)) {
    throw new Error(`Poll lookback must be a whole number of hours between 1 and ${MAX_STORED_LOOKBACK_HOURS}, or null for the default`);
  }
  const updated = await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { pollLookbackHours: hours },
  });
  return toPublicConnection(updated);
}

/**
 * Should a real Beds24 call be skipped right now to protect the account's shared credit
 * pool? Only true while the LAST OBSERVED reset window is still in the future — once it has
 * passed, Beds24 itself would have replenished the credits, so an old "remaining" number
 * must not keep pausing calls indefinitely.
 */
export function isRateLimitPaused(c: {
  rateLimitPauseThreshold: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetsAt: Date | null;
}): boolean {
  if (c.rateLimitPauseThreshold == null || c.rateLimitRemaining == null || !c.rateLimitResetsAt) return false;
  if (c.rateLimitResetsAt.getTime() <= Date.now()) return false;
  return c.rateLimitRemaining <= c.rateLimitPauseThreshold;
}
