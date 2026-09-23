-- Fixed one-minute request counters for the public Booking API's rate limiter
-- (src/lib/website-api/rate-limit.ts, BOOKING_API_ADDONS_PLAN.md Phase 0 §5).
--
-- In the database rather than in memory because production runs several app replicas
-- behind the proxy (deploy/proxy/Caddyfile, `dynamic a` + least_conn): a per-process
-- counter would let a key make N times its limit. One row per (bucket:subject, minute);
-- old rows are swept opportunistically by the limiter itself.
CREATE TABLE "ApiRateLimitCounter" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiRateLimitCounter_pkey" PRIMARY KEY ("key","windowStart")
);

CREATE INDEX "ApiRateLimitCounter_windowStart_idx" ON "ApiRateLimitCounter"("windowStart");
