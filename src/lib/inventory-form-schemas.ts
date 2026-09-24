import { z } from "zod"

// APP STANDARD 001 (.agents/docs/FORM_VALIDATION_STANDARD.md) schemas for the Hub ›
// property › Rooms & Inventory dialogs: Room Type, Building, Floor and Room. Kept out of
// the components (and free of server imports) so they can be unit-tested — see
// tests/business-rules/inventory-forms.test.ts. The API routes re-check every rule; these
// only give the user the answer before they press Save.

const featureSchema = z.object({
  category: z.string().min(1), // BED_TYPE | ROOM_VIEW | ROOM_AMENITY — the API checks the enum
  code: z.string().min(1),
})

/** A whole number ≥ 1, entered in a text/number input. */
const positiveIntString = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => /^\d+$/.test(v) && parseInt(v, 10) >= 1, `${label} must be a whole number of at least 1`)

export const roomTypeFormSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    code: z.string().trim().min(2, "Code must be at least 2 characters"),
    maxOccupancy: positiveIntString("Max occupancy"),
    baseOccupancy: positiveIntString("Base occupancy"),
    description: z.string(),
    isInactive: z.boolean(),
    isPseudo: z.boolean(),
    housekeepingEnabled: z.boolean(),
    features: z.array(featureSchema),
  })
  .superRefine((v, ctx) => {
    const max = parseInt(v.maxOccupancy, 10)
    const base = parseInt(v.baseOccupancy, 10)
    if (Number.isFinite(max) && Number.isFinite(base) && base > max) {
      ctx.addIssue({
        code: "custom",
        path: ["baseOccupancy"],
        message: `Base occupancy cannot be more than max occupancy (${max})`,
      })
    }
  })

export type RoomTypeFormValues = z.infer<typeof roomTypeFormSchema>

export const emptyRoomTypeForm: RoomTypeFormValues = {
  name: "",
  code: "",
  maxOccupancy: "2",
  baseOccupancy: "2",
  description: "",
  isInactive: false,
  isPseudo: false,
  housekeepingEnabled: true,
  features: [],
}

export function roomTypePayload(v: RoomTypeFormValues, propertyId: string) {
  return {
    propertyId,
    name: v.name.trim(),
    code: v.code.trim(),
    maxOccupancy: parseInt(v.maxOccupancy, 10),
    baseOccupancy: parseInt(v.baseOccupancy, 10),
    description: v.description.trim() || undefined,
    isActive: !v.isInactive,
    isPseudo: v.isPseudo,
    housekeepingEnabled: v.housekeepingEnabled,
    features: v.features,
  }
}

export const buildingFormSchema = z.object({
  name: z.string().trim().min(2, "Building name must be at least 2 characters"),
})
export type BuildingFormValues = z.infer<typeof buildingFormSchema>

export const floorFormSchema = z.object({
  buildingId: z.string().min(1, "Select the building this floor is in"),
  name: z.string().trim().min(1, "Floor name is required"),
})
export type FloorFormValues = z.infer<typeof floorFormSchema>

// `isPseudo` mirrors the selected room type (set by the form when the type changes): a
// pseudo room has no Building/Floor, a physical one must have both.
export const roomFormSchema = z
  .object({
    roomNumber: z.string().trim().min(1, "Room number is required"),
    roomTypeId: z.string().min(1, "Select a room type"),
    isPseudo: z.boolean(),
    buildingId: z.string(),
    floorId: z.string(),
    features: z.array(featureSchema),
  })
  .superRefine((v, ctx) => {
    if (v.isPseudo) return
    if (!v.buildingId) ctx.addIssue({ code: "custom", path: ["buildingId"], message: "Select a building" })
    if (!v.floorId) ctx.addIssue({ code: "custom", path: ["floorId"], message: "Select a floor" })
  })
export type RoomFormValues = z.infer<typeof roomFormSchema>

export const emptyRoomForm: RoomFormValues = {
  roomNumber: "",
  roomTypeId: "",
  isPseudo: false,
  buildingId: "",
  floorId: "",
  features: [],
}

/** A server error body as a readable sentence — never the raw JSON or a zod issue array. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  const error = body?.error
  if (typeof error === "string" && error) return error
  if (Array.isArray(error) && error[0]?.message) return String(error[0].message)
  return fallback
}
