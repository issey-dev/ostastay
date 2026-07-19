import { prisma } from "@/lib/db"
import { resolveLinkedAllocationIds } from "@/lib/allocations"

// Materializes a reservation's ReservationAllocation rows — the single write path used
// by both the reservation POST and PUT routes. RATE_PLAN/MEAL_PLAN-sourced rows are
// re-derived from the current links each time (so date/plan edits stay correct), while
// MANUAL rows (and their negotiated price overrides) are preserved unless
// `manualAllocationIds` explicitly changes the manual set. Night Audit reads only the
// rows this writes — later edits to a rate plan's links never reprice an existing stay.
export async function materializeReservationAllocations(params: {
  reservationId: string
  propertyId: string
  ratePlanId: string | null
  mealPlanCode: string | null
  // undefined = leave existing MANUAL rows untouched; an array = full replacement of
  // the manual set (rows keep their overrides when the allocation stays selected).
  manualAllocationIds?: string[]
}): Promise<{ error?: string }> {
  const { reservationId, propertyId, ratePlanId, mealPlanCode } = params

  // Resolve the linked (RATE_PLAN + MEAL_PLAN) attachment set. Only active
  // allocations attach — a deactivated allocation stops appearing on new/edited
  // reservations without touching historical ones.
  const [ratePlan, mealPlan] = await Promise.all([
    ratePlanId
      ? prisma.ratePlan.findUnique({
          where: { id: ratePlanId },
          include: {
            allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } },
            parentRatePlan: {
              include: { allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } } },
            },
          },
        })
      : null,
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

  const linked = resolveLinkedAllocationIds({
    ratePlanLinks: activeLinks(ratePlan?.allocationLinks),
    parentRatePlanLinks: activeLinks(ratePlan?.parentRatePlan?.allocationLinks),
    mealPlanLinks: activeLinks(mealPlan?.allocationLinks),
  })
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
        data: linkedToCreate.map((l) => ({ reservationId, allocationId: l.allocationId, source: l.source })),
      })
    }
  })

  return {}
}
