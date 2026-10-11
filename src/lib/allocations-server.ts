import { prisma } from "@/lib/db"
import { resolveLinkedAllocationIds, ratePlanAllocationWindows, serializeWindows } from "@/lib/allocations"

// Materializes a reservation's ReservationAllocation rows — the single write path used
// by both the reservation POST and PUT routes. RATE_PLAN/MEAL_PLAN-sourced rows are
// re-derived from the current links each time (so date/plan edits stay correct), while
// MANUAL rows (and their negotiated price overrides) are preserved unless
// `manualAllocationIds` explicitly changes the manual set. Night Audit reads only the
// rows this writes — later edits to a rate plan's links never reprice an existing stay.
export async function materializeReservationAllocations(params: {
  reservationId: string
  propertyId: string
  // Every room segment's rate plan and dates. A split stay can price each segment on a
  // different plan, and each plan's linked allocations cover only that segment's nights.
  segments: Array<{ ratePlanId: string; startDate: Date; endDate: Date }>
  mealPlanCode: string | null
  // undefined = leave existing MANUAL rows untouched; an array = full replacement of
  // the manual set (rows keep their overrides when the allocation stays selected).
  manualAllocationIds?: string[]
}): Promise<{ error?: string }> {
  const { reservationId, propertyId, segments, mealPlanCode } = params
  const ratePlanIds = [...new Set(segments.map((s) => s.ratePlanId))]

  // Resolve the linked attachment set — exclusively RATE_PLAN or MEAL_PLAN per the
  // property's Allocation Calculation setting (Controls > Revenue). Only active
  // allocations attach — a deactivated allocation stops appearing on new/edited
  // reservations without touching historical ones.
  const [property, ratePlans, mealPlan] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { allocationCalculationMode: true } }),
    ratePlanIds.length
      ? prisma.ratePlan.findMany({
          where: { id: { in: ratePlanIds } },
          include: {
            allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } },
            parentRatePlan: {
              include: { allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } } },
            },
          },
        })
      : [],
    mealPlanCode && mealPlanCode !== "NONE"
      ? prisma.mealPlan.findUnique({
          where: { propertyId_code: { propertyId, code: mealPlanCode } },
          include: {
            allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } },
          },
        })
      : null,
  ])

  const activeLinks = (links: Array<{ allocationId: string; allocation: { isActive: boolean } }> | undefined) =>
    (links ?? []).filter((l) => l.allocation.isActive).map((l) => ({ allocationId: l.allocationId }))

  const mode = property?.allocationCalculationMode === "MEAL_PLAN" ? "MEAL_PLAN" : "RATE_PLAN"
  const planById = new Map(ratePlans.map((rp) => [rp.id, rp]))

  // What each segment's rate plan links (own links, else its parent's), per segment.
  const segmentLinks = segments.map((seg) => {
    const rp = planById.get(seg.ratePlanId)
    const linkedForSegment = resolveLinkedAllocationIds({
      mode: "RATE_PLAN",
      ratePlanLinks: activeLinks(rp?.allocationLinks),
      parentRatePlanLinks: activeLinks(rp?.parentRatePlan?.allocationLinks),
      mealPlanLinks: [],
    }).map((l) => l.allocationId)
    return { startDate: seg.startDate, endDate: seg.endDate, linkedAllocationIds: linkedForSegment }
  })
  // Rate-plan mode: the union across segments, each carrying the nights it covers.
  // Meal-plan mode: the meal plan's links, always the whole stay.
  const windowsById = mode === "RATE_PLAN" ? ratePlanAllocationWindows(segmentLinks) : new Map<string, null>()
  const linked =
    mode === "RATE_PLAN"
      ? [...windowsById.keys()].map((allocationId) => ({ allocationId, source: "RATE_PLAN" as const }))
      : resolveLinkedAllocationIds({ mode, ratePlanLinks: [], parentRatePlanLinks: [], mealPlanLinks: activeLinks(mealPlan?.allocationLinks) })
  const linkedIds = new Set(linked.map((l) => l.allocationId))

  // Manual set: validate any newly-requested ids belong to this property and are active.
  let manualIds: string[] | undefined
  if (params.manualAllocationIds !== undefined) {
    manualIds = [...new Set(params.manualAllocationIds)].filter((id) => !linkedIds.has(id))
    if (manualIds.length > 0) {
      const valid = await prisma.allocation.findMany({
        where: { id: { in: manualIds }, propertyId, isActive: true },
        select: { id: true },
      })
      if (valid.length !== manualIds.length) {
        return { error: "One or more add-on allocations were not found for this property" }
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Re-derive the linked rows wholesale.
    await tx.reservationAllocation.deleteMany({
      where: { reservationId, source: { in: ["RATE_PLAN", "MEAL_PLAN"] } },
    })

    const existingManual = await tx.reservationAllocation.findMany({
      where: { reservationId, source: "MANUAL" },
    })

    if (manualIds !== undefined) {
      // Full replacement of the manual set; rows that survive keep their overrides.
      const keep = new Set(manualIds)
      const toDelete = existingManual.filter((m) => !keep.has(m.allocationId)).map((m) => m.id)
      if (toDelete.length > 0) {
        await tx.reservationAllocation.deleteMany({ where: { id: { in: toDelete } } })
      }
      const have = new Set(existingManual.map((m) => m.allocationId))
      const toCreate = manualIds.filter((id) => !have.has(id))
      if (toCreate.length > 0) {
        await tx.reservationAllocation.createMany({
          data: toCreate.map((allocationId) => ({ reservationId, allocationId, source: "MANUAL" })),
        })
      }
    }

    // A linked allocation that was previously attached manually would now violate the
    // (reservationId, allocationId) unique — the manual row wins (it may carry
    // overrides), so skip creating a linked duplicate.
    const manualAfter = manualIds !== undefined ? new Set(manualIds) : new Set(existingManual.map((m) => m.allocationId))
    const linkedToCreate = linked.filter((l) => !manualAfter.has(l.allocationId))
    if (linkedToCreate.length > 0) {
      await tx.reservationAllocation.createMany({
        data: linkedToCreate.map((l) => {
          const windows = windowsById.get(l.allocationId)
          return { reservationId, allocationId: l.allocationId, source: l.source, appliesTo: windows ? serializeWindows(windows) : null }
        }),
      })
    }
  })

  return {}
}
