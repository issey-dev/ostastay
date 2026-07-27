import type { ChannelConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";
import {
  exchangeInviteCode,
  refreshAccessToken,
  isAccessTokenStale,
  daysUntilRefreshTokenExpiry,
  needsKeepAlive,
  toConnectionError,
  REFRESH_TOKEN_IDLE_DAYS,
  type ChannelLogSink,
} from "@/lib/channels/beds24";

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
  /** Null until the first refresh. Negative means the idle window has already lapsed. */
  daysUntilRefreshTokenExpiry: number | null;
  needsKeepAlive: boolean;
  refreshTokenIdleDays: number;
  createdAt: string;
};

export function toPublicConnection(c: ChannelConnection): PublicConnection {
  return {
    id: c.id,
    provider: c.provider,
    name: c.name,
    status: c.status,
    hasCredentials: !!c.refreshToken,
    lastTokenRefreshAt: c.lastTokenRefreshAt?.toISOString() ?? null,
    lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
    lastError: c.lastError,
    daysUntilRefreshTokenExpiry: daysUntilRefreshTokenExpiry(c.lastTokenRefreshAt),
    needsKeepAlive: !!c.refreshToken && needsKeepAlive(c.lastTokenRefreshAt),
    refreshTokenIdleDays: REFRESH_TOKEN_IDLE_DAYS,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listConnections(enterpriseId: string): Promise<PublicConnection[]> {
  const rows = await prisma.channelConnection.findMany({
    where: { enterpriseId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPublicConnection);
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
}): Promise<PublicConnection> {
  const { enterpriseId, name, inviteCode } = params;

  // Logged with no connectionId — the row does not exist yet, and a REJECTED invite code
  // never creates one. Without this, the most common setup failure would leave no trace.
  // The written ids are captured so a SUCCESSFUL setup can be linked to the connection it
  // produced (below); otherwise a connection's own log would be missing the exchange that
  // created it, which is the first thing anyone looks for.
  const setupLogIds: string[] = [];
  const tokens = await exchangeInviteCode(
    inviteCode,
    makeLogSink({ enterpriseId, connectionName: name, onWrite: (id) => setupLogIds.push(id) })
  );
  const now = new Date();

  const created = await prisma.channelConnection.create({
    data: {
      enterpriseId,
      provider: "BEDS24",
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

  const cached = decryptSecret(conn.accessToken);
  if (cached && !isAccessTokenStale(conn.accessTokenExpiresAt)) {
    return cached;
  }

  const refreshToken = decryptSecret(conn.refreshToken);
  if (!refreshToken) throw new Error("Connection has no stored credentials");

  try {
    const fresh = await refreshAccessToken(
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
        lastError: toConnectionError(e),
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

  const refreshToken = decryptSecret(conn.refreshToken);
  try {
    const fresh = await refreshAccessToken(
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
        lastError: toConnectionError(e),
      },
    });
    return toPublicConnection(updated);
  }
}

/** Replace the credentials on an existing connection with a fresh invite code. */
export async function reauthorizeConnection(connectionId: string, inviteCode: string): Promise<PublicConnection> {
  const existing = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!existing) throw new Error("Connection not found");

  const tokens = await exchangeInviteCode(
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
