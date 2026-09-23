import type { Prisma } from "@prisma/client";

// Database-level mutual exclusion for booking critical sections (Excursion seats, Spa
// therapists/rooms). Replaces the in-process mutex src/lib/spa-resource-lock.ts used to
// provide, which only held while the app ran as ONE Node process — and the Excursion
// capacity check, which had no lock at all (count-then-write). The public Booking API
// (BOOKING_API_ADDONS_PLAN.md, Phase 0 §3) makes both races reachable from the internet.
//
// pg_advisory_xact_lock is transaction-scoped: it is released by COMMIT or ROLLBACK, so a
// lock can never leak past the transaction that took it, whatever the calling code does.
// Everything that decides "is there still room?" must therefore run AFTER the lock is
// taken and the write must commit in the SAME transaction.
//
// Reads made through the global client (not `tx`) while the lock is held are still safe:
// a competitor holding the same key cannot release it before its own COMMIT, so by the
// time we hold the lock its rows are committed and visible under READ COMMITTED.

/** Keys are sorted and de-duplicated so two callers wanting overlapping sets always
 *  acquire in the same order and can never deadlock each other. */
export async function lockKeys(tx: Prisma.TransactionClient, keys: string[]): Promise<void> {
  const sorted = Array.from(new Set(keys)).sort();
  for (const key of sorted) {
    // hashtextextended gives a 64-bit key from the string, so collisions between
    // unrelated resources are negligible (and a collision only serializes, never corrupts).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

export const lockKey = {
  excursionDeparture: (departureId: string) => `excursion:departure:${departureId}`,
  spaRoom: (propertyId: string, roomId: string) => `spa:${propertyId}:room:${roomId}`,
  spaTherapist: (propertyId: string, therapistId: string) => `spa:${propertyId}:therapist:${therapistId}`,
};

/** Interactive-transaction options for a booking critical section. The default 5s
 *  timeout is too tight once a request queues behind a competitor's lock. */
export const BOOKING_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
