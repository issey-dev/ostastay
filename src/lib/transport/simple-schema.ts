import { z } from "zod"

// The reservation's simple Transport section (client-safe — shared by the form and the
// route): per leg only the flight number, the transport number (boat, car, ticket) and the
// flight time — landing for the pickup, take-off for the drop-off. The date is the stay's:
// arrival day for the pickup, departure day for the drop-off. No charges: transfers that
// are charged are booked in the Transportation module.

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is at most ${max} characters`)

export const simpleLegSchema = z.object({
  flightNo: optionalText(20, "Flight no."),
  transportNo: optionalText(40, "Transport no."),
  time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:30"),
})

export const simpleTransportSchema = z.object({
  pickup: simpleLegSchema,
  dropoff: simpleLegSchema,
})

export type SimpleLegInput = z.infer<typeof simpleLegSchema>
export type SimpleTransportInput = z.infer<typeof simpleTransportSchema>

export type SimpleDirection = "PICKUP" | "DROPOFF"

/** One leg as the reservation page shows it. Times are property-local. */
export type SimpleTransportLeg = {
  flightNo: string | null
  transportNo: string | null
  /** yyyy-MM-dd */
  flightDate: string | null
  /** HH:MM */
  flightTime: string | null
  /** A charge entered on the older card before it was simplified (read-only). */
  legacyCharge: { amount: number; posted: boolean } | null
}

export type SimpleTransport = {
  /** Transportation is on for this property: the section is read-only, filled from its bookings. */
  managedByModule: boolean
  legs: Record<SimpleDirection, SimpleTransportLeg | null>
}

export const isEmptySimpleLeg = (l: SimpleLegInput) => !l.flightNo && !l.transportNo && !l.time
