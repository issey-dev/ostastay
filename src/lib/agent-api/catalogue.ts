import { prisma } from "@/lib/db";
import { getPropertySettings } from "@/lib/property-settings";
import { perNightTypeAvailability, outstandingBlockHolds, dayStartMs, formatLocalDay } from "@/lib/availability";
import { getClosedDates } from "@/lib/restrictions";
import { resolveWebsiteNightlyPrices } from "@/lib/website-api/rates";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { salesWindowOpensAt } from "@/lib/groups/slot-requests";
import { toUtcMidnight } from "@/lib/business-date";
import { AgentApiError, notFound } from "@/lib/agent-api/http";
import type { AgentIdentity } from "@/lib/agent-api/auth";

// What an agent may read (Agent Portal plan A-9, A-11, §6 "Catalogue" / "Availability and
// price"; Phase 5, 9.5.0). Rules that shape every answer here:
//   · Rates: ONLY the Source's negotiated plans at that property (owner, 2026-11-13). No other
//     published rate is ever shown. A Source with none sees availability "on request".
//   · Their own slots: exact (rooms approved, booked tentative/confirmed, still free, release).
//   · The house: capped at agentAvailabilityCap ("N+" above it), clamped at 0, stop sale shown
//     as closed (D-7) — never overbooking headroom. Beside it the option forecast.
//   · Never: other agents' data, room numbers, staff names, internal remarks, other rates.

const DAY = 86_400_000;
export const AGENT_CANCEL_REASON = "AGENT_CANCEL_REASON";

/** The Source's negotiated plans at a property, best priority first. */
export async function agentRatePlans(sourceProfileId: string, propertyId: string) {
  return prisma.ratePlan.findMany({
    where: { propertyId, isNegotiated: true, agentAccess: { some: { upid: sourceProfileId } } },
    select: { id: true, code: true, name: true, description: true, priority: true, agentSalesOpenAt: true, agentAccess: { where: { upid: sourceProfileId }, select: { commissionRate: true } } },
    orderBy: { priority: "asc" },
  });
}

export async function agentMe(agent: AgentIdentity, propertyIds: string[]) {
  const [source, properties] = await Promise.all([
    prisma.profile.findUniqueOrThrow({
      where: { upid: agent.sourceProfileId },
      select: { companyName: true, firstName: true, commissionRate: true, settlementMode: true, earlyAccessDays: true },
    }),
    prisma.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const perProperty = await Promise.all(
    properties.map(async (p) => {
      const [plans, slots] = await Promise.all([
        agentRatePlans(agent.sourceProfileId, p.id),
        prisma.groupBlock.count({ where: { propertyId: p.id, sourceProfileId: agent.sourceProfileId, status: { in: ["REQUESTED", "TENTATIVE", "DEFINITE"] } } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        rates: plans.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        liveSlots: slots,
        salesOpenAt: (await salesWindowOpensAt(agent.sourceProfileId, p.id))?.toISOString() ?? null,
      };
    })
  );
  return {
    agent: { id: agent.agentUserId, name: agent.name, email: agent.email },
    source: {
      name: source.companyName || source.firstName,
      commissionRate: source.commissionRate,
      settlementMode: source.settlementMode ?? "AGENT_NET",
      earlyAccessDays: source.earlyAccessDays ?? 0,
    },
    properties: perProperty,
  };
}

export async function agentPropertyDetail(agent: AgentIdentity, propertyId: string) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, name: true, code: true, defaultCurrency: true, checkInTime: true, checkOutTime: true, timeZone: true, enterpriseId: true },
  });
  if (!property) throw notFound("Property not found.");
  const [settings, roomTypes, mealPlans, reasons, plans, transport] = await Promise.all([
    getPropertySettings(propertyId),
    prisma.roomType.findMany({
      where: { propertyId, isPseudo: false, isActive: true },
      select: { id: true, code: true, name: true, description: true, baseOccupancy: true, maxOccupancy: true },
      orderBy: { name: "asc" },
    }),
    prisma.mealPlan.findMany({ where: { propertyId, isActive: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }).catch(() => []),
    prisma.systemCode.findMany({
      where: { enterpriseId: property.enterpriseId, category: AGENT_CANCEL_REASON, isActive: true, OR: [{ propertyId }, { propertyId: null }] },
      select: { code: true, value: true },
      orderBy: { sortOrder: "asc" },
    }),
    agentRatePlans(agent.sourceProfileId, propertyId),
    prisma.transportSettings.findUnique({ where: { propertyId }, select: { enabled: true } }).catch(() => null),
  ]);
  return {
    id: property.id,
    name: property.name,
    code: property.code,
    currency: property.defaultCurrency,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    timeZone: property.timeZone,
    roomTypes,
    mealPlans,
    rates: plans.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description })),
    rules: {
      optionDaysBeforeArrival: settings.optionDaysBeforeArrival,
      shortOptionHours: settings.shortOptionHours,
      guestDetailsDueDays: settings.guestDetailsDueDays,
      availabilityCap: settings.agentAvailabilityCap,
    },
    cancelReasons: reasons.length
      ? reasons.map((r) => ({ code: r.code, label: r.value }))
      : [
          { code: "CLIENT_CANCELLED", label: "The client cancelled" },
          { code: "NO_PAYMENT", label: "No payment received" },
          { code: "CHANGED_PLANS", label: "Travel plans changed" },
          { code: "OTHER", label: "Other" },
        ],
    transfersBookable: !!transport?.enabled,
  };
}

type Status = "AVAILABLE" | "LIMITED" | "ON_REQUEST" | "CLOSED" | "NOT_ON_SALE";

/**
 * Per room type per night. `available` is the house number capped at the property's cap
 * (null + availableLabel "5+" above it). `onOption` = tentative bookings that night plus
 * unsold rooms held in other approved tentative slots. `mySlotLeft` = rooms still free in
 * this agent's own live slots that night (exact), `myReleaseDate` the earliest date those
 * go back on sale. `rate` = the nightly price on the Source's best negotiated plan.
 */
export async function agentAvailability(agent: AgentIdentity, propertyId: string, from: Date, to: Date) {
  const start = toUtcMidnight(from);
  const end = toUtcMidnight(to);
  if (!(end > start)) throw new AgentApiError(400, "INVALID_DATES", "'to' must be after 'from'.");
  if ((end.getTime() - start.getTime()) / DAY > 62) throw new AgentApiError(400, "RANGE_TOO_LONG", "At most 62 nights per request.");

  const [settings, roomTypes, plans, opensAt] = await Promise.all([
    getPropertySettings(propertyId),
    prisma.roomType.findMany({ where: { propertyId, isPseudo: false, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    agentRatePlans(agent.sourceProfileId, propertyId),
    salesWindowOpensAt(agent.sourceProfileId, propertyId),
  ]);
  const cap = settings.agentAvailabilityCap;
  const plan = plans[0] ?? null;
  const prices = plan
    ? await resolveWebsiteNightlyPrices({ propertyId, ratePlanId: plan.id, roomTypeIds: roomTypes.map((t) => t.id), from: start, to: end })
    : new Map();
  const { propertyLevel, byRoomType } = await getClosedDates({
    propertyId,
    windowStart: dayStartMs(start),
    windowEnd: dayStartMs(end),
    roomTypeIds: roomTypes.map((t) => t.id),
  });

  // Tentative bookings per type per night (the option forecast's first half).
  const tentative = await prisma.roomAssignment.findMany({
    where: { roomTypeId: { in: roomTypes.map((t) => t.id) }, startDate: { lt: end }, endDate: { gt: start }, reservation: { propertyId, status: "TENTATIVE" } },
    select: { roomTypeId: true, startDate: true, endDate: true },
  });
  // This agent's own live slots.
  const mySlots = await prisma.groupBlock.findMany({
    where: { propertyId, sourceProfileId: agent.sourceProfileId, status: { in: ["TENTATIVE", "DEFINITE"] }, startDate: { lt: end }, endDate: { gt: start } },
    select: {
      id: true, code: true, startDate: true, endDate: true, cutoffDate: true, releaseDays: true,
      roomHolds: { select: { roomTypeId: true, quantity: true } },
      reservations: { where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { checkInDate: true, checkOutDate: true, assignments: { select: { roomTypeId: true } } } },
    },
  });

  const types = [];
  for (const t of roomTypes) {
    const house = await perNightTypeAvailability({ propertyId, roomTypeId: t.id, startDate: start, endDate: end });
    const otherSlots = await outstandingBlockHolds({
      propertyId, roomTypeId: t.id, windowStart: dayStartMs(start), windowEnd: dayStartMs(end), blockStatusIn: ["TENTATIVE"],
    });
    const nights = house.map((n, i) => {
      const nightMs = dayStartMs(start) + i * DAY;
      const utcNight = start.getTime() + i * DAY;
      const closed = propertyLevel.has(nightMs) || !!byRoomType.get(t.id)?.has(nightMs);
      const onTentative = tentative.filter((a) => a.roomTypeId === t.id && toUtcMidnight(a.startDate).getTime() <= utcNight && toUtcMidnight(a.endDate).getTime() > utcNight).length;
      const otherHeld = otherSlots.reduce((s, h) => (h.startMs <= nightMs && h.endMs > nightMs ? s + h.outstanding : s), 0);
      let mySlotLeft = 0;
      let myRelease: Date | null = null;
      for (const b of mySlots) {
        if (!(toUtcMidnight(b.startDate).getTime() <= utcNight && toUtcMidnight(b.endDate).getTime() > utcNight)) continue;
        const held = b.roomHolds.find((h) => h.roomTypeId === t.id)?.quantity ?? 0;
        if (!held) continue;
        const booked = b.reservations.filter(
          (r) => r.assignments.some((a) => a.roomTypeId === t.id) && toUtcMidnight(r.checkInDate).getTime() <= utcNight && toUtcMidnight(r.checkOutDate).getTime() > utcNight
        ).length;
        mySlotLeft += Math.max(0, held - booked);
        const rolling = b.releaseDays !== null ? new Date(utcNight - b.releaseDays * DAY) : null;
        const release = [b.cutoffDate, rolling].filter((d): d is Date => !!d).sort((a, c) => a.getTime() - c.getTime())[0] ?? null;
        if (release && (!myRelease || release < myRelease)) myRelease = release;
      }
      const price = prices.get(t.id)?.get(n.date)?.price ?? null;
      let status: Status;
      if (opensAt) status = "NOT_ON_SALE";
      else if (closed) status = "CLOSED";
      else if (!plan || price === null) status = "ON_REQUEST";
      else if (n.available <= 0) status = "ON_REQUEST";
      else if (n.available <= Math.min(2, cap)) status = "LIMITED";
      else status = "AVAILABLE";
      return {
        date: n.date,
        status,
        available: closed ? 0 : n.available > cap ? null : n.available,
        availableLabel: closed ? "0" : n.available > cap ? `${cap}+` : String(n.available),
        onOption: onTentative + otherHeld,
        mySlotLeft,
        myReleaseDate: myRelease ? myRelease.toISOString().slice(0, 10) : null,
        rate: plan ? price : null,
      };
    });
    types.push({ roomTypeId: t.id, code: t.code, name: t.name, nights });
  }
  return {
    propertyId,
    from: formatLocalDay(dayStartMs(start)),
    to: formatLocalDay(dayStartMs(end)),
    ratePlan: plan ? { id: plan.id, code: plan.code, name: plan.name } : null,
    salesOpenAt: opensAt?.toISOString() ?? null,
    availabilityCap: cap,
    roomTypes: types,
  };
}

/**
 * The authoritative price for a stay on one of the Source's negotiated plans, with the
 * commission estimate (on the room rate without service charge and tax, A-20).
 */
export async function agentQuote(
  agent: AgentIdentity,
  propertyId: string,
  input: { roomTypeId: unknown; ratePlanId?: unknown; checkIn: unknown; checkOut: unknown; adults?: unknown; children?: unknown; mealPlan?: unknown }
) {
  const plans = await agentRatePlans(agent.sourceProfileId, propertyId);
  if (plans.length === 0) throw new AgentApiError(409, "NO_RATE", "No rate is set up for you at this property yet. Ask the hotel.");
  const plan = typeof input.ratePlanId === "string" && input.ratePlanId ? plans.find((p) => p.id === input.ratePlanId) : plans[0];
  if (!plan) throw new AgentApiError(400, "RATE_NOT_ALLOWED", "That rate is not available to you.");
  const roomType = await prisma.roomType.findFirst({ where: { id: String(input.roomTypeId ?? ""), propertyId, isPseudo: false, isActive: true } });
  if (!roomType) throw notFound("Room type not found.");
  const ci = new Date(String(input.checkIn ?? ""));
  const co = new Date(String(input.checkOut ?? ""));
  if (isNaN(ci.getTime()) || isNaN(co.getTime()) || co <= ci) throw new AgentApiError(400, "INVALID_DATES", "Send checkIn and checkOut (yyyy-MM-dd), checkOut after checkIn.");
  const adults = Math.max(1, Number(input.adults ?? 1) || 1);
  const children = Math.max(0, Number(input.children ?? 0) || 0);
  if (adults + children > roomType.maxOccupancy) throw new AgentApiError(400, "TOO_MANY_GUESTS", `${roomType.name} sleeps at most ${roomType.maxOccupancy}.`);
  const quote = await computeReservationQuote({
    propertyId,
    assignments: [{ roomTypeId: roomType.id, ratePlanId: plan.id, startDate: toUtcMidnight(ci), endDate: toUtcMidnight(co) }],
    adults,
    children,
    mealPlanCode: typeof input.mealPlan === "string" ? input.mealPlan : null,
  });
  // Never a booking at 0 (W-6): a night with no price is NO_RATE.
  if (quote.days.some((d) => !(d.rate > 0))) {
    throw new AgentApiError(409, "NO_RATE", "No price is loaded for one of these nights.");
  }
  const source = await prisma.profile.findUniqueOrThrow({ where: { upid: agent.sourceProfileId }, select: { commissionRate: true } });
  const rate = plan.agentAccess[0]?.commissionRate ?? source.commissionRate ?? 0;
  const base = quote.totals.roomBase + quote.totals.extraOccupancyBase;
  const commission = Math.round(base * rate) / 100;
  return {
    ratePlan: { id: plan.id, code: plan.code, name: plan.name },
    roomType: { id: roomType.id, code: roomType.code, name: roomType.name },
    nights: quote.nights,
    totals: quote.totals,
    commission: { rate, base: Math.round(base * 100) / 100, amount: Math.round(commission * 100) / 100 },
    warnings: quote.warnings,
  };
}
