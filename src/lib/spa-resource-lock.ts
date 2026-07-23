// In-process keyed mutex for the Spa booking/reschedule critical section — see
// SPA_PLAN.md §7's "Concurrency strategy" (a corrected section: an earlier draft of
// that plan assumed SQLite alone would serialize concurrent bookings, which was an
// unverified assumption, not a checked guarantee). This makes the
// "read candidates -> pick -> overlap-recheck -> insert" sequence provably atomic at
// the JS level regardless of what the underlying DB connection pool does, for the
// single-process deployment this app actually runs as.
//
// Not a general-purpose lock library — just enough to serialize access to a small,
// short-lived set of string keys (one per room/therapist a booking touches).

type Releaser = () => void;

const tails = new Map<string, Promise<unknown>>();

function lockOne(key: string): Promise<Releaser> {
  const tail = tails.get(key) ?? Promise.resolve();
  let release!: Releaser;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The next acquire() for this key chains after `held`, i.e. after THIS caller
  // releases — that's what makes this a real mutex, not just a queue of no-ops.
  tails.set(key, tail.then(() => held));
  return tail.then(() => release);
}

export function roomLockKey(propertyId: string, roomId: string): string {
  return `${propertyId}:room:${roomId}`;
}

export function therapistLockKey(propertyId: string, therapistId: string): string {
  return `${propertyId}:therapist:${therapistId}`;
}

// Acquires every key (sorted, so two requests wanting overlapping key sets always
// acquire in the same order and can't deadlock each other), runs `fn`, then releases
// all of them — even if `fn` throws.
export async function withResourceLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const sortedKeys = Array.from(new Set(keys)).sort();
  const releasers: Releaser[] = [];
  for (const key of sortedKeys) {
    releasers.push(await lockOne(key));
  }
  try {
    return await fn();
  } finally {
    for (const release of releasers) release();
  }
}
