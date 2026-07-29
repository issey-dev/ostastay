import { randomBytes, createHash } from "crypto";

// 256 bits of entropy — brute force is computationally infeasible regardless of how the
// hash is stored, but the hash-at-rest below is the real hardening: a link is a bearer
// credential to submit/view a guest's PII for a specific stay, and a link exists per
// reservation (potentially every reservation, unlike the handful of ChannelConnection
// rows the webhook route's plaintext-token precedent protects). A DB dump/backup/support
// query must never hand out a live, usable guest-facing URL.
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
// which is deterministic and proves nothing (the same is true of the channel webhook
// route's own post-lookup compare, out of scope to change here). The real protections
// are token entropy, hashing at rest, and a generic response on a miss.
