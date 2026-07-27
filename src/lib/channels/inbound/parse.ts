// Normalises a raw Beds24 booking into the shape ostastay understands.
//
// ⚠️ THE SOURCE SHAPE IS NOT VERIFIED AGAINST A LIVE ACCOUNT. Beds24's booking payload —
// both the webhook body and `GET /bookings` — is documented only in its account-gated
// Swagger. The field names below follow Beds24's published booking vocabulary.
//
// Everything here is arranged so that being wrong is survivable rather than destructive:
//   - this module is PURE and exhaustively unit tested against fixtures, so its behaviour
//     is pinned independently of whether the field names are right,
//   - the RAW payload is always stored by the caller, even when parsing fails, so a
//     mis-parse is replayable once the real shape is known rather than lost,
//   - a partially-understood booking is kept with a `problem` note rather than discarded,
//   - nothing here creates a Reservation, so a wrong field cannot corrupt the PMS.
//
// Field names are read leniently (several plausible spellings accepted) precisely BECAUSE
// they are unverified — the cost of accepting an extra alias is nil, and the cost of
// missing the real one is a booking that silently arrives blank.

export type ParsedBooking = {
  externalBookingId: string | null;
  externalRoomId: string | null;
  channelName: string | null;
  channelStatus: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  arrival: Date | null;
  departure: Date | null;
  adults: number | null;
  children: number | null;
  totalAmount: number | null;
  currency: string | null;
  /** Populated when something required is missing or unusable. */
  problem: string | null;
};

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  // Beds24 ids arrive as numbers in some payloads and strings in others.
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a YYYY-MM-DD date at LOCAL midnight.
 *
 * Deliberately not `new Date(str)`: that treats a bare date as UTC, so in any timezone
 * ahead of UTC the stay would land on the previous local day — a guest arriving a day
 * early in the system. The same hazard as formatLocalDay() on the outbound side.
 */
function parseDay(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** First non-null value for any of the candidate keys. */
function pick(src: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (src[k] !== undefined && src[k] !== null) return src[k];
  }
  return undefined;
}

export function parseBeds24Booking(raw: unknown): ParsedBooking {
  const empty: ParsedBooking = {
    externalBookingId: null,
    externalRoomId: null,
    channelName: null,
    channelStatus: null,
    guestFirstName: null,
    guestLastName: null,
    guestEmail: null,
    arrival: null,
    departure: null,
    adults: null,
    children: null,
    totalAmount: null,
    currency: null,
    problem: "Payload was not an object",
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const b = raw as Record<string, unknown>;

  const externalBookingId = str(pick(b, ["id", "bookingId", "bookId"]));
  const externalRoomId = str(pick(b, ["roomId", "roomid", "room"]));
  const arrival = parseDay(pick(b, ["arrival", "checkIn", "firstNight"]));
  const departure = parseDay(pick(b, ["departure", "checkOut", "lastNight"]));

  const problems: string[] = [];
  // The booking id is the idempotency key — without it a retry would duplicate.
  if (!externalBookingId) problems.push("no booking id");
  if (!externalRoomId) problems.push("no room id");
  if (!arrival) problems.push("no arrival date");
  if (!departure) problems.push("no departure date");
  // A zero- or negative-length stay cannot be placed; catching it here keeps the problem
  // legible instead of surfacing later as an odd availability result.
  if (arrival && departure && departure.getTime() <= arrival.getTime()) {
    problems.push("departure is not after arrival");
  }

  return {
    externalBookingId,
    externalRoomId,
    channelName: str(pick(b, ["referer", "channel", "apiSource", "source"])),
    channelStatus: str(pick(b, ["status", "bookingStatus"])),
    guestFirstName: str(pick(b, ["firstName", "guestFirstName"])),
    guestLastName: str(pick(b, ["lastName", "guestName", "guestLastName"])),
    guestEmail: str(pick(b, ["email", "guestEmail"])),
    arrival,
    departure,
    adults: num(pick(b, ["numAdult", "adults", "numAdults"])),
    children: num(pick(b, ["numChild", "children", "numChildren"])),
    totalAmount: num(pick(b, ["price", "totalPrice", "total"])),
    currency: str(pick(b, ["currency"])),
    problem: problems.length > 0 ? `Could not fully read the booking: ${problems.join(", ")}` : null,
  };
}

/**
 * Pull the booking list out of a webhook body or a `GET /bookings` response.
 *
 * Accepts a bare array, a single booking object, or `{ data: [...] }` / `{ bookings: [...] }`
 * — again because the exact envelope is unverified, and guessing wrong here would mean
 * silently receiving nothing at all.
 */
export function extractBookings(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["data", "bookings", "booking"]) {
      const v = p[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") return [v];
    }
    // A single booking posted directly.
    if (p.id !== undefined || p.bookingId !== undefined) return [payload];
  }
  return [];
}

/** Channel status words that mean the booking is no longer holding inventory. */
const CANCELLED_WORDS = new Set(["cancelled", "canceled", "black", "0"]);

export function isCancelledStatus(status: string | null): boolean {
  return status !== null && CANCELLED_WORDS.has(status.trim().toLowerCase());
}
