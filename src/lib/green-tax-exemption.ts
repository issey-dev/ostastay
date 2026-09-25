import { isMaldivianNationality } from "@/lib/countries";
import { ageOn } from "@/lib/green-tax-sheet";

// ─── Who pays Green Tax — one rule for posting, quotes, the MIRA sheet and the profile ──
// Owner, 2026-09-25 (DECISIONS "Green Tax per guest"): Green Tax is per person per night,
// and a guest is exempt when
//   · they are under the exemption age (EnterpriseSettings.greenTaxExemptAge, default 2)
//     at check-in — an infant;
//   · their nationality is Maldivian;
//   · they hold a Maldives work permit (an identification document flagged isWorkPermit);
//   · or their profile's "Green Tax exempt" box is ticked by hand.
// The first three are automatic — worked out from the profile every time, never stored —
// so an infant who turns two, or a guest whose nationality is corrected, is charged right
// without anyone re-ticking a box.
//
// A reservation's head counts (adults / children / infants) stay the basis — not every
// person in a room is a named profile. The named guests who are exempt come OFF those
// counts: see greenTaxPax.

export type GreenTaxExemptReason = "INFANT" | "MALDIVIAN" | "WORK_PERMIT" | "MANUAL";

export const EXEMPT_REASON_LABELS: Record<GreenTaxExemptReason, string> = {
  INFANT: "Under the exemption age",
  MALDIVIAN: "Maldivian national",
  WORK_PERMIT: "Work permit holder",
  MANUAL: "Marked exempt on the profile",
};

/** What a profile must be loaded with to judge its Green Tax exemption. */
export const GREEN_TAX_GUEST_SELECT = {
  upid: true,
  dateOfBirth: true,
  nationality: true,
  greenTaxExempt: true,
  documents: { select: { isWorkPermit: true } },
} as const;

export type GreenTaxGuest = {
  upid?: string;
  dateOfBirth: Date | string | null;
  nationality: string | null;
  greenTaxExempt?: boolean | null;
  documents?: { isWorkPermit: boolean }[] | null;
};

// Nationality arrives as an alpha-2/alpha-3 code, a country name or a demonym depending on
// the path it came in through (picker, eRegistration, passport MRZ).
export const isMaldivian = isMaldivianNationality;

export function isWorkPermitHolder(documents: { isWorkPermit: boolean }[] | null | undefined): boolean {
  return !!documents?.some((d) => d.isWorkPermit);
}

const toDate = (d: Date | string | null | undefined) => (d == null ? null : d instanceof Date ? d : new Date(d));

/** Under the exemption age on `on` (check-in). Unknown birth date → not an infant. */
export function isInfant(dateOfBirth: Date | string | null | undefined, on: Date, exemptAge: number): boolean {
  const dob = toDate(dateOfBirth);
  if (!dob || isNaN(dob.getTime())) return false;
  return ageOn(dob, on) < exemptAge;
}

/** The AUTOMATIC reason a guest is exempt (ignores the manual tick), or null. Checked in
 *  the MIRA sheet's order: infant, then Maldivian, then permit holder. */
export function autoExemptReason(guest: GreenTaxGuest, on: Date, exemptAge: number): GreenTaxExemptReason | null {
  if (isInfant(guest.dateOfBirth, on, exemptAge)) return "INFANT";
  if (isMaldivian(guest.nationality)) return "MALDIVIAN";
  if (isWorkPermitHolder(guest.documents)) return "WORK_PERMIT";
  return null;
}

/** Why this guest pays no Green Tax, or null when they pay it. */
export function greenTaxExemptReason(guest: GreenTaxGuest, on: Date, exemptAge: number): GreenTaxExemptReason | null {
  return autoExemptReason(guest, on, exemptAge) ?? (guest.greenTaxExempt ? "MANUAL" : null);
}

// A named exempt guest comes off the children count when they are a minor by birth date,
// otherwise off the adults count (either falls back to the other when its count is used
// up). The booking's child/adult split carries no ages, so this is the best reading.
const MINOR_AGE = 18;

export type GreenTaxPax = {
  /** Adults and children who pay Green Tax. Infants never do. */
  adults: number;
  children: number;
  /** The named guests who were taken off, and why — for the folio note and the UI. */
  exempt: { upid?: string; reason: GreenTaxExemptReason }[];
};

/**
 * The per-person Green Tax basis for one reservation: its head counts less the named
 * guests (primary + accompanying, each once) who are exempt.
 *
 * - An exempt INFANT belongs in the `infants` bucket, which is already untaxed. Only when
 *   more guests are named as infants than the booking counts as infants were the extra
 *   ones counted as children/adults — those come off (children first).
 * - Any other exempt guest (Maldivian, permit holder, ticked) comes off children when a
 *   minor, else adults.
 * Never below zero: the head counts cap it.
 */
export function greenTaxPax(
  res: { adults: number; children: number; infants?: number | null; checkInDate: Date },
  guests: GreenTaxGuest[],
  exemptAge: number
): GreenTaxPax {
  let adults = Math.max(0, res.adults);
  let children = Math.max(0, res.children);
  const exempt: GreenTaxPax["exempt"] = [];

  const takeOff = (childFirst: boolean) => {
    if (childFirst && children > 0) children -= 1;
    else if (adults > 0) adults -= 1;
    else if (children > 0) children -= 1;
  };

  // Each person once — a profile can be both the primary and listed as accompanying.
  const seen = new Set<string>();
  const unique = guests.filter((g) => {
    if (!g.upid) return true;
    if (seen.has(g.upid)) return false;
    seen.add(g.upid);
    return true;
  });

  let namedInfants = 0;
  for (const g of unique) {
    const reason = greenTaxExemptReason(g, res.checkInDate, exemptAge);
    if (!reason) continue;
    exempt.push({ upid: g.upid, reason });
    if (reason === "INFANT") {
      namedInfants += 1;
      continue;
    }
    const dob = toDate(g.dateOfBirth);
    const minor = !!dob && !isNaN(dob.getTime()) && ageOn(dob, res.checkInDate) < MINOR_AGE;
    takeOff(minor);
  }
  // Named infants the booking did not count as infants were counted as children/adults.
  for (let i = Math.max(0, res.infants ?? 0); i < namedInfants; i++) takeOff(true);

  return { adults, children, exempt };
}

/** The named guests on a reservation, primary first — the input greenTaxPax expects. */
export function reservationGuests<G extends GreenTaxGuest>(res: {
  primaryGuest: G | null;
  accompanyingGuests: { profile: G | null }[];
}): G[] {
  const out: G[] = [];
  if (res.primaryGuest) out.push(res.primaryGuest);
  for (const a of res.accompanyingGuests) if (a.profile) out.push(a.profile);
  return out;
}
