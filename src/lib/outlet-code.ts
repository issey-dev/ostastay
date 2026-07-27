// An Outlet's `code` doubles as the prefix on its sales-check numbers (SPA -> SPA-00001),
// so it must be a compact, printable identifier. Kept here (not in the API route) so the
// rules can be unit-tested without pulling in server-only dependencies.

export function normalizeOutletCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

// Returns an error message, or null when the code is valid.
export function validateOutletCode(code: string | null): string | null {
  if (!code) return "An outlet code is required";
  if (!/^[A-Z0-9]{2,8}$/.test(code)) {
    return "Outlet code must be 2–8 letters or digits (no spaces or symbols)";
  }
  return null;
}

// --- One-off backfill helpers (see scripts/dev-tools/backfill-outlet-codes.ts) ---

// Derives a short, valid base code from an outlet name: uppercased, letters/digits only,
// first 3 characters. Leaves room (max 8) for a numeric suffix if it collides. Falls back
// to "OUT" for a name with fewer than 2 usable characters.
export function deriveOutletCodeBase(name: string): string {
  const cleaned = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = cleaned.slice(0, 3);
  return base.length >= 2 ? base : "OUT";
}

// Picks the first available code for `base` given the codes already taken in a property
// (case-insensitive). Tries the base itself, then base+"2", base+"3", ... always staying
// within the 2–8 char rule. Does NOT mutate `taken` — the caller adds the result.
export function nextAvailableOutletCode(base: string, taken: Set<string>): string {
  const norm = (c: string) => c.toUpperCase();
  const takenUpper = new Set([...taken].map(norm));
  if (!takenUpper.has(norm(base)) && validateOutletCode(base) === null) return base;
  for (let n = 2; n < 100000; n++) {
    const candidate = `${base}${n}`;
    if (candidate.length <= 8 && !takenUpper.has(norm(candidate))) return candidate;
  }
  // Effectively unreachable for any realistic outlet count.
  throw new Error(`Could not derive a unique code from base "${base}"`);
}
