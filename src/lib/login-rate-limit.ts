// Simple in-memory sliding-window rate limiter for login attempts. Keyed by
// lowercased email (whether or not the account exists, so probing unknown emails is
// throttled identically). In-memory is a deliberate fit for this product's
// single-node deployment shape — no Redis dependency; a process restart clearing the
// counters is an acceptable trade-off. If the app ever runs multi-instance, this is
// the one place to swap the store.

const WINDOW_MS = 15 * 60_000; // failures older than this stop counting
const MAX_FAILURES = 5; // within the window, before lockout
const LOCKOUT_MS = 15 * 60_000;

type Entry = { failures: number[]; lockedUntil: number | null };

const attempts = new Map<string, Entry>();

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

// Returns remaining lockout seconds, or 0 when the caller may attempt a login.
export function lockoutRemainingSeconds(email: string, now = Date.now()): number {
  const entry = attempts.get(keyFor(email));
  if (!entry?.lockedUntil) return 0;
  if (entry.lockedUntil <= now) {
    attempts.delete(keyFor(email));
    return 0;
  }
  return Math.ceil((entry.lockedUntil - now) / 1000);
}

export function recordLoginFailure(email: string, now = Date.now()): void {
  const key = keyFor(email);
  const entry = attempts.get(key) ?? { failures: [], lockedUntil: null };
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS;
    entry.failures = [];
  }
  attempts.set(key, entry);

  // Opportunistic cleanup so the map can't grow unboundedly under a spray attack.
  if (attempts.size > 10_000) {
    for (const [k, e] of attempts) {
      const stale =
        (!e.lockedUntil || e.lockedUntil <= now) &&
        e.failures.every((t) => now - t >= WINDOW_MS);
      if (stale) attempts.delete(k);
    }
  }
}

export function recordLoginSuccess(email: string): void {
  attempts.delete(keyFor(email));
}

// Test hook — not used by production code.
export function _resetLoginRateLimiter(): void {
  attempts.clear();
}
