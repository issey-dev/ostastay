import { prisma } from "@/lib/db"

// "Is this revenue code already used by a booking?" — the guard behind renaming and
// deleting Rate Plans, Meal Plans and Allocations once reservations point at them.
//
// Meal plans are the sharp case: Reservation.mealPlan stores the plan's CODE as plain
// text, so renaming or deleting a used meal plan silently orphans every booking on it.
// Rate plans (RoomAssignment.ratePlanId) and allocations (ReservationAllocation) are FK
// links, but their code is what staff, reports and folios know them by, so it is frozen
// the same way once used. Deactivating is always the way out — it hides the code from
// new bookings and keeps history intact.

/** Reservations at this property booked on this meal plan code. */
export function countMealPlanUsage(propertyId: string, code: string): Promise<number> {
  return prisma.reservation.count({ where: { propertyId, mealPlan: code } })
}

/** Reservations with at least one room assignment priced on this rate plan. */
export function countRatePlanUsage(ratePlanId: string): Promise<number> {
  return prisma.reservation.count({ where: { assignments: { some: { ratePlanId } } } })
}

/** Reservations this allocation is attached to. */
export function countAllocationUsage(allocationId: string): Promise<number> {
  return prisma.reservationAllocation.count({ where: { allocationId } })
}

const noun = (n: number) => `${n} reservation${n === 1 ? "" : "s"}`

export const usageMessages = {
  mealPlanCode: (code: string, n: number) =>
    `Meal plan ${code} is used by ${noun(n)}, which store its code — the code can't be changed. Deactivate it and add a new meal plan instead.`,
  mealPlanDelete: (code: string, n: number) =>
    `Meal plan ${code} is used by ${noun(n)} and can't be deleted — deactivate it instead.`,
  ratePlanCode: (code: string, n: number) =>
    `Rate plan ${code} is used by ${noun(n)} — its code can't be changed. Create a new rate plan instead.`,
  ratePlanDelete: (code: string, n: number) =>
    `Rate plan ${code} is used by ${noun(n)} and can't be deleted — their room charges are priced on it.`,
  allocationCode: (code: string, n: number) =>
    `Allocation ${code} is attached to ${noun(n)} — its code can't be changed. Deactivate it and add a new allocation instead.`,
  allocationDelete: (code: string, n: number) =>
    `Allocation ${code} is attached to ${noun(n)} and can't be deleted — deactivate it instead.`,
}

/** Prisma unique-constraint violation (P2002) — a duplicate code, raced past the pre-check. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002"
}
