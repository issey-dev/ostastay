import { prisma } from "@/lib/db";
import {
  dayStartMs,
  formatLocalDay,
  outstandingBlockHolds,
  INVENTORY_HOLDING_STATUSES,
  UNSELLABLE_ROOM_STATUSES,
  type AvailabilitySegment,
} from "@/lib/availability";
import { hasCapability, ForbiddenError, type AuthContext } from "@/lib/scope";

// Sell limits (Agent Portal plan A-10, Phase 2, 9.2.0).
//
// Overbooking stays a desk decision (acknowledgeOverbook), but a property can now cap it per
// night: "Deluxe may be oversold by at most 2 on 24 Dec", or "the house by at most 3".
// Past the cap only a role holding "Exceed the sell limit" (default: AVAILABILITY delete)
// may book. A night with no limit row keeps today's behaviour (no cap), so nothing changes
// on upgrade until a property sets limits.
//
// Channels, the brand website and agents never sell into overbooking at all (D-7), so they
// never reach this check.

const DAY_MS = 86_400_000;

type Load = { capacity: number; blocked: number; requested: number };

/** Per room type, per night: capacity, rooms already booked or held, and what this request adds. */
export async function nightLoads(opts: {
  propertyId: string;
  roomTypeIds: string[];
  windowStart: number;
  windowEnd: number;
  segments: AvailabilitySegment[];
  excludeReservationId?: string | null;
  excludeGroupBlockId?: string | null;
}): Promise<Map<string, Map<number, Load>>> {
  const out = new Map<string, Map<number, Load>>();
  for (const typeId of opts.roomTypeIds) {
    const capacity = await prisma.room.count({
      where: { propertyId: opts.propertyId, roomTypeId: typeId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
    });
    const existing = await prisma.roomAssignment.findMany({
      where: {
        roomTypeId: typeId,
        ...(opts.excludeReservationId ? { reservationId: { not: opts.excludeReservationId } } : {}),
        startDate: { lt: new Date(opts.windowEnd) },
        endDate: { gt: new Date(opts.windowStart) },
        reservation: { propertyId: opts.propertyId, status: { in: INVENTORY_HOLDING_STATUSES } },
      },
      select: { startDate: true, endDate: true },
    });
    const holds = await outstandingBlockHolds({
      propertyId: opts.propertyId,
      roomTypeId: typeId,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      excludeGroupBlockId: opts.excludeGroupBlockId,
    });
    const nights = new Map<number, Load>();
    for (let n = opts.windowStart; n < opts.windowEnd; n += DAY_MS) {
      const on = (s: Date, e: Date) => dayStartMs(s) <= n && dayStartMs(e) > n;
      nights.set(n, {
        capacity,
        blocked:
          existing.filter((a) => on(a.startDate, a.endDate)).length +
          holds.reduce((t, h) => (h.startMs <= n && h.endMs > n ? t + h.outstanding : t), 0),
        requested: opts.segments.filter((s) => s.roomTypeId === typeId && on(s.startDate, s.endDate)).length,
      });
    }
    out.set(typeId, nights);
  }
  return out;
}

/**
 * The nights on which this request would oversell past a sell limit. Empty = within limits
 * (or no limit set on those nights). Only nights this request adds to are judged, so a
 * limit lowered below what is already sold never blocks an unrelated booking.
 */
export async function findSellLimitBreaches(opts: {
  propertyId: string;
  segments: AvailabilitySegment[];
  excludeReservationId?: string | null;
  excludeGroupBlockId?: string | null;
}): Promise<string[]> {
  const segments = opts.segments.filter((s) => s.endDate > s.startDate);
  if (segments.length === 0) return [];
  const windowStart = Math.min(...segments.map((s) => dayStartMs(s.startDate)));
  const windowEnd = Math.max(...segments.map((s) => dayStartMs(s.endDate)));

  const limits = await prisma.availabilitySellLimit.findMany({
    where: {
      propertyId: opts.propertyId,
      date: { gte: new Date(windowStart - DAY_MS), lt: new Date(windowEnd + DAY_MS) },
    },
  });
  if (limits.length === 0) return [];
  const limitFor = (typeId: string | null, night: number) =>
    limits.find((l) => (l.roomTypeId ?? null) === typeId && dayStartMs(l.date) === night);

  const types = await prisma.roomType.findMany({
    where: { propertyId: opts.propertyId, isPseudo: false },
    select: { id: true, name: true },
  });
  const realTypeIds = new Set(types.map((t) => t.id));
  const requestedTypeIds = new Set(segments.map((s) => s.roomTypeId).filter((t) => realTypeIds.has(t)));
  const houseLimited = limits.some((l) => l.roomTypeId === null);
  // Whole-house limits need every type's load; type limits only the requested types'.
  const loadTypes = houseLimited ? [...realTypeIds] : [...requestedTypeIds];
  const loads = await nightLoads({ ...opts, roomTypeIds: loadTypes, windowStart, windowEnd, segments });
  const nameOf = new Map(types.map((t) => [t.id, t.name]));

  const breaches: string[] = [];
  for (let n = windowStart; n < windowEnd; n += DAY_MS) {
    for (const typeId of requestedTypeIds) {
      const l = loads.get(typeId)?.get(n);
      if (!l || l.requested === 0) continue;
      const over = l.blocked + l.requested - l.capacity;
      const lim = limitFor(typeId, n);
      if (over > 0 && lim && over > lim.extraRooms) {
        breaches.push(`${nameOf.get(typeId) ?? "Room type"} on ${formatLocalDay(n)}: limit is ${lim.extraRooms} over capacity`);
      }
    }
    const house = limitFor(null, n);
    if (house) {
      let blocked = 0, requested = 0, capacity = 0;
      for (const t of loadTypes) {
        const l = loads.get(t)?.get(n);
        if (!l) continue;
        blocked += l.blocked;
        requested += l.requested;
        capacity += l.capacity;
      }
      const over = blocked + requested - capacity;
      if (requested > 0 && over > 0 && over > house.extraRooms) {
        breaches.push(`Whole house on ${formatLocalDay(n)}: limit is ${house.extraRooms} over capacity`);
      }
    }
  }
  return breaches;
}

/** The gate the desk paths call when an overbook was acknowledged. Null = may proceed. */
export async function sellLimitGate(
  ctx: AuthContext,
  opts: Parameters<typeof findSellLimitBreaches>[0]
): Promise<string | null> {
  const breaches = await findSellLimitBreaches(opts);
  if (breaches.length === 0) return null;
  if (hasCapability(ctx, "reservations.exceedSellLimit")) return null;
  return `Sell limit reached: ${breaches.join("; ")}. Only a manager can book past it.`;
}

/** Grid data: the limits in a window (roomTypeId null = the whole house). */
export async function sellLimitsInWindow(propertyId: string, from: Date, to: Date) {
  const rows = await prisma.availabilitySellLimit.findMany({
    where: { propertyId, date: { gte: from, lt: to } },
    select: { roomTypeId: true, date: true, extraRooms: true },
  });
  return rows.map((r) => ({ roomTypeId: r.roomTypeId, date: r.date.toISOString().slice(0, 10), extraRooms: r.extraRooms }));
}

/**
 * Set (or clear, with extraRooms null) a limit on each day of [from, to] for one room type
 * or the house. Needs "Edit sell limits" (default AVAILABILITY update).
 */
export async function setSellLimits(
  ctx: AuthContext,
  input: { propertyId: string; roomTypeId: string | null; from: Date; to: Date; extraRooms: number | null }
): Promise<number> {
  if (!hasCapability(ctx, "availability.sellLimits")) {
    throw new ForbiddenError("Your role does not allow this: Edit sell limits");
  }
  if (input.to < input.from) return 0;
  if ((input.to.getTime() - input.from.getTime()) / DAY_MS > 400) throw new ForbiddenError("Set limits for at most a year at a time");
  let n = 0;
  for (let d = input.from.getTime(); d <= input.to.getTime(); d += DAY_MS) {
    const date = new Date(d);
    const existing = await prisma.availabilitySellLimit.findFirst({
      where: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, date },
      select: { id: true },
    });
    if (input.extraRooms === null) {
      if (existing) await prisma.availabilitySellLimit.delete({ where: { id: existing.id } });
    } else if (existing) {
      await prisma.availabilitySellLimit.update({
        where: { id: existing.id },
        data: { extraRooms: input.extraRooms, updatedByUserId: ctx.userId },
      });
    } else {
      await prisma.availabilitySellLimit.create({
        data: { propertyId: input.propertyId, roomTypeId: input.roomTypeId, date, extraRooms: input.extraRooms, updatedByUserId: ctx.userId },
      });
    }
    n++;
  }
  return n;
}
