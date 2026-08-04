import { describe, it, expect } from "vitest";
import { isIdleExpired, TOUCH_INTERVAL_MS } from "@/lib/session-store";

// The idle-timeout rule. Pure, so the boundary conditions can be pinned exactly — this
// decides when a front-desk terminal that has been walked away from stops being usable,
// and getting it wrong either logs a busy cashier out mid-shift or never logs anyone out.

const at = (msAgo: number) => new Date(Date.now() - msAgo);
const MIN = 60_000;

describe("Idle timeout", () => {
  it("is disabled at 0 — the default, preserving the pre-2026-08-04 behaviour", () => {
    // A session used to live its full 24h regardless of activity. Every property starts
    // at 0, so this deploy changes nobody's behaviour until someone sets a timeout.
    expect(isIdleExpired(at(365 * 24 * 60 * MIN), 0)).toBe(false);
  });

  it("treats a negative setting as disabled rather than as instant expiry", () => {
    expect(isIdleExpired(at(10 * MIN), -5)).toBe(false);
  });

  it("expires once inactivity exceeds the window", () => {
    expect(isIdleExpired(at(16 * MIN), 15)).toBe(true);
  });

  it("does not expire inside the window", () => {
    expect(isIdleExpired(at(14 * MIN), 15)).toBe(false);
  });

  it("does not expire exactly ON the boundary — strictly greater than", () => {
    const now = new Date();
    const lastSeen = new Date(now.getTime() - 15 * MIN);
    expect(isIdleExpired(lastSeen, 15, now)).toBe(false);
    expect(isIdleExpired(new Date(lastSeen.getTime() - 1), 15, now)).toBe(true);
  });

  it("never expires a session seen just now", () => {
    expect(isIdleExpired(new Date(), 1)).toBe(false);
  });

  it("ignores a non-finite setting instead of throwing", () => {
    expect(isIdleExpired(at(60 * MIN), Number.NaN)).toBe(false);
    expect(isIdleExpired(at(60 * MIN), Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("handles a clock that appears to run backwards", () => {
    // lastSeenAt in the future (clock skew between app servers) must not read as idle.
    const now = new Date();
    expect(isIdleExpired(new Date(now.getTime() + 5 * MIN), 15, now)).toBe(false);
  });
});

describe("Timeout granularity vs the activity stamp", () => {
  it("stamps at most once a minute, which bounds how stale lastSeenAt can be", () => {
    expect(TOUCH_INTERVAL_MS).toBe(60_000);
  });

  it("means a 1-minute timeout is unreliable, which is why the API refuses one", () => {
    // With lastSeenAt up to TOUCH_INTERVAL_MS stale, a user is signed out somewhere
    // between `idleMinutes` and `idleMinutes + 1`. That slack is tolerable at 15 minutes
    // and meaningless at 1 — see the minimum enforced in the property settings route.
    const slackMinutes = TOUCH_INTERVAL_MS / MIN;
    expect(slackMinutes).toBe(1);
  });
});
