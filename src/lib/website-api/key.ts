import { randomBytes, createHash } from "crypto";

// Website API keys — the credential a property's brand website presents on every call to
// /api/website/v1/**. Minted in the Hub (src/lib/website-api/keys.ts), resolved on every
// request (src/lib/website-api/resolve-key.ts).
//
// Shape: "wsk_" + 64 hex chars (256 bits of entropy). The fixed prefix makes a leaked key
// recognisable in logs and secret scanners, and lets the Hub show the first few characters
// as a label without ever showing the rest.
//
// Storage: SHA-256 hash only — the same construction and the same reasoning as the channel
// webhook token (src/lib/channels/webhook-token.ts) and the eRegistration link
// (src/lib/eregistration/token.ts). Possession of a key is authority to read a tenant's
// availability and prices and to CREATE bookings in their PMS, so a pg_dump, a backup, or
// a support query must never hand out a live, usable one. The plaintext exists exactly
// once: in the response to the request that minted it.

export const WEBSITE_API_KEY_PREFIX = "wsk_";

/** Characters of the plaintext kept alongside the hash purely as a display label. */
const DISPLAY_PREFIX_LENGTH = 12;

export function generateWebsiteApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = `${WEBSITE_API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  return { key, keyHash: hashWebsiteApiKey(key), keyPrefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

export function hashWebsiteApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Pull the key off a request. Two spellings are accepted so the website can use whichever
 * its HTTP client makes easy:
 *   Authorization: Bearer wsk_…      (preferred — what docs/WEBSITE_API.md shows)
 *   X-Api-Key: wsk_…
 * Never the query string: URLs land in access logs, browser history and Referer headers.
 */
export function extractWebsiteApiKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  const header = request.headers.get("x-api-key");
  if (header && header.trim()) return header.trim();
  return null;
}

// Deliberately no "verify" helper that re-compares provided-vs-stored after the lookup:
// once resolve-key.ts does `findUnique({ where: { keyHash: hashWebsiteApiKey(key) } })`, a
// row coming back already IS the equality check. See the matching note in
// src/lib/channels/webhook-token.ts.
