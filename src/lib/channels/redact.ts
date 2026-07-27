// Redaction for anything written to ChannelSyncLog.
//
// The channel-manager exchanges being logged carry invite codes, refresh tokens and access
// tokens. ChannelSyncLog is PLAINTEXT and readable by anyone with Hub view access, so a
// credential landing in it would defeat the encryption-at-rest on ChannelConnection
// completely. Everything logged goes through here first.
//
// The design is deliberately DENY-BY-DEFAULT on keys: a key is redacted unless it is
// recognisably harmless. That way a field Beds24 adds tomorrow — or one a future developer
// forgets to think about — is redacted automatically rather than leaked by omission. The
// opposite arrangement (a blocklist of known-secret names) fails open, which is exactly the
// wrong direction for credentials.

export const REDACTED = "[redacted]";

// Key names whose VALUES are safe to keep verbatim. Everything else is masked.
const SAFE_KEYS = new Set([
  "status",
  "statusCode",
  "httpStatus",
  "code", // NOTE: only ever an HTTP/error code here — the invite code is never in a body
  "error",
  "errorCode",
  "message",
  "type",
  "success",
  "ok",
  "expiresIn",
  "count",
  "total",
  "page",
  "pageSize",
  "id",
  "propertyId",
  "roomId",
  "bookingId",
  "arrival",
  "departure",
  "endpoint",
  "operation",
  "direction",
  "latencyMs",
]);

// Even a "safe" key must not carry an unbounded blob into the log.
const MAX_STRING = 200;
const MAX_SUMMARY = 2000;
const MAX_DEPTH = 4;
const MAX_ARRAY = 10;

function truncate(s: string, max = MAX_STRING): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(+${s.length - max} chars)`;
}

/**
 * Recursively rebuild a value, keeping only whitelisted keys' values and masking the rest.
 * Structure is preserved (so the shape of a response is still diagnosable) while the
 * contents are not disclosed.
 */
function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `…(+${value.length - MAX_ARRAY} more)`] : head;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SAFE_KEYS.has(k) ? redactValue(v, depth + 1) : REDACTED;
    }
    return out;
  }

  if (typeof value === "string") return truncate(value);
  // Numbers and booleans cannot meaningfully carry a credential.
  if (typeof value === "number" || typeof value === "boolean") return value;
  return REDACTED;
}

/** Redact an arbitrary value into a bounded, log-safe JSON string. */
export function redactForLog(value: unknown): string {
  try {
    return truncate(JSON.stringify(redactValue(value, 0)) ?? "null", MAX_SUMMARY);
  } catch {
    // Circular or otherwise unserialisable — say so rather than risk a partial dump.
    return REDACTED;
  }
}

/**
 * Summarise outbound request headers. Header NAMES are kept (knowing which auth header was
 * sent is genuinely useful when debugging) but every value is masked unconditionally —
 * these are precisely where the invite code and tokens live, so there is no whitelist here
 * at all.
 */
export function redactHeaders(headers: Record<string, string>): string {
  const names = Object.keys(headers);
  if (names.length === 0) return "{}";
  return truncate(JSON.stringify(Object.fromEntries(names.map((n) => [n, REDACTED]))), MAX_SUMMARY);
}

/**
 * Error messages can quote a rejected credential back at us. Mask anything that looks like
 * a long opaque token before the message is stored.
 */
export function redactErrorMessage(message: string): string {
  // Runs of 20+ token-ish characters — long enough not to catch ordinary words, and JWTs
  // (which contain dots) are covered by allowing them in the class.
  return truncate(message.replace(/[A-Za-z0-9._~+/=-]{20,}/g, REDACTED));
}
