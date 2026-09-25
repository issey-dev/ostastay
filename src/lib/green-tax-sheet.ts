import { isMaldivianNationality } from "@/lib/countries";

// MIRA Green Tax information sheet (template "GRTInfoSheet25.1") — the rules that turn a
// GuestRegistration into one row of the government submission. Pure functions, shared by
// the Green Tax Report and its Excel export (src/lib/reports/render/green-tax-xlsx.ts).

// The only Booking Method entries MIRA accepts (mandatory column). Picked per
// COMPANY/TRAVEL_AGENT profile (Profile.bookingMethod); a booking without an agent is FIT.
export const BOOKING_METHODS = [
  "Foreign tour operator",
  "Local tour operator",
  "Direct booking",
  "FIT",
  "Online travel agent",
] as const;
export type BookingMethod = (typeof BOOKING_METHODS)[number];
export const DEFAULT_BOOKING_METHOD: BookingMethod = "FIT";

export function isBookingMethod(v: unknown): v is BookingMethod {
  return typeof v === "string" && (BOOKING_METHODS as readonly string[]).includes(v);
}

// Guest category codes on the sheet.
export const GREEN_TAX_CATEGORY = {
  NORMAL: 1,
  MALDIVIAN: 2,
  PERMIT_HOLDER: 3,
  INFANT: 4,
} as const;

// Whole years between dateOfBirth and `on` (UTC calendar dates).
export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = on.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dateOfBirth.getUTCDate())) age--;
  return age;
}

// Category for one guest: infant (under the exempt age at check-in) → 4, Maldivian
// nationality → 2, work-permit holder → 3, everyone else → 1. Checked in that order, so
// a Maldivian infant is reported as an infant.
export function greenTaxCategory(guest: {
  dateOfBirth: Date | null;
  nationality: string | null;
  isWorkPermitHolder: boolean;
  checkInDate: Date;
  infantAge: number;
}): number {
  if (guest.dateOfBirth && ageOn(guest.dateOfBirth, guest.checkInDate) < guest.infantAge) return GREEN_TAX_CATEGORY.INFANT;
  if (isMaldivianNationality(guest.nationality)) return GREEN_TAX_CATEGORY.MALDIVIAN;
  if (guest.isWorkPermitHolder) return GREEN_TAX_CATEGORY.PERMIT_HOLDER;
  return GREEN_TAX_CATEGORY.NORMAL;
}

// The reservation's Booking Method: its travel agent's, or FIT with no agent. An agent
// whose profile has no method set yields null — the report flags it rather than guess.
export function bookingMethodFor(travelAgent: { bookingMethod: string | null } | null): string | null {
  if (!travelAgent) return DEFAULT_BOOKING_METHOD;
  return isBookingMethod(travelAgent.bookingMethod) ? travelAgent.bookingMethod : null;
}

// "LASTNAME FIRSTNAME MIDDLENAME", upper-case — the sheet's name convention.
export function sheetGuestName(p: { firstName: string; middleName: string | null; lastName: string | null }): string {
  return [p.lastName, p.firstName, p.middleName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

// "HH:mm" wall-clock time of an instant in the property's time zone.
export function localTime(instant: Date, timeZone: string): string {
  return instant.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}

// ─── The 12-hour rule ──────────────────────────────────────────────────────────
// A guest gets a Registration No only for a stay of at least 12 hours (exactly 12
// counts). How the length is measured is the enterprise's choice
// (EnterpriseSettings.greenTaxStayBasis):
//   ACTUAL   — from the actual check-in time to the actual check-out (or, while still
//              in house, the booked departure date at the property's check-out time).
//   STANDARD — the property's standard check-in time on the arrival date to its
//              standard check-out time on the departure date (an early check-out moves
//              checkOutDate, so this still follows the real departure day).
export const MIN_STAY_HOURS = 12;
export const STAY_BASES = ["ACTUAL", "STANDARD"] as const;
export type StayBasis = (typeof STAY_BASES)[number];

export function isStayBasis(v: unknown): v is StayBasis {
  return typeof v === "string" && (STAY_BASES as readonly string[]).includes(v);
}

// The instant a wall-clock "HH:mm" on a calendar day (a UTC midnight) happens in the
// property's time zone.
export function zonedInstant(day: Date, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const asUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h || 0, m || 0);
  // The zone's offset at that moment: read the same instant back as wall-clock parts.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(asUtc - (wall - asUtc));
}

export type StayForRule = {
  status: string;
  checkInDate: Date;
  checkOutDate: Date;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
};
export type PropertyTimes = { timeZone: string; checkInTime: string; checkOutTime: string };

export function stayHours(res: StayForRule, property: PropertyTimes, basis: StayBasis): number {
  const stdIn = zonedInstant(res.checkInDate, property.checkInTime, property.timeZone);
  const stdOut = zonedInstant(res.checkOutDate, property.checkOutTime, property.timeZone);
  if (basis === "STANDARD") return (stdOut.getTime() - stdIn.getTime()) / 3_600_000;
  const start = res.checkedInAt ?? stdIn;
  const end = res.status === "CHECKED_OUT" && res.checkedOutAt ? res.checkedOutAt : stdOut;
  return (end.getTime() - start.getTime()) / 3_600_000;
}

export function meetsMinStay(res: StayForRule, property: PropertyTimes, basis: StayBasis): boolean {
  return stayHours(res, property, basis) >= MIN_STAY_HOURS;
}
