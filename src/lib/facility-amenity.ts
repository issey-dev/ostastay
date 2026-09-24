import { z } from "zod"

// One amenity (Pool, Gym, Spa…) on a property's guest-facing profile — the Facility
// model. Shared by the Hub form (FacilityAmenitiesManager) and /api/facilities so both
// validate the same way.
export const amenitySchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "Keep the name to 80 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(300, "Keep the description to 300 characters or fewer")
    .optional(),
})

export type AmenityInput = z.input<typeof amenitySchema>

// An empty description is stored as null, so "cleared" and "never set" read the same.
export const amenityDescription = (v: string | undefined) => (v ? v : null)

// Names are compared case- and whitespace-insensitively, so "Pool" and " pool " clash.
export const amenityNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()
