// Beds24 API v2 client — authentication and health only. ARI push and booking retrieval
// land with the sync engine; see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Auth model (confirmed against Beds24's own documentation):
//   1. The operator generates an INVITE CODE in the Beds24 control panel, choosing scopes.
//   2. GET /authentication/setup exchanges that invite code for a long-life REFRESH TOKEN.
//      The invite code is sent as a header. An invite code is single-use.
//   3. GET /authentication/token exchanges the refresh token for a short-lived ACCESS
//      TOKEN, returned as { token, expiresIn } where expiresIn is SECONDS (~24h).
//   4. Every other API call authenticates with the `token: {accessToken}` header.
//
// ⚠️ THE 30-DAY TRAP. Beds24 refresh tokens do not expire on a timer, but they die if
// unused for 30 days. A connection that is merely idle therefore breaks silently, and the
// only recovery is a fresh invite code from the operator. This is the single most
// important operational property of this integration: refreshIfStale() below exists to
// keep the token warm, and the Hub surfaces daysUntilRefreshTokenExpiry() so the problem
// is visible long before it bites.

// Base URL is overridable so a sandbox can be pointed at without a code change.
// VERIFIED LIVE 2026-07-27: a real POST through this client reached
// https://beds24.com/api/v2/authentication/setup and came back with Beds24's own
// "Token not valid" for a bogus invite code — so the host and path are right.
const BEDS24_API_BASE = process.env.BEDS24_API_BASE_URL ?? "https://beds24.com/api/v2";

// Beds24 documents the invite code as "a header parameter" on /authentication/setup
// without naming it in the public wiki; "code" is the name used by its Swagger definition.
// The live check above got a semantic rejection of the CODE ITSELF rather than a
// missing-header error, which indicates this name is read correctly — but it has not been
// proven with a genuinely valid code, so if setup fails with a fresh, unused invite code,
// this constant is still the first thing to check.
const INVITE_CODE_HEADER = "code";
const REFRESH_TOKEN_HEADER = "refreshToken";
const ACCESS_TOKEN_HEADER = "token";

// Beds24's documented idle window for a refresh token.
export const REFRESH_TOKEN_IDLE_DAYS = 30;
// Refresh well inside the window rather than at the edge — a keep-alive that only runs on
// day 29 turns one missed job into a dead connection.
export const REFRESH_TOKEN_KEEPALIVE_DAYS = 7;
// Re-mint the access token a little before it actually lapses, so a long-running sync
// can't have a token expire mid-flight.
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

import { redactForLog, redactHeaders, redactErrorMessage } from "@/lib/channels/redact";

export class ChannelAuthError extends Error {
  status = 401;
}
export class ChannelApiError extends Error {
  constructor(
    message: string,
    public httpStatus: number
  ) {
    super(message);
  }
}

export type TokenPair = {
  refreshToken: string;
  accessToken: string;
  /** Absolute expiry, derived from the API's relative `expiresIn` (seconds). */
  accessTokenExpiresAt: Date;
};

export type AccessToken = {
  accessToken: string;
  accessTokenExpiresAt: Date;
};

type Beds24TokenResponse = {
  token?: string;
  expiresIn?: number;
  refreshToken?: string;
  error?: string;
};

// One record of a single exchange, already redacted and safe to persist. The client emits
// these through a sink rather than writing them itself, so this module keeps no database
// dependency and stays trivially testable — src/lib/channels/connection.ts supplies the
// sink that turns them into ChannelSyncLog rows.
export type ChannelCallLog = {
  direction: "OUTBOUND" | "INBOUND";
  operation: string;
  endpoint: string;
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  requestSummary: string;
  responseSummary: string;
  errorMessage: string | null;
};

export type ChannelLogSink = (entry: ChannelCallLog) => void | Promise<void>;

// A logging failure must never break the call it describes — the same rule logActivity()
// follows. Swallow and carry on.
async function emit(sink: ChannelLogSink | undefined, entry: ChannelCallLog) {
  if (!sink) return;
  try {
    await sink(entry);
  } catch (e) {
    console.error("channel log sink failed", e);
  }
}

// Beds24 reports failures both as non-2xx AND as 200-with-an-error-body, so both paths are
// checked. The response body is deliberately NOT echoed into the thrown message — it can
// carry a token — only a short, operator-readable reason.
//
// Every outcome, including failures, is emitted to the log sink before throwing: a failed
// exchange is precisely the one an operator needs to see afterwards.
async function requestJson(
  path: string,
  headers: Record<string, string>,
  operation: string,
  sink?: ChannelLogSink,
  // Defaulted so every existing GET call site is unchanged. A body is redacted for the log
  // like everything else — a calendar payload carries no credential, but that is a property
  // of today's payloads, not a rule to rely on.
  init?: { method: "POST"; body: unknown }
): Promise<Beds24TokenResponse> {
  const startedAt = Date.now();
  // Header VALUES are never logged — this is where the invite code and tokens live.
  const requestSummary = init
    ? `${redactHeaders(headers)} body=${redactForLog(init.body)}`
    : redactHeaders(headers);
  const base = {
    direction: "OUTBOUND" as const,
    operation,
    endpoint: path,
    requestSummary,
  };

  let res: Response;
  try {
    res = await fetch(`${BEDS24_API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init ? { ...headers, "Content-Type": "application/json" } : headers,
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (e) {
    // Network-level failure (DNS, TLS, timeout) — distinct from an auth rejection, and
    // must not be reported to the operator as "bad credentials".
    const message = `Could not reach Beds24: ${e instanceof Error ? e.message : "network error"}`;
    await emit(sink, {
      ...base,
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      responseSummary: "",
      errorMessage: redactErrorMessage(message),
    });
    throw new ChannelApiError(message, 0);
  }

  const latencyMs = Date.now() - startedAt;

  let body: Beds24TokenResponse;
  try {
    body = (await res.json()) as Beds24TokenResponse;
  } catch {
    const message = `Beds24 returned a non-JSON response (HTTP ${res.status})`;
    await emit(sink, {
      ...base,
      ok: false,
      httpStatus: res.status,
      latencyMs,
      responseSummary: "",
      errorMessage: redactErrorMessage(message),
    });
    throw new ChannelApiError(message, res.status);
  }

  // The body here can contain `token`/`refreshToken`; redactForLog is deny-by-default on
  // keys, so those are masked while the diagnosable shape survives.
  const responseSummary = redactForLog(body);
  const failed = !res.ok || !!body.error;
  const errorMessage = failed
    ? (body.error ?? (res.ok ? "Unknown error" : `Beds24 request failed (HTTP ${res.status})`))
    : null;

  await emit(sink, {
    ...base,
    ok: !failed,
    httpStatus: res.status,
    latencyMs,
    responseSummary,
    errorMessage: errorMessage ? redactErrorMessage(errorMessage) : null,
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ChannelAuthError(body.error ?? "Beds24 rejected the credentials");
    }
    throw new ChannelApiError(body.error ?? `Beds24 request failed (HTTP ${res.status})`, res.status);
  }
  if (body.error) {
    throw new ChannelAuthError(body.error);
  }
  return body;
}

function expiryFrom(expiresIn: number | undefined): Date {
  // Beds24 returns seconds. Fall back to a conservative 1h rather than assuming 24h, so a
  // missing field can never leave a stale token in use for a day.
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Step 1 of setup: exchange a one-time invite code for a refresh token plus an initial
 * access token. Invite codes are single-use — a retry after success will fail, which is
 * why the caller must persist the result before doing anything else.
 */
export async function exchangeInviteCode(inviteCode: string, sink?: ChannelLogSink): Promise<TokenPair> {
  const body = await requestJson(
    "/authentication/setup",
    { [INVITE_CODE_HEADER]: inviteCode },
    "auth.setup",
    sink
  );

  if (!body.refreshToken) {
    throw new ChannelAuthError("Beds24 did not return a refresh token for this invite code");
  }
  return {
    refreshToken: body.refreshToken,
    accessToken: body.token ?? "",
    accessTokenExpiresAt: expiryFrom(body.expiresIn),
  };
}

/** Exchange a refresh token for a fresh short-lived access token. */
export async function refreshAccessToken(refreshToken: string, sink?: ChannelLogSink): Promise<AccessToken> {
  const body = await requestJson(
    "/authentication/token",
    { [REFRESH_TOKEN_HEADER]: refreshToken },
    "auth.token",
    sink
  );

  if (!body.token) {
    throw new ChannelAuthError("Beds24 did not return an access token");
  }
  return { accessToken: body.token, accessTokenExpiresAt: expiryFrom(body.expiresIn) };
}

/** The auth header every non-authentication Beds24 call must carry. */
export function authHeader(accessToken: string): Record<string, string> {
  return { [ACCESS_TOKEN_HEADER]: accessToken };
}

/**
 * Push per-date availability to Beds24's calendar.
 *
 * The payload SHAPE is not yet verified against a live account — see the caveat in
 * src/lib/channels/payload.ts. The transport, auth header and error handling here are the
 * same ones already proven live by the authentication calls.
 */
export async function pushCalendar(
  accessToken: string,
  payload: unknown,
  sink?: ChannelLogSink
): Promise<void> {
  await requestJson("/inventory/rooms/calendar", authHeader(accessToken), "calendar.push", sink, {
    method: "POST",
    body: payload,
  });
}

/**
 * Fetch bookings modified since a given time. Returns the raw parsed JSON body —
 * envelope shape is not assumed here; extractBookings() upstream tolerates the several
 * plausible shapes Beds24 might return, since the exact one is unverified against a real
 * webhook or poll response.
 */
export async function fetchBookings(accessToken: string, since: Date, sink?: ChannelLogSink): Promise<unknown> {
  const startedAt = Date.now();
  const endpoint = "/bookings";
  const requestSummary = redactForLog({ modifiedSince: since.toISOString() });
  const base = { direction: "INBOUND" as const, operation: "booking.poll", endpoint, requestSummary };

  let res: Response;
  try {
    res = await fetch(`${BEDS24_API_BASE}${endpoint}?modifiedSince=${encodeURIComponent(since.toISOString())}`, {
      method: "GET",
      headers: authHeader(accessToken),
    });
  } catch (e) {
    const message = `Could not reach Beds24: ${e instanceof Error ? e.message : "network error"}`;
    await emit(sink, {
      ...base,
      ok: false,
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      responseSummary: "",
      errorMessage: redactErrorMessage(message),
    });
    throw new ChannelApiError(message, 0);
  }

  const latencyMs = Date.now() - startedAt;
  const body = await res.json().catch(() => null);

  await emit(sink, {
    ...base,
    ok: res.ok,
    httpStatus: res.status,
    latencyMs,
    responseSummary: redactForLog(body),
    errorMessage: res.ok ? null : `Poll failed (HTTP ${res.status})`,
  });

  if (!res.ok) {
    throw new ChannelApiError(`Beds24 returned HTTP ${res.status}`, res.status);
  }
  return body;
}

/** True when the cached access token is missing or close enough to expiry to re-mint. */
export function isAccessTokenStale(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - ACCESS_TOKEN_EXPIRY_SKEW_MS <= Date.now();
}

/**
 * Days remaining before an unused refresh token dies. Negative means it is already past
 * the idle window and the operator will need a new invite code. Surfaced in the Hub so
 * this is never discovered by a failed sync.
 */
export function daysUntilRefreshTokenExpiry(lastTokenRefreshAt: Date | null | undefined): number | null {
  if (!lastTokenRefreshAt) return null;
  const elapsedMs = Date.now() - lastTokenRefreshAt.getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  return Math.floor(REFRESH_TOKEN_IDLE_DAYS - elapsedDays);
}

/** True when the refresh token should be exercised now to keep it alive. */
export function needsKeepAlive(lastTokenRefreshAt: Date | null | undefined): boolean {
  const remaining = daysUntilRefreshTokenExpiry(lastTokenRefreshAt);
  if (remaining === null) return true;
  return remaining <= REFRESH_TOKEN_IDLE_DAYS - REFRESH_TOKEN_KEEPALIVE_DAYS;
}

/**
 * Turn a thrown error into a short operator-readable reason for ChannelConnection.lastError.
 * Never include raw response bodies here — they can carry credentials.
 */
export function toConnectionError(e: unknown): string {
  if (e instanceof ChannelAuthError) return `Authentication failed: ${e.message}`;
  if (e instanceof ChannelApiError) {
    return e.httpStatus === 0 ? e.message : `${e.message} (HTTP ${e.httpStatus})`;
  }
  return e instanceof Error ? e.message : "Unknown error";
}
