import { z } from "zod";

// Request shapes for the public Website API. Shared by the quote and booking routes so a
// stay validates identically whether it is being priced or booked.

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const websiteStaySchema = z.object({
  checkIn: isoDay,
  checkOut: isoDay,
  roomTypeId: z.string().min(1),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
  /** Omitted = the property's configured default. Refused if it does not offer a choice. */
  mealPlanCode: z.string().trim().max(40).optional().nullable(),
  /** Optional paid extras by allocation id. Refused if the property does not offer them. */
  addOnIds: z.array(z.string().min(1)).max(20).optional(),
});

export const websiteGuestSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().email("A valid email is required").max(254),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const websiteBookingSchema = websiteStaySchema.extend({
  guest: websiteGuestSchema,
  remarks: z.string().trim().max(1000).optional().nullable(),
  /** Alternative to the Idempotency-Key header for clients that cannot set headers. */
  idempotencyKey: z.string().trim().min(8).max(128).optional().nullable(),
});

export type WebsiteBookingRequest = z.infer<typeof websiteBookingSchema>;

/** Flatten a ZodError into { field: message } for the `details` of a VALIDATION error. */
export function zodDetails(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}
