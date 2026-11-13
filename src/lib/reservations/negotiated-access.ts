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
  /** The booking's Source (Agent Portal plan A-21): a plan linked to either party is allowed. */
  sourceProfileId?: string | null
  /** The booking's property: the lock-in counts only negotiated plans of this property. */
  propertyId?: string
  alreadyOnBooking?: string[]
}): Promise<string | null> {
  const ids = [...new Set(params.ratePlanIds)].filter((id) => !params.alreadyOnBooking?.includes(id))
  if (ids.length === 0) return null
  const plans = await prisma.ratePlan.findMany({
    where: { id: { in: ids }, isNegotiated: true },
    select: { name: true, agentAccess: { select: { upid: true } } },
  })
  for (const plan of plans) {
    const parties = [params.travelAgentId, params.sourceProfileId].filter(Boolean)
    if (parties.length === 0 || !plan.agentAccess.some((a) => parties.includes(a.upid))) {
      return `The rate plan ${plan.name} is negotiated: it can only be booked through the travel agent or company it was set up for.`
    }
  }
  // Lock-in (owner, 2026-11-13): a party linked to negotiated plans may use only those.
  const lock = params.propertyId ? await negotiatedLock([params.travelAgentId, params.sourceProfileId], params.propertyId) : null
  if (lock) {
    const outside = await prisma.ratePlan.findMany({
      where: { id: { in: ids.filter((id) => !lock.planIds.has(id)) } },
      select: { name: true },
    })
    if (outside.length > 0) {
      return `${lock.names.join(" and ")} ${lock.names.length > 1 ? "are" : "is"} on negotiated rates: book with ${lock.names.length > 1 ? "their" : "its"} negotiated rate plan, not ${outside[0].name}.`
    }
  }
  return null
}

/**
 * The negotiated plans a booking's parties are locked to (DECISIONS "Negotiated rate plans",
 * owner 2026-11-13): when any party (Travel Agent / Company, Source) is linked to at least one
 * negotiated plan, only the union of those parties' linked plans may be used. Null = no lock.
 */
export async function negotiatedLock(partyIds: (string | null | undefined)[], propertyId: string): Promise<{ planIds: Set<string>; names: string[] } | null> {
  const parties = [...new Set(partyIds.filter((p): p is string => !!p))]
  if (parties.length === 0) return null
  const links = await prisma.ratePlanAgentAccess.findMany({
    where: { upid: { in: parties }, ratePlan: { isNegotiated: true, propertyId } },
    select: { ratePlanId: true, profile: { select: { upid: true, companyName: true, firstName: true } } },
  })
  if (links.length === 0) return null
  const names = [...new Map(links.map((l) => [l.profile.upid, l.profile.companyName || l.profile.firstName])).values()]
  return { planIds: new Set(links.map((l) => l.ratePlanId)), names }
}
