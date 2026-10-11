import { prisma } from "@/lib/db"

/**
 * A negotiated rate plan (RatePlan.isNegotiated) can only be booked through the travel agent /
 * company it was granted to (RatePlanAgentAccess). The booking form hides the others; this is the
 * same rule on the server, so a hand-made request can't use one either.
 *
 * `alreadyOnBooking` lists plans the reservation already carries (an edit): those stay allowed so
 * an existing booking can still be edited after its access was withdrawn.
 * Returns an error message, or null when every plan is allowed.
 */
export async function negotiatedPlanError(params: {
  ratePlanIds: string[]
  travelAgentId: string | null | undefined
  alreadyOnBooking?: string[]
}): Promise<string | null> {
  const ids = [...new Set(params.ratePlanIds)].filter((id) => !params.alreadyOnBooking?.includes(id))
  if (ids.length === 0) return null
  const plans = await prisma.ratePlan.findMany({
    where: { id: { in: ids }, isNegotiated: true },
    select: { name: true, agentAccess: { select: { upid: true } } },
  })
  for (const plan of plans) {
    if (!params.travelAgentId || !plan.agentAccess.some((a) => a.upid === params.travelAgentId)) {
      return `The rate plan ${plan.name} is negotiated: it can only be booked through the travel agent or company it was set up for.`
    }
  }
  return null
}
