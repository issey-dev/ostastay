import { prisma } from "@/lib/db";

// Reservation statuses that actually hold inventory. CANCELLED, NO_SHOW and
// CHECKED_OUT never block a room or count toward a room type's sold count — a
// no-show's room goes back on sale for the remaining nights, matching standard
// front-office practice.
export const INVENTORY_HOLDING_STATUSES = ["RESERVED", "IN_HOUSE"];

// Rooms in either of these statuses are not sellable inventory. OUT_OF_ORDER is a
// maintenance state (previously it was still being offered for sale — see
// rooms/available/route.ts, which used to exclude only OUT_OF_SERVICE).
export const UNSELLABLE_ROOM_STATUSES = ["OUT_OF_ORDER", "OUT_OF_SERVICE"];

const DAY_MS = 86_400_000;

function dayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type AvailabilitySegment = {
  roomTypeId: string;
  startDate: Date;
  endDate: Date;
};

// Type-level overbooking guard: for every night each segment covers, the number of
// inventory-holding assignments of that room type (already in the DB, plus the other
// segments in this same request) must stay below the count of sellable physical rooms
// of that type. Returns human-readable conflict strings (empty = bookable).
//
// Pseudo room types are exempt — they exist precisely as non-physical buckets
// (day-use, overbooking buffer) and often have no real rooms to count.
export async function findTypeAvailabilityConflicts(opts: {
  propertyId: string;
  segments: AvailabilitySegment[];
  excludeReservationId?: string | null;
  // When set, this block's own outstanding holds are ignored — a block's pickups draw
  // FROM its held rooms rather than being blocked by them.
  excludeGroupBlockId?: string | null;
}): Promise<string[]> {
  const { propertyId, segments, excludeReservationId, excludeGroupBlockId } = opts;
  const conflicts: string[] = [];

  const typeIds = [...new Set(segments.map((s) => s.roomTypeId))];
  if (typeIds.length === 0) return conflicts;

  const roomTypes = await prisma.roomType.findMany({
    where: { id: { in: typeIds }, propertyId },
    select: { id: true, name: true, isPseudo: true },
  });
  const typeById = new Map(roomTypes.map((t) => [t.id, t]));

  for (const typeId of typeIds) {
    const roomType = typeById.get(typeId);
    if (!roomType || roomType.isPseudo) continue;

    const typeSegments = segments.filter((s) => s.roomTypeId === typeId);
    const windowStart = Math.min(...typeSegments.map((s) => dayStartMs(s.startDate)));
    const windowEnd = Math.max(...typeSegments.map((s) => dayStartMs(s.endDate)));
    if (windowEnd <= windowStart) continue; // zero/negative-length — date validation's problem, not ours

    const capacity = await prisma.room.count({
      where: {
        propertyId,
        roomTypeId: typeId,
        status: { notIn: UNSELLABLE_ROOM_STATUSES },
      },
    });

    const existing = await prisma.roomAssignment.findMany({
      where: {
        roomTypeId: typeId,
        ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
        startDate: { lt: new Date(windowEnd) },
        endDate: { gt: new Date(windowStart) },
        reservation: {
          propertyId,
          status: { in: INVENTORY_HOLDING_STATUSES },
        },
      },
      select: { startDate: true, endDate: true },
    });

    // Outstanding group-block holds for this type overlapping the window. A hold blocks
    // (quantity − already-picked-up-of-type) rooms across the block's whole span (the
    // picked-up portion is already counted as real assignments above, so don't double
    // count). A passed cutoff releases the hold; a cancelled block never holds.
    const holdWindows = await outstandingBlockHolds({
      propertyId,
      roomTypeId: typeId,
      windowStart,
      windowEnd,
      excludeGroupBlockId,
    });

    // Walk each night once across the whole window; a night is oversold when the rooms
    // already booked, plus group holds active that night, plus what this request needs,
    // exceed sellable stock.
    let worst: { night: number; blocked: number } | null = null;
    for (let night = windowStart; night < windowEnd; night += DAY_MS) {
      const requested = typeSegments.filter(
        (s) => dayStartMs(s.startDate) <= night && dayStartMs(s.endDate) > night
      ).length;
      if (requested === 0) continue;
      const booked = existing.filter(
        (a) => dayStartMs(a.startDate) <= night && dayStartMs(a.endDate) > night
      ).length;
      const held = holdWindows.reduce(
        (sum, h) => (h.startMs <= night && h.endMs > night ? sum + h.outstanding : sum),
        0
      );
      const blocked = booked + held;
      if (blocked + requested > capacity) {
        if (!worst || blocked + requested - capacity > worst.blocked + requested - capacity) {
          worst = { night, blocked };
        }
      }
    }

    if (worst) {
      conflicts.push(
        `No availability for ${roomType.name} on ${fmtDay(worst.night)}: ${worst.blocked} of ${capacity} room${capacity === 1 ? "" : "s"} already booked or held`
      );
    }
  }

  return conflicts;
}

export type BlockHoldWindow = { startMs: number; endMs: number; outstanding: number };

// Outstanding (not-yet-picked-up) group-block holds for a room type overlapping a
// window. Each entry blocks `outstanding` rooms for every night in [startMs, endMs).
// A cancelled block never holds; a passed cutoff releases the hold; the picked-up
// portion is subtracted (those rooms are already counted as real assignments).
export async function outstandingBlockHolds(opts: {
  propertyId: string;
  roomTypeId: string;
  windowStart: number;
  windowEnd: number;
  excludeGroupBlockId?: string | null;
}): Promise<BlockHoldWindow[]> {
  const { propertyId, roomTypeId, windowStart, windowEnd, excludeGroupBlockId } = opts;
  const holdRows = await prisma.groupBlockRoom.findMany({
    where: {
      roomTypeId,
      quantity: { gt: 0 },
      groupBlock: {
        propertyId,
        status: { notIn: ["CANCELLED", "LOST"] },
        startDate: { lt: new Date(windowEnd) },
        endDate: { gt: new Date(windowStart) },
        ...(excludeGroupBlockId ? { id: { not: excludeGroupBlockId } } : {}),
      },
    },
    select: {
      quantity: true,
      groupBlock: { select: { id: true, startDate: true, endDate: true, cutoffDate: true } },
    },
  });
  if (holdRows.length === 0) return [];

  const blockIds = holdRows.map((h) => h.groupBlock.id);
  const picked = await prisma.roomAssignment.findMany({
    where: {
      roomTypeId,
      reservation: { groupBlockId: { in: blockIds }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    },
    select: { reservation: { select: { groupBlockId: true } } },
  });
  const pickedByBlock = new Map<string, number>();
  for (const a of picked) {
    const b = a.reservation?.groupBlockId;
    if (b) pickedByBlock.set(b, (pickedByBlock.get(b) ?? 0) + 1);
  }

  const now = new Date();
  const out: BlockHoldWindow[] = [];
  for (const h of holdRows) {
    const b = h.groupBlock;
    if (b.cutoffDate && now > b.cutoffDate) continue; // released after cutoff
    const outstanding = Math.max(0, h.quantity - (pickedByBlock.get(b.id) ?? 0));
    if (outstanding > 0) out.push({ startMs: dayStartMs(b.startDate), endMs: dayStartMs(b.endDate), outstanding });
  }
  return out;
}

// Minimum sellable rooms of a type available across every night of a window —
// capacity minus inventory-holding assignments minus OTHER blocks' outstanding holds.
// This is the most a group block can hold for the window without overbooking.
export async function minTypeAvailability(opts: {
  propertyId: string;
  roomTypeId: string;
  startDate: Date;
  endDate: Date;
  excludeGroupBlockId?: string | null;
}): Promise<number> {
  const { propertyId, roomTypeId, startDate, endDate, excludeGroupBlockId } = opts;
  const windowStart = dayStartMs(startDate);
  const windowEnd = dayStartMs(endDate);
  if (windowEnd <= windowStart) return 0;

  const capacity = await prisma.room.count({
    where: { propertyId, roomTypeId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
  });
  const existing = await prisma.roomAssignment.findMany({
    where: {
      roomTypeId,
      startDate: { lt: new Date(windowEnd) },
      endDate: { gt: new Date(windowStart) },
      reservation: { propertyId, status: { in: INVENTORY_HOLDING_STATUSES } },
    },
    select: { startDate: true, endDate: true },
  });
  const holdWindows = await outstandingBlockHolds({ propertyId, roomTypeId, windowStart, windowEnd, excludeGroupBlockId });

  let min = capacity;
  for (let night = windowStart; night < windowEnd; night += DAY_MS) {
    const booked = existing.filter((a) => dayStartMs(a.startDate) <= night && dayStartMs(a.endDate) > night).length;
    const held = holdWindows.reduce((s, h) => (h.startMs <= night && h.endMs > night ? s + h.outstanding : s), 0);
    min = Math.min(min, capacity - booked - held);
  }
  return Math.max(0, min);
}

// Physical-room double-booking guard: true when another inventory-holding
// reservation's assignment already occupies this room for any overlapping night.
export async function hasRoomConflict(opts: {
  roomId: string;
  startDate: Date;
  endDate: Date;
  excludeReservationId?: string | null;
  excludeAssignmentId?: string | null;
}): Promise<boolean> {
  const { roomId, startDate, endDate, excludeReservationId, excludeAssignmentId } = opts;
  const conflict = await prisma.roomAssignment.findFirst({
    where: {
      roomId,
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
      ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
      startDate: { lt: endDate },
      endDate: { gt: startDate },
      reservation: { status: { in: INVENTORY_HOLDING_STATUSES } },
    },
    select: { id: true },
  });
  return conflict !== null;
}
