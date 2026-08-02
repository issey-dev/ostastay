import { randomBytes, createHash } from "crypto";

// 256 bits of entropy, hex-encoded — unchanged from when this token was stored in the
// clear, so the URL already sitting in a channel manager's webhook settings keeps the
// same shape. Only the storage moved.
export function generateWebhookToken(): string {
  return randomBytes(32).toString("hex");
}

// The raw token is never stored, only this hash. Brute force was never the threat that
// mattered here — 256 bits settles that whether the column is hashed or not — DB READ
// ACCESS was: a webhook URL is a WRITE-CAPABLE bearer credential (possession of it is
// authority to POST bookings into a tenant's PMS, see
// src/app/api/channels/webhook/[token]/route.ts), so a pg_dump, a backup, or a support
// query must never hand out a live, usable one. Same reasoning, same construction, as
// the guest-facing eRegistration link — see src/lib/eregistration/token.ts.
export function hashWebhookToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Deliberately no "verify" helper that re-compares provided-vs-stored after the lookup.
// This route USED to do exactly that, timing-safely, and it was worth doing while the
// column held plaintext — it removed the timing signal from the index probe. Once the
// lookup is `findUnique({ where: { webhookTokenHash: hashWebhookToken(token) } })`, a row
// coming back already IS the equality check: its webhookTokenHash column equals the value
// just queried by, so a timingSafeEqual afterwards would compare that hash to itself. It
// is deterministic and proves nothing. The real protections are token entropy, hashing at
// rest, and a response that reads identically for a bad token and an unknown one.
