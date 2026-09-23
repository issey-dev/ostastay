import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BookingError } from "@/lib/booking-error";
import { keyCanAccessProperty, type ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import { activityModuleStatus, requireScope, type ActivityModule } from "@/lib/website-api/scopes";

// Shared plumbing for the Booking API's Excursion and Spa endpoints
// (BOOKING_API_ADDONS_PLAN.md Phases 2–3): the access gate, request schemas, public
// references and the mapping from service refusals to the public error contract.

/** Everything the gate knows once a request may proceed. */
export type ActivityGate = {
  settings: Awaited<ReturnType<typeof prisma.activityOnlineSettings.findUnique>>;
  /** True when bookings may be made right now (module status enabled). */
  bookable: boolean;
  status: Awaited<ReturnType<typeof activityModuleStatus>>;
};

/**
 * Who may do what, in order:
 *  - a property not on the key → 404 PROPERTY_NOT_FOUND (never 403, see resolve-key.ts);
 *  - no scope → 403 SCOPE_NOT_GRANTED;
 *  - the enterprise no longer has the add-on → 409 MODULE_NOT_ENABLED, reads included;
 *  - writes only: a browser-origin key → 403 SERVER_KEY_REQUIRED (B-10 — an activity
 *    booking carries the website's word that the guest paid, which a key sitting in page
 *    source must not be able to assert), and the module must be bookable right now.
 * Reads are allowed while a property is still setting up (the catalogue may be empty),
 * so a website can be built before the property goes live.
 */
export async function activityGate(
  key: ResolvedWebsiteKey,
  propertyId: string,
  module: ActivityModule,
  mode: "read" | "write"
): Promise<ActivityGate> {
  if (!keyCanAccessProperty(key, propertyId)) throw new BookingError(404, "PROPERTY_NOT_FOUND", "Property not found.");
  requireScope(key, module);
  const status = await activityModuleStatus(key, propertyId, module);
  if (status.code === "ADDON_NOT_ENABLED") {
    throw new BookingError(409, "MODULE_NOT_ENABLED", status.reason ?? "Not available.", { details: { reason: status.code } });
  }
  if (mode === "write") {
    if (key.allowedOrigins.length > 0) {
      throw new BookingError(
        403,
        "SERVER_KEY_REQUIRED",
        "This key is set up for browser use. Excursion and spa bookings must be made from your website's server with a server-only key."
      );
    }
    if (!status.enabled) {
      throw new BookingError(409, "MODULE_NOT_ENABLED", status.reason ?? "Not available.", { details: { reason: status.code } });
    }
  }
  const settings = await prisma.activityOnlineSettings.findUnique({ where: { propertyId_module: { propertyId, module } } });
  return { settings, bookable: status.enabled, status };
}

// Crockford base32 without I, L, O, U — readable over the phone, no look-alikes.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A random guest-facing reference, e.g. EXC-7K3QX9MD. Never sequential (B-11). */
export function newPublicRef(module: ActivityModule): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return `${module === "SPA" ? "SPA" : "EXC"}-${out}`;
}

export const partySchema = z.object({
  adults: z.number().int().min(0).max(100),
  children: z.number().int().min(0).max(100).default(0),
  infants: z.number().int().min(0).max(100).default(0),
});

export const guestSchema = z.object({
  firstName: z.string().trim().min(1, "The guest's first name is required").max(100),
  lastName: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email("A valid email is required").max(200),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const paymentSchema = z.object({
  status: z.enum(["PAID", "UNPAID"]),
  provider: z.string().trim().max(60).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  amount: z.number().min(0).optional().nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
});

export const idempotencyKeySchema = z.string().trim().min(8).max(128);

/** HTTP status for a service refusal on the public API. Business refusals are 409s. */
const PUBLIC_STATUS: Record<string, number> = {
  SOLD_OUT: 409,
  SLOT_UNAVAILABLE: 409,
  DEPARTURE_CLOSED: 409,
  NO_RATE: 409,
  NO_OUTLET: 409,
  ALREADY_CANCELLED: 409,
  CANCEL_CUTOFF_PASSED: 409,
  DEPARTURE_NOT_FOUND: 404,
  TREATMENT_NOT_FOUND: 404,
};

export function publicStatus(e: BookingError): number {
  return PUBLIC_STATUS[e.code] ?? e.status;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
