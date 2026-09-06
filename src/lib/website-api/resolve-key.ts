import { prisma } from "@/lib/db";
import { extractWebsiteApiKey, hashWebsiteApiKey } from "@/lib/website-api/key";

export type ResolvedWebsiteKey = {
  id: string;
  enterpriseId: string;
  name: string;
  /** ACTIVE properties this key may act on. A pending/rejected property is invisible. */
  propertyIds: string[];
  allowedOrigins: string[];
};

export type WebsiteKeyResolution =
  | { ok: true; key: ResolvedWebsiteKey }
  | { ok: false; status: number; error: string; code: string };

// lastUsedAt is a "when did this site last call us" indicator for the Hub, not an audit
// trail — stamping it on every request would turn each read into a write. Once a minute
// is plenty, same idea as Session.lastSeenAt's TOUCH_INTERVAL.
const LAST_USED_STAMP_INTERVAL_MS = 60_000;

/**
 * The one place every Website API route resolves its caller. Scoping (enterpriseId, the
 * set of propertyIds) always comes from the resolved row, never from a client-supplied
 * value — mirrors src/lib/eregistration/resolve-link.ts and the channel webhook route.
 *
 * Every rejection reads the same to the caller ("invalid or inactive") whether the key is
 * unknown, revoked or expired: a key is a bearer credential and a distinguishable response
 * would let its state be probed. The Hub shows the real state to the people who own it.
 */
export async function resolveWebsiteApiKey(request: Request): Promise<WebsiteKeyResolution> {
  const raw = extractWebsiteApiKey(request);
  if (!raw) {
    return {
      ok: false,
      status: 401,
      error: "Missing API key. Send it as 'Authorization: Bearer <key>'.",
      code: "MISSING_API_KEY",
    };
  }

  const row = await prisma.websiteApiKey.findUnique({
    where: { keyHash: hashWebsiteApiKey(raw) },
    select: {
      id: true,
      enterpriseId: true,
      name: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      allowedOrigins: true,
      properties: { select: { property: { select: { id: true, status: true } } } },
    },
  });

  const invalid: WebsiteKeyResolution = {
    ok: false,
    status: 401,
    error: "Invalid or inactive API key.",
    code: "INVALID_API_KEY",
  };
  if (!row) return invalid;
  if (row.status !== "ACTIVE") return invalid;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return invalid;

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_STAMP_INTERVAL_MS) {
    // Best-effort — a failed stamp must never fail the request it describes.
    await prisma.websiteApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => undefined);
  }

  return {
    ok: true,
    key: {
      id: row.id,
      enterpriseId: row.enterpriseId,
      name: row.name,
      propertyIds: row.properties.filter((p) => p.property.status === "ACTIVE").map((p) => p.property.id),
      allowedOrigins: row.allowedOrigins,
    },
  };
}

/**
 * Whether a key may act on a property. Callers answer "no" with a 404, never a 403 — a key
 * for one hotel must not be able to confirm that a sibling hotel's id exists.
 */
export function keyCanAccessProperty(key: ResolvedWebsiteKey, propertyId: string): boolean {
  return key.propertyIds.includes(propertyId);
}
