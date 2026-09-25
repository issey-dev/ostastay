import { z } from "zod"

// APP STANDARD 001 (.agents/docs/FORM_VALIDATION_STANDARD.md) schemas for the front-desk
// sales screens: Fast Post (POS), Excursions and Spa. Kept out of the pages (and free of
// server imports) so they can be unit-tested — see tests/business-rules/sales-forms.test.ts.
//
// No transforms (.trim(), coercion): handleSubmit hands the parsed values to the submit
// handler, and the request bodies must stay exactly what the screens sent before — the
// API routes do their own parsing (parseInt / parseFloat) and re-check every rule. These
// schemas only give the user the answer before they press the button.

const hasText = (v: string) => v.trim() !== ""

/** The "start a walk-in bill" mini form (POS, Excursions, Spa): name required, contact optional. */
export const walkInGuestSchema = z.object({
  name: z.string().refine(hasText, "Enter the guest's name."),
  contact: z.string(),
})
export type WalkInGuestValues = z.infer<typeof walkInGuestSchema>
export const emptyWalkInGuest: WalkInGuestValues = { name: "", contact: "" }

/** Fast Post › Post charge. Amount stays a string (native number input); the route parses it. */
export const posChargeSchema = z.object({
  chargeCodeId: z.string().min(1, "Select a charge code."),
  amount: z
    .string()
    .refine(hasText, "Enter an amount.")
    .refine((v) => {
      const n = parseFloat(v)
      return !hasText(v) || (Number.isFinite(n) && n > 0)
    }, "Enter a positive amount."),
  description: z.string(),
  reference: z.string(),
})
export type PosChargeValues = z.infer<typeof posChargeSchema>
export const emptyPosCharge: PosChargeValues = { chargeCodeId: "", amount: "", description: "", reference: "" }

/**
 * The in-house "Charge to room / Charge & pay now" choice (InHousePaymentChoice). Paying now
 * needs a payment method — but only when the choice applies (an in-house booking); a walk-in
 * booking ignores it, so the rule is off there and a leftover choice can't block the form.
 */
const inHousePaymentSchema = (applies: boolean) =>
  z
    .object({ settleNow: z.boolean(), paymentMethodId: z.string() })
    .refine((p) => !applies || !p.settleNow || p.paymentMethodId !== "", "Choose a payment method.")

/** Blank, or a whole number ≥ 0 — blank counts as 0, as the bookings route has always read it. */
const countString = z.string().refine((v) => v === "" || /^\d+$/.test(v), "Enter a whole number.")
const count = (v: string) => parseInt(v) || 0

/** Excursions › Book. `inHouse` = booking for an in-house guest (the payment choice applies). */
export const excursionBookingSchemaFor = (inHouse: boolean) =>
  z
    .object({
      excursionTypeId: z.string().min(1, "Choose an excursion."),
      date: z.string().min(1, "Choose a date."),
      // Only an explicit pick when a day runs more than one departure; a single-departure
      // day is chosen automatically, so this may stay "" (the page checks the effective one).
      departureId: z.string(),
      adultCount: countString,
      childCount: countString,
      infantCount: countString,
      notes: z.string(),
      payment: inHousePaymentSchema(inHouse),
    })
    .refine((v) => count(v.adultCount) + count(v.childCount) + count(v.infantCount) > 0, {
      message: "Add at least one guest.",
      path: ["adultCount"],
    })
export type ExcursionBookingValues = z.infer<ReturnType<typeof excursionBookingSchemaFor>>
export const emptyExcursionBooking: ExcursionBookingValues = {
  excursionTypeId: "",
  date: "",
  departureId: "",
  adultCount: "1",
  childCount: "0",
  infantCount: "0",
  notes: "",
  payment: { settleNow: false, paymentMethodId: "" },
}

/**
 * Who is in one Spa booking slot. Participant 1 (the billing anchor) is an in-house
 * reservation or the already-open walk-in folio; any other participant is another
 * reservation or a plain companion name (the page's header comment explains why a companion
 * sharing participant 1's room is a name, not a second reservation entry).
 */
export const spaParticipantValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reservation"),
    reservationId: z.string(),
    guestName: z.string(),
    roomNumber: z.string(),
    profileId: z.string(),
    accompanyingGuests: z.array(z.object({ upid: z.string(), guestName: z.string() })),
  }),
  z.object({ kind: z.literal("walkin_primary"), folioId: z.string(), guestName: z.string() }),
  z.object({ kind: z.literal("walkin_companion"), guestName: z.string() }),
])
export type SpaParticipantValue = z.infer<typeof spaParticipantValueSchema>

export const spaGenderChoices = ["ANY", "FEMALE", "MALE"] as const
export type SpaGenderChoice = (typeof spaGenderChoices)[number]

/**
 * One booking slot: the guest (null until one is picked) plus that guest's own therapist
 * ask. specificTherapistId ("" = none) and genderChoice are kept mutually exclusive by the
 * page (picking one clears the other), so the schema doesn't re-check it.
 */
export const spaParticipantSlotSchema = z.object({
  // Explicit `: boolean` so the refine is not a type predicate: zod would then narrow the
  // OUTPUT type to non-null, and the form (input) and parsed (output) types must stay the same.
  value: spaParticipantValueSchema.nullable().refine((v): boolean => v !== null, "Choose a guest."),
  genderChoice: z.enum(spaGenderChoices),
  specificTherapistId: z.string(),
})
export type SpaParticipantSlot = z.infer<typeof spaParticipantSlotSchema>
export const emptySpaParticipantSlot = (): SpaParticipantSlot => ({ value: null, genderChoice: "ANY", specificTherapistId: "" })

/**
 * Spa › Book. `participants` is a field array whose length follows `partySize` (the page
 * grows/shrinks it with the party size); every slot needs a guest before the booking can go.
 */
export const spaBookingSchemaFor = (inHouse: boolean) =>
  z
    .object({
      treatmentId: z.string().min(1, "Choose a treatment."),
      partySize: z.number().int().min(1),
      appointmentDate: z.string().min(1, "Choose a date."),
      startTime: z.string().min(1, "Pick a time."),
      participants: z.array(spaParticipantSlotSchema),
      notes: z.string(),
      payment: inHousePaymentSchema(inHouse),
    })
    .refine((v) => v.participants.length === v.partySize, {
      message: "Choose a guest for every place in the party.",
      path: ["participants"],
    })
export type SpaBookingValues = z.infer<ReturnType<typeof spaBookingSchemaFor>>
export const emptySpaBooking: SpaBookingValues = {
  treatmentId: "",
  partySize: 1,
  appointmentDate: "",
  startTime: "",
  participants: [emptySpaParticipantSlot()],
  notes: "",
  payment: { settleNow: false, paymentMethodId: "" },
}
