import { randomBytes, createHash } from "crypto";

// 256 bits of entropy — brute force is computationally infeasible regardless of how the
// hash is stored, but the hash-at-rest below is the real hardening: a link is a bearer
// credential to submit/view a guest's PII for a specific stay, and a link exists per
// reservation — potentially every reservation, unlike the handful of ChannelConnection
// rows behind the channel webhook. A DB dump/backup/support query must never hand out a
// live, usable guest-facing URL. (The channel webhook token, once the plaintext holdout
// this comment named, now stores its hash the same way — see
// src/lib/channels/webhook-token.ts.)
export function generateEregistrationToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashEregistrationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Deliberately no "verify" helper that re-compares provided-vs-stored after the lookup:
// once a route does `findUnique({ where: { tokenHash: hashEregistrationToken(token) } })`,
// a row coming back already IS the equality check — its tokenHash column equals the
// value just queried by. A timingSafeEqual afterward would compare that hash to itself,
// which is deterministic and proves nothing. The real protections are token entropy,
// hashing at rest, and a generic response on a miss. (The channel webhook route once had
// exactly that redundant compare; it went when that token moved to hash-at-rest too.)
