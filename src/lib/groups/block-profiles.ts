import { prisma } from "@/lib/db";

// A group block's profiles (owner, 2026-11-13): the Travel Agent or Company and the Source set
// on the block are carried by every reservation in it, and cannot be changed on the
// reservation while they are set on the block. A profile the block leaves empty stays free on
// the reservation.

type WithProfiles = { groupBlockId?: string | null; travelAgentId?: string | null; sourceProfileId?: string | null };

/** Overwrites the body's profiles with the block's, where the block sets them. Mutates `body`. */
export async function applyBlockProfiles<T extends WithProfiles>(body: T, currentBlockId?: string | null): Promise<T> {
  const blockId = body.groupBlockId !== undefined ? body.groupBlockId : currentBlockId;
  if (!blockId || blockId === "none") return body;
  const block = await prisma.groupBlock.findUnique({ where: { id: blockId }, select: { travelAgentId: true, sourceProfileId: true } });
  if (!block) return body;
  if (block.travelAgentId) body.travelAgentId = block.travelAgentId;
  if (block.sourceProfileId) body.sourceProfileId = block.sourceProfileId;
  return body;
}

/** Reservations a change of the block's profiles carries over to: live pickups, not the Posting Master. */
export const LIVE_PICKUP_WHERE = (groupBlockId: string) => ({
  groupBlockId,
  isPostingMaster: false,
  status: { in: ["TENTATIVE", "RESERVED"] },
});
