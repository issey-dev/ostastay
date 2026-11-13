import { prisma } from "@/lib/db";
import { toUtcMidnight } from "@/lib/business-date";

// Quota checkpoints (Agent Portal plan A-12, Phase 4). "By this date, at least this share of
// the held rooms must be booked." A missed checkpoint RELEASES the unsold rooms (owner,
// 2026-11-11): the hold shrinks to what is booked, per room type, and the block carries on
// with those bookings. Tentative bookings count as booked. Each checkpoint is processed once
// (claimed with a conditional update), by the group-block-release job and lazily on read.
//
// The one-date cutoff and the rolling release need no processing: availability reads them
// live (outstandingBlockHolds), and tentative pickups' options run to the cutoff, so the
// option-expiry job releases those bookings (kept as records) at that moment.

export async function processDueCheckpoints(opts: { now?: Date; enterpriseId?: string; propertyId?: string; groupBlockId?: string } = {}) {
  const now = opts.now ?? new Date();
  const due = await prisma.groupBlockCheckpoint.findMany({
    where: {
      processedAt: null,
      date: { lte: toUtcMidnight(now) },
      ...(opts.groupBlockId ? { groupBlockId: opts.groupBlockId } : {}),
      groupBlock: {
        status: { in: ["TENTATIVE", "DEFINITE"] },
        ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
        ...(opts.enterpriseId ? { property: { enterpriseId: opts.enterpriseId } } : {}),
      },
    },
    orderBy: { date: "asc" },
    take: 200,
  });
  const results: { checkpointId: string; groupBlockId: string; met: boolean; releasedRooms: number }[] = [];
  for (const cp of due) {
    const r = await prisma.$transaction(async (tx) => {
      const claim = await tx.groupBlockCheckpoint.updateMany({ where: { id: cp.id, processedAt: null }, data: { processedAt: now } });
      if (claim.count === 0) return null;
      const block = await tx.groupBlock.findUniqueOrThrow({ where: { id: cp.groupBlockId }, include: { roomHolds: true } });
      const held = block.roomHolds.reduce((s, h) => s + h.quantity, 0);
      if (held === 0) return { checkpointId: cp.id, groupBlockId: block.id, met: true, releasedRooms: 0 };
      const picked = await tx.roomAssignment.findMany({
        where: { reservation: { groupBlockId: block.id, status: { notIn: ["CANCELLED", "NO_SHOW"] } } },
        select: { roomTypeId: true, reservationId: true },
      });
      const byType = new Map<string, Set<string>>();
      for (const a of picked) {
        const set = byType.get(a.roomTypeId) ?? new Set<string>();
        set.add(a.reservationId);
        byType.set(a.roomTypeId, set);
      }
      const booked = new Set(picked.map((p) => p.reservationId)).size;
      const met = booked * 100 >= cp.minPercent * held;
      if (met) return { checkpointId: cp.id, groupBlockId: block.id, met: true, releasedRooms: 0 };
      let released = 0;
      for (const h of block.roomHolds) {
        const keep = Math.min(h.quantity, byType.get(h.roomTypeId)?.size ?? 0);
        released += h.quantity - keep;
        if (keep !== h.quantity) await tx.groupBlockRoom.update({ where: { id: h.id }, data: { quantity: keep } });
      }
      await tx.groupBlock.update({ where: { id: block.id }, data: { totalRoomsHeld: held - released } });
      await tx.groupBlockCheckpoint.update({ where: { id: cp.id }, data: { releasedRooms: released } });
      return { checkpointId: cp.id, groupBlockId: block.id, met: false, releasedRooms: released };
    });
    if (r) results.push(r);
  }
  return results;
}

const lastSweep = new Map<string, number>();
/** Lazy enforcement for a property's reads, throttled to once a minute. */
export async function processCheckpointsSoon(propertyId: string, now = Date.now()) {
  if (now - (lastSweep.get(propertyId) ?? 0) < 60_000) return;
  lastSweep.set(propertyId, now);
  try {
    await processDueCheckpoints({ propertyId, now: new Date(now) });
  } catch (e) {
    console.error("checkpoint sweep failed", e);
  }
}
