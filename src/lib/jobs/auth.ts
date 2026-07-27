import { createHash, timingSafeEqual } from "crypto";

// Authentication for the cron endpoint (/api/jobs/run).
//
// This endpoint is reachable from outside and runs privileged work across EVERY enterprise,
// so it is not a normal session route — there is no user, and requireSession() has nothing
// to check. It is guarded by a shared secret instead.
//
// FAILS CLOSED: with CRON_SECRET unset the endpoint refuses every request rather than
// running unauthenticated. An unset secret is a deployment mistake, and the safe reading of
// a deployment mistake is "do nothing", never "let anyone trigger it".

export const CRON_SECRET_HEADER = "x-cron-secret";

export type CronAuthResult = { ok: true } | { ok: false; status: number; error: string };

export function verifyCronSecret(provided: string | null): CronAuthResult {
  const expected = process.env.CRON_SECRET;

  if (!expected || expected.length === 0) {
    // 503, not 401 — the caller's credentials are not the problem; the server is not
    // configured to accept any.
    return { ok: false, status: 503, error: "Job runner is not configured (CRON_SECRET is unset)" };
  }
  if (!provided) {
    return { ok: false, status: 401, error: "Missing credentials" };
  }

  // Compare digests, not raw values: timingSafeEqual throws on length mismatch, which would
  // itself leak the secret's length. Hashing first makes both sides a fixed 32 bytes, so
  // the comparison is constant-time over the whole input.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Invalid credentials" };
  }
  return { ok: true };
}
