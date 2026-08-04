import { prisma } from "@/lib/db";

// Server-side session state.
//
// Sessions were stateless JWTs until 2026-08-04: nobody could see who was signed in, and
// the only ways to end someone else's session were deactivating the account or the
// property-wide EOD watermark. The token is still the credential — it stays unforgeable
// without a DB round-trip — but a row now decides whether it is still HONOURED, which is
// what makes revocation and idle timeout immediate.
//
// Everything here fails CLOSED on a missing or revoked row and fails OPEN on nothing: a
// transient database error propagates as an error rather than being swallowed into "not
// authenticated", so an outage never silently logs out a property mid-shift.

/** How often lastSeenAt is written. A bounded write, not one per request. */
export const TOUCH_INTERVAL_MS = 60_000;

export type SessionRevokeReason = "LOGOUT" | "ADMIN" | "IDLE" | "EXPIRED";

export type LiveSession = {
  id: string;
  userId: string;
  jti: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  propertyId: string | null;
};

export async function createSessionRecord(params: {
  userId: string;
  jti: string;
  expiresAt: Date;
  propertyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return prisma.session.create({
    data: {
      userId: params.userId,
      jti: params.jti,
      expiresAt: params.expiresAt,
      propertyId: params.propertyId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

/**
 * The session this token belongs to, or null when it must not be honoured.
 *
 * Null means exactly one thing to the caller — treat the request as unauthenticated.
 * Distinguishing "revoked" from "expired" from "never existed" would leak whether a
 * given token was ever valid, and none of the three should let the request through.
 */
export async function findLiveSession(jti: string): Promise<LiveSession | null> {
  const s = await prisma.session.findUnique({ where: { jti } });
  if (!s) return null;
  if (s.revokedAt) return null;
  if (s.expiresAt.getTime() <= Date.now()) return null;
  return s;
}

/**
 * Stamp activity, but only when the existing stamp is stale.
 *
 * Conditional on lastSeenAt so concurrent requests from the same session don't each
 * write — under a burst, at most one wins and the rest match zero rows.
 */
export async function touchSession(session: LiveSession, now = new Date()): Promise<void> {
  if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.session.updateMany({
    where: { id: session.id, lastSeenAt: session.lastSeenAt },
    data: { lastSeenAt: now },
  });
}

export async function revokeSession(
  jti: string,
  reason: SessionRevokeReason,
  revokedByUserId?: string
): Promise<void> {
  await prisma.session.updateMany({
    where: { jti, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedByUserId: revokedByUserId ?? null },
  });
}

export async function revokeSessionById(
  id: string,
  reason: SessionRevokeReason,
  revokedByUserId?: string
): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedByUserId: revokedByUserId ?? null },
  });
  return res.count;
}

/** Every live session for a user — used when deactivating or deleting an account. */
export async function revokeAllForUser(
  userId: string,
  reason: SessionRevokeReason,
  revokedByUserId?: string
): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason, revokedByUserId: revokedByUserId ?? null },
  });
  return res.count;
}

/**
 * Has this session been idle too long?
 *
 * Pure so the rule is testable without a database. `idleMinutes <= 0` disables it, which
 * is the default and preserves the pre-2026-08-04 behaviour of a session living its full
 * span regardless of activity.
 *
 * Note the interaction with TOUCH_INTERVAL_MS: lastSeenAt can be up to a minute stale, so
 * a user is logged out somewhere between `idleMinutes` and `idleMinutes + 1` of true
 * inactivity. That slack is why the setting is in minutes and why a 1-minute timeout is
 * refused by the settings API rather than being quietly unreliable.
 */
export function isIdleExpired(
  lastSeenAt: Date,
  idleMinutes: number,
  now: Date = new Date()
): boolean {
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return false;
  return now.getTime() - lastSeenAt.getTime() > idleMinutes * 60_000;
}

/** Housekeeping: drop rows nobody can use again. Called from Night Audit. */
export async function purgeExpiredSessions(before = new Date()): Promise<number> {
  const res = await prisma.session.deleteMany({ where: { expiresAt: { lt: before } } });
  return res.count;
}
