import * as z from "zod"

// Zod schemas for the Rate Plan dialog (Revenue › Rate Plans) and the Meal Plan dialog
// (Hub › Revenue) — APP STANDARD 001 (.agents/docs/FORM_VALIDATION_STANDARD.md). Kept out
// of the components so they can be unit-tested; the API stays the authority.

const codeField = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? "Code is required" : `Code must be at least ${min} characters`)
    .max(max, `Code must be at most ${max} characters`)

// ─── Rate Plan ──────────────────────────────────────────────────────────────────────

export const ratePlanFormSchema = z
  .object({
    /** The property's system Base Rate — its identity fields are read-only. */
    isLocked: z.boolean(),
    code: codeField(2, 30),
    name: z.string().trim().min(2, "Name must be at least 2 characters"),
    description: z.string(),
    // A string so an empty box is distinguishable from 0 — and 0 is a real priority.
    priority: z.string().trim().regex(/^\d+$/, "Priority must be a whole number (0 or more)"),
    isNegotiated: z.boolean(),
    isComplimentary: z.boolean(),
    isHouseUse: z.boolean(),
    chargeCodeId: z.string(),
    parentRatePlanId: z.string(),
    derivedAdjustmentType: z.enum(["PERCENT", "FLAT"]),
    derivedAdjustmentValue: z.string(),
    allocationIds: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (!v.isLocked && v.code.trim().toUpperCase() === "BASE") {
      ctx.addIssue({ code: "custom", path: ["code"], message: '"BASE" is reserved for the property\'s own Base Rate plan' })
    }
    if (v.parentRatePlanId) {
      const raw = v.derivedAdjustmentValue.trim()
      if (raw === "" || !Number.isFinite(Number(raw))) {
        ctx.addIssue({ code: "custom", path: ["derivedAdjustmentValue"], message: "Enter the adjustment (negative for a discount)" })
      } else if (v.derivedAdjustmentType === "PERCENT" && Number(raw) <= -100) {
        ctx.addIssue({ code: "custom", path: ["derivedAdjustmentValue"], message: "A percent discount must be above -100%" })
      }
    }
  })

export type RatePlanFormValues = z.infer<typeof ratePlanFormSchema>

export const emptyRatePlanForm: RatePlanFormValues = {
  isLocked: false,
  code: "",
  name: "",
  description: "",
  priority: "10",
  isNegotiated: false,
  isComplimentary: false,
  isHouseUse: false,
  chargeCodeId: "",
  parentRatePlanId: "",
  derivedAdjustmentType: "PERCENT",
  derivedAdjustmentValue: "",
  allocationIds: [],
}

/** Form values → the JSON body POST/PUT /api/rate-plans expects. */
export function ratePlanPayload(v: RatePlanFormValues, propertyId: string) {
  const derived = !!v.parentRatePlanId
  return {
    propertyId,
    code: v.code.trim().toUpperCase(),
    name: v.name.trim(),
    description: v.description,
    priority: parseInt(v.priority, 10),
    isNegotiated: v.isNegotiated,
    isComplimentary: v.isComplimentary,
    isHouseUse: v.isHouseUse,
    chargeCodeId: v.chargeCodeId || null,
    parentRatePlanId: derived ? v.parentRatePlanId : null,
    derivedAdjustmentType: derived ? v.derivedAdjustmentType : null,
    derivedAdjustmentValue: derived ? parseFloat(v.derivedAdjustmentValue) : null,
    allocationIds: v.allocationIds,
  }
}

// ─── Meal Plan ──────────────────────────────────────────────────────────────────────

export const mealPlanFormSchema = z.object({
  code: codeField(1, 20),
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  isActive: z.boolean(),
  allocationIds: z.array(z.string()),
})

export type MealPlanFormValues = z.infer<typeof mealPlanFormSchema>

export const emptyMealPlanForm: MealPlanFormValues = { code: "", name: "", isActive: true, allocationIds: [] }

/** A server error body as a readable sentence — never the raw JSON. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  const error = body?.error
  if (typeof error === "string" && error) return error
  if (Array.isArray(error) && error[0]?.message) return String(error[0].message)
  return fallback
}
