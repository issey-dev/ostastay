import { z } from "zod"

// A therapist availability exception (Hub › Spa › Therapists › Exceptions). Shared by
// the dialog and POST /api/spa/therapists/[id]/exceptions.
//
// How the engine (src/lib/spa-availability.ts getAvailableTherapists) reads one:
// - any type but EXTENDED_HOURS BLOCKS the therapist — the whole day when no times are
//   given, otherwise only the start–end window;
// - EXTENDED_HOURS makes the therapist available between start and end on that date even
//   outside their weekly schedule, so both times are required (without them it would do
//   nothing). Slots are still only offered inside the spa's opening hours.
export const THERAPIST_EXCEPTION_TYPES = ["DAY_OFF", "LEAVE", "TRAINING", "SICK", "EXTENDED_HOURS", "UNAVAILABLE"] as const
export type TherapistExceptionType = (typeof THERAPIST_EXCEPTION_TYPES)[number]

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const optionalTime = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || HHMM.test(v), "Enter a time (HH:MM)")

export const therapistExceptionSchema = z
  .object({
    date: z.string().min(1, "Choose a date"),
    exceptionType: z.enum(THERAPIST_EXCEPTION_TYPES, { message: "Choose a type" }),
    startTime: optionalTime,
    endTime: optionalTime,
    reason: z
      .string()
      .max(200, "Keep the reason to 200 characters or fewer")
      .optional()
      .nullable()
      .transform((v) => (v?.trim() ? v.trim() : null)),
  })
  .superRefine((v, ctx) => {
    if (v.exceptionType === "EXTENDED_HOURS") {
      if (!v.startTime) ctx.addIssue({ code: "custom", path: ["startTime"], message: "Extended hours need a start time" })
      if (!v.endTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Extended hours need an end time" })
    } else if (!!v.startTime !== !!v.endTime) {
      // A partial-day block needs both ends; neither means the whole day.
      ctx.addIssue({
        code: "custom",
        path: [v.startTime ? "endTime" : "startTime"],
        message: "Give both times, or leave both empty for the whole day",
      })
    }
    if (v.startTime && v.endTime && v.startTime >= v.endTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after start time" })
    }
  })

export type TherapistExceptionInput = z.input<typeof therapistExceptionSchema>
