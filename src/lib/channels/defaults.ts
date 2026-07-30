import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { assertLinkInEnterprise } from "@/lib/channels/sharing";

// Per-link defaults used when converting a ChannelInboundBooking into a real Reservation.
// See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md and prisma/schema.prisma's
// ChannelBookingDefaults model for why this exists: a channel booking confirms a stay and a
// price, never one of THIS property's rate plans or meal plans, so conversion has nothing to
// attach the booking to without an operator having configured one.

export type PublicBookingDefaults = {
  linkId: string;
  ratePlanId: string | null;
  ratePlanName: string | null;
  mealPlanCode: string;
};

export async function getBookingDefaults(enterpriseId: string, linkId: string): Promise<PublicBookingDefaults> {
  await assertLinkInEnterprise(linkId, enterpriseId);

  const row = await prisma.channelBookingDefaults.findUnique({
    where: { linkId },
    include: { ratePlan: { select: { name: true } } },
  });

  return {
    linkId,
    ratePlanId: row?.ratePlanId ?? null,
    ratePlanName: row?.ratePlan?.name ?? null,
    mealPlanCode: row?.mealPlanCode ?? "NONE",
  };
}

/**
 * Configure (or clear) the defaults for one link. Upserts, since most links start with no
 * row at all — the resolver treats "no row" and "a row with nulls" identically.
 */
export async function setBookingDefaults(params: {
  enterpriseId: string;
  linkId: string;
  /** Null clears the default — conversion then has nothing to attach a booking to, and
   *  resolveBookingDefaults() reports that rather than guessing. */
  ratePlanId: string | null;
  /** Reservation.mealPlan is an untyped string defaulting to "NONE" everywhere else in the
   *  app (see createReservation) — trusted the same way here, not validated against the
   *  MealPlan LOV. */
  mealPlanCode: string;
}): Promise<PublicBookingDefaults> {
  const { enterpriseId, linkId, ratePlanId, mealPlanCode } = params;
  const link = await assertLinkInEnterprise(linkId, enterpriseId);

  if (ratePlanId) {
    const ratePlan = await prisma.ratePlan.findUnique({ where: { id: ratePlanId } });
    if (!ratePlan || ratePlan.propertyId !== link.propertyId) {
      throw new ForbiddenError("Rate plan does not belong to this property");
    }
  }

  await prisma.channelBookingDefaults.upsert({
    where: { linkId },
    update: { ratePlanId, mealPlanCode: mealPlanCode.trim() || "NONE" },
    create: { linkId, ratePlanId, mealPlanCode: mealPlanCode.trim() || "NONE" },
  });

  return getBookingDefaults(enterpriseId, linkId);
}

export type ResolvedBookingDefaults = {
  ratePlanId: string | null;
  mealPlanCode: string;
  /** Non-null when conversion cannot proceed — nothing here is silently guessed. */
  problem: string | null;
};

/**
 * What createReservation should use to fill the gaps in one inbound booking. Looked up by
 * propertyId rather than linkId because that is what a ChannelInboundBooking already carries
 * once its room type is resolved — see resolveRoomType() in inbound/ingest.ts, which is the
 * same mapping a link's property comes from.
 *
 * No configured default (or no rate plan chosen yet) is a PROBLEM, not a fallback to some
 * guessed rate plan — attaching a booking to the wrong rate plan misprices it at Night Audit,
 * which is worse than leaving the booking unconverted for the desk to resolve by hand.
 */
export async function resolveBookingDefaults(propertyId: string): Promise<ResolvedBookingDefaults> {
  const link = await prisma.channelPropertyLink.findUnique({
    where: { propertyId },
    select: { id: true },
  });
  if (!link) {
    return { ratePlanId: null, mealPlanCode: "NONE", problem: "Property is not linked to a channel manager" };
  }

  const row = await prisma.channelBookingDefaults.findUnique({ where: { linkId: link.id } });
  if (!row?.ratePlanId) {
    return { ratePlanId: null, mealPlanCode: row?.mealPlanCode ?? "NONE", problem: "No default rate plan is configured for this property" };
  }

  return { ratePlanId: row.ratePlanId, mealPlanCode: row.mealPlanCode, problem: null };
}
