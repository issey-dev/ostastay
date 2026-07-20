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
}): Promise<string[]> {
  const { propertyId, segments, excludeReservationId } = opts;
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

    // Walk each night once across the whole window; a night is oversold when the
    // rooms already booked plus the rooms this request needs exceed sellable stock.
    let worst: { night: number; booked: number; requested: number } | null = null;
    for (let night = windowStart; night < windowEnd; night += DAY_MS) {
      const requested = typeSegments.filter(
        (s) => dayStartMs(s.startDate) <= night && dayStartMs(s.endDate) > night
      ).length;
      if (requested === 0) continue;
      const booked = existing.filter(
        (a) => dayStartMs(a.startDate) <= night && dayStartMs(a.endDate) > night
      ).length;
      if (booked + requested > capacity) {
        if (!worst || booked + requested - capacity > worst.booked + worst.requested - capacity) {
          worst = { night, booked, requested };
        }
      }
    }

    if (worst) {
      conflicts.push(
        `No availability for ${roomType.name} on ${fmtDay(worst.night)}: ${worst.booked} of ${capacity} room${capacity === 1 ? "" : "s"} already booked`
      );
    }
  }

  return conflicts;
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
