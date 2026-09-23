import { prisma } from "@/lib/db";

// Rate limits for the public Booking API (src/app/api/website/v1/**) —
// BOOKING_API_ADDONS_PLAN.md Phase 0 §5, and the open "per-key rate limiting" item from
// WEBSITE_API_PLAN.md.
//
// Buckets, each a fixed one-minute window:
//  - read         per key   (GET)  — generous; a search page makes a few calls.
//  - write        per key   (POST) — quotes, holds, bookings, cancels.
//  - authFailure  per IP           — missing/unknown/revoked keys. Past the limit the
//                                    caller gets 429 instead of 401, so spraying keys
//                                    stops yielding answers.
// The proxy (deploy/proxy/Caddyfile) adds a coarse per-IP limit in front of all of this.
//
// Counters live in Postgres (ApiRateLimitCounter), NOT in memory: production runs several
// app replicas behind the proxy, and an in-process counter would let every key make N
// times its limit. One upsert per request is cheap at this API's scale. Fixed windows can
// admit up to 2x the limit across a minute boundary; that is an accepted simplification.

export type RateBucket = "read" | "write" | "authFailure";

export const RATE_LIMITS: Record<RateBucket, number> = {
  read: 120,
  write: 20,
  authFailure: 30,
};

const WINDOW_MS = 60_000;

export type RateDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetSeconds: number;
};

/** Count one request against `bucket` for `subject` (a key id or an IP). */
export async function consumeRateLimit(bucket: RateBucket, subject: string, now = Date.now()): Promise<RateDecision> {
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const key = `${bucket}:${subject}`;
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "ApiRateLimitCounter" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "ApiRateLimitCounter"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  const limit = RATE_LIMITS[bucket];

  // Opportunistic sweep of finished windows; no cron needed.
  if (Math.random() < 0.01) {
    await prisma.apiRateLimitCounter
      .deleteMany({ where: { windowStart: { lt: new Date(now - 5 * WINDOW_MS) } } })
      .catch(() => {});
  }

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: Math.max(1, Math.ceil((windowStart.getTime() + WINDOW_MS - now) / 1000)),
  };
}

/** Standard headers so well-behaved clients can pace themselves. */
export function rateLimitHeaders(d: RateDecision): Record<string, string> {
  return {
    "RateLimit-Limit": String(d.limit),
    "RateLimit-Remaining": String(d.remaining),
    "RateLimit-Reset": String(d.resetSeconds),
  };
}

// Test hook — not used by production code.
export async function _resetWebsiteRateLimiter(): Promise<void> {
  await prisma.apiRateLimitCounter.deleteMany({});
}
