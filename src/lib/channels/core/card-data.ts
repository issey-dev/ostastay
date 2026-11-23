// Payment-card data from channel bookings is NEVER stored (DECISIONS.md, "Channel bookings never
// store card details", 2026-11-23): not on the booking, the inbound record, its raw payload or
// the logs. Only a marker that a card was supplied is kept.
//
// Vendor-neutral on purpose — every channel manager's payload passes through here before it is
// stored, so a new vendor is covered without remembering to add anything.
//
// Two layers, because neither alone is enough:
//  1. KEYS that carry card data or a reusable payment reference (card numbers, CVC, expiry,
//     payment tokens such as Beds24's `stripeToken` / `pcibookingToken`) are removed whatever
//     their value looks like.
//  2. VALUES anywhere in the payload that look like a card number (13–19 digits passing the
//     Luhn check, spaces or dashes allowed) are masked — this catches a card typed into a free-
//     text field such as a guest message or note.

export const CARD_REMOVED = "[card removed]";

// Matched against the key lower-cased with `_`/`-` removed, so cardNumber, card_number and
// CARD-NUMBER are the same key.
const CARD_KEY_EXACT = new Set([
  "card",
  "cards",
  "creditcard",
  "cardnumber",
  "cardno",
  "ccnumber",
  "ccno",
  "pan",
  "cvc",
  "cvv",
  "cvv2",
  "cvc2",
  "csc",
  "securitycode",
  "cardexpiry",
  "cardexpiration",
  "expirymonth",
  "expiryyear",
  "expmonth",
  "expyear",
  "ccexpiry",
  "ccexp",
  "cardholder",
  "cardholdername",
  "nameoncard",
  "virtualcard",
  "vcc",
  "stripetoken",
  "pcibookingtoken",
  "paymenttoken",
  "cardtoken",
]);
const CARD_KEY_PREFIXES = ["creditcard", "cardnumber", "virtualcard", "ccnumber"];

function isCardKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[_-]/g, "");
  return CARD_KEY_EXACT.has(k) || CARD_KEY_PREFIXES.some((p) => k.startsWith(p));
}

// 13–19 digits, optionally grouped by single spaces or dashes, not glued to other digits.
const CARD_NUMBER_RE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Mask every card-number-looking run in a string. Returns the string and whether it changed. */
export function maskCardNumbers(text: string): { text: string; found: boolean } {
  let found = false;
  const out = text.replace(CARD_NUMBER_RE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return match;
    found = true;
    return CARD_REMOVED;
  });
  return { text: out, found };
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Return a deep copy of `value` with all card data removed, plus whether any was present.
 *
 * `cardSupplied` is true only when a card key carried a non-empty value or a card number was
 * found in text — an empty `stripeToken: null` on every Beds24 booking does not count.
 */
export function stripCardData<T>(value: T): { value: T; cardSupplied: boolean } {
  let cardSupplied = false;

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 32) return v;
    if (typeof v === "string") {
      const m = maskCardNumbers(v);
      if (m.found) cardSupplied = true;
      return m.text;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (isCardKey(k)) {
          if (!isEmpty(child)) cardSupplied = true;
          continue; // dropped entirely, not masked: nothing of it is kept
        }
        out[k] = walk(child, depth + 1);
      }
      return out;
    }
    return v;
  };

  return { value: walk(value, 0) as T, cardSupplied };
}
