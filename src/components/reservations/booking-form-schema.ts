import { z } from "zod"

// APP STANDARD 001 — the booking form's single source of validation truth.
// Everything the old hand-rolled handleSubmit checked imperatively lives here
// (required guest, complete segments, departure-after-arrival, back-to-back
// segments, accompanying-guest cap) so React Hook Form can surface each rule
// inline, in real time. The one rule that stays in the submit handler is the
// max-occupancy acknowledgement — it needs the room-type lookup data the schema
// doesn't have.

export const segmentSchema = z
  .object({
    roomTypeId: z.string().min(1, "Pick a room & rate from the grid"),
    // "none" is the explicit Unassigned sentinel (mirrors the Select options).
    roomId: z.string(),
    ratePlanId: z.string().min(1, "Pick a room & rate from the grid"),
    // Kept as the raw input string; numeric-ness checked here, parsed at submit.
    overrideRate: z.string(),
    startDate: z.string().min(1, "Required"),
    endDate: z.string().min(1, "Required"),
  })
  .superRefine((a, ctx) => {
    if (a.startDate && a.endDate && a.endDate <= a.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Departure must be after arrival" })
    }
    if (a.overrideRate.trim() !== "") {
      const n = parseFloat(a.overrideRate)
      if (!Number.isFinite(n) || n < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrideRate"], message: "Must be a positive amount" })
      }
    }
  })

export const bookingFormSchema = z
  .object({
    primaryGuestId: z.string().min(1, "Select a primary guest"),
    checkInDate: z.string().min(1, "Pick an arrival date"),
    checkOutDate: z.string().min(1, "Pick a departure date"),
    adults: z.number().int().min(1, "At least 1 adult"),
    children: z.number().int().min(0),
    infants: z.number().int().min(0),
    remarks: z.string(),
    mealPlan: z.string(),
    travelAgentId: z.string(),
    // Per-reservation fee-rule selections ("none" = no rule of that type). Converted to
    // null in the submit payload; the API validates them against the property.
    depositFeeRuleId: z.string(),
    cancellationFeeRuleId: z.string(),
    noShowFeeRuleId: z.string(),
    accompanyingGuestIds: z.array(z.string()),
    manualAllocationIds: z.array(z.string()),
    specialRequestCodes: z.array(z.string()),
    acknowledgeOverCapacity: z.boolean(),
    assignments: z.array(segmentSchema).min(1, "At least one room segment is required"),
  })
  .superRefine((v, ctx) => {
    // Split-stay segments must run back-to-back with no gaps.
    v.assignments.forEach((a, i) => {
      if (i > 0 && a.startDate && v.assignments[i - 1].endDate && a.startDate !== v.assignments[i - 1].endDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assignments", i, "startDate"],
          message: "Segments must run back-to-back with no gaps",
        })
      }
    })
    // Accompanying guests can't exceed the pax not taken by the primary guest.
    const maxAccompanying = Math.max(0, v.adults + v.children - 1)
    if (v.accompanyingGuestIds.length > maxAccompanying) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accompanyingGuestIds"],
        message: `Only ${maxAccompanying} accompanying guest(s) can be attached for ${v.adults} adult(s) and ${v.children} child(ren)`,
      })
    }
  })

export type BookingFormValues = z.infer<typeof bookingFormSchema>
export type SegmentValues = z.infer<typeof segmentSchema>

export const emptySegment = (): SegmentValues => ({
  roomTypeId: "",
  roomId: "none",
  ratePlanId: "",
  overrideRate: "",
  startDate: "",
  endDate: "",
})

export const emptyBookingValues = (): BookingFormValues => ({
  primaryGuestId: "",
  checkInDate: "",
  checkOutDate: "",
  adults: 1,
  children: 0,
  infants: 0,
  remarks: "",
  mealPlan: "NONE",
  travelAgentId: "none",
  depositFeeRuleId: "none",
  cancellationFeeRuleId: "none",
  noShowFeeRuleId: "none",
  accompanyingGuestIds: [],
  manualAllocationIds: [],
  specialRequestCodes: [],
  acknowledgeOverCapacity: false,
  assignments: [{ ...emptySegment(), roomId: "" }],
})
