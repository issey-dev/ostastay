import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { applyRateAdjustment } from "@/lib/derived-rate";
import { INVENTORY_HOLDING_STATUSES, UNSELLABLE_ROOM_STATUSES } from "@/lib/availability";

const DAY_MS = 86_400_000;
// A booking-grid query is a stay quote, not a bulk-pricing job — cap the range well
// below the Price Calendar's 10-year write ceiling.
const MAX_QUERY_NIGHTS = 365;

const dayStartMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// One round-trip powering the booking dialog's Look-to-Book grid: for the requested
// stay window it returns, per room type, the minimum sellable-room count across every
// night (OPERA's "minimum stay availability"), and per rate plan × room type the total
// and average nightly price. Pricing mirrors Night Audit's resolution chain EXACTLY
// (see night-audit/run/route.ts) so the quoted price can never disagree with what
// actually posts: derived plan → parent's calendar entry + adjustment; no entry →
// locked Base plan's entry; extra-occupancy surcharges from the assigned/parent plan's
// own entry only (never the Base fallback's), adults beyond baseOccupancy plus every
// child. The one deliberate difference: where Night Audit coerces a fully-unpriced
// night to $0 and posts anyway, the grid reports unpriced nights so staff see "No
// rate" instead of a misleading $0 quote.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");
    const adults = Math.max(1, parseInt(searchParams.get("adults") ?? "1") || 1);
    const children = Math.max(0, parseInt(searchParams.get("children") ?? "0") || 0);
    // When quoting for an EDIT, the reservation's own room-holds must not count
    // against availability — otherwise a guest's own room shows "Sold out" to them.
    const excludeReservationId = searchParams.get("excludeReservationId");

    if (!propertyId || !startDateStr || !endDateStr) {
      return NextResponse.json({ error: "propertyId, startDate and endDate are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
    }
    const windowStart = dayStartMs(start);
    const windowEnd = dayStartMs(end);
    const nights = Math.round((windowEnd - windowStart) / DAY_MS);
    if (nights < 1) {
      return NextResponse.json({ error: "Check-out must be after check-in" }, { status: 400 });
    }
    if (nights > MAX_QUERY_NIGHTS) {
      return NextResponse.json({ error: `Stay too long to quote (max ${MAX_QUERY_NIGHTS} nights)` }, { status: 400 });
    }

    const [roomTypes, ratePlans, assignments, calendarRows, roomCounts] = await Promise.all([
      prisma.roomType.findMany({
        where: { propertyId, isActive: true },
        select: { id: true, code: true, name: true, baseOccupancy: true, maxOccupancy: true, isPseudo: true },
        orderBy: { name: "asc" },
      }),
      prisma.ratePlan.findMany({
        where: { propertyId },
        include: { agentAccess: { select: { upid: true } } },
        orderBy: { priority: "asc" },
      }),
      prisma.roomAssignment.findMany({
        where: {
          startDate: { lt: new Date(windowEnd) },
          endDate: { gt: new Date(windowStart) },
          ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}),
          reservation: { propertyId, status: { in: INVENTORY_HOLDING_STATUSES } },
        },
        select: { roomTypeId: true, startDate: true, endDate: true },
      }),
      prisma.priceCalendar.findMany({
        where: {
          date: { gte: new Date(windowStart), lt: new Date(windowEnd) },
          ratePlan: { propertyId },
        },
        select: { ratePlanId: true, roomTypeId: true, date: true, price: true, extraAdultPrice: true, extraChildPrice: true },
      }),
      prisma.room.groupBy({
        by: ["roomTypeId"],
        where: { propertyId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
        _count: { _all: true },
      }),
    ]);

    const capacityByType = new Map(roomCounts.map((r) => [r.roomTypeId, r._count._all]));
    const basePlan = ratePlans.find((rp) => rp.isLocked) ?? null;

    // (ratePlanId, roomTypeId, nightMs) -> calendar row, from the single bulk fetch.
    const calKey = (planId: string, typeId: string, nightMs: number) => `${planId}|${typeId}|${nightMs}`;
    const calendar = new Map<string, { price: number; extraAdultPrice: number | null; extraChildPrice: number | null }>();
    for (const row of calendarRows) {
      calendar.set(calKey(row.ratePlanId, row.roomTypeId, dayStartMs(row.date)), {
        price: row.price,
        extraAdultPrice: row.extraAdultPrice,
        extraChildPrice: row.extraChildPrice,
      });
    }

    // Availability: min sellable rooms remaining across every night of the window.
    const availability = roomTypes.map((rt) => {
      if (rt.isPseudo) {
        // Pseudo types are non-physical buckets exempt from the overbooking guard.
        return { roomTypeId: rt.id, capacity: null as number | null, minAvailable: null as number | null, soldOutNights: [] as string[] };
      }
      const capacity = capacityByType.get(rt.id) ?? 0;
      const typeAssignments = assignments.filter((a) => a.roomTypeId === rt.id);
      let minAvailable = capacity;
      const soldOutNights: string[] = [];
      for (let night = windowStart; night < windowEnd; night += DAY_MS) {
        const booked = typeAssignments.filter(
          (a) => dayStartMs(a.startDate) <= night && dayStartMs(a.endDate) > night
        ).length;
        const remaining = capacity - booked;
        if (remaining < minAvailable) minAvailable = remaining;
        if (remaining <= 0) soldOutNights.push(new Date(night).toISOString().slice(0, 10));
      }
      return { roomTypeId: rt.id, capacity, minAvailable: Math.max(0, minAvailable), soldOutNights };
    });
    const availabilityByType = new Map(availability.map((a) => [a.roomTypeId, a]));

    const round2 = (n: number) => Math.round(n * 100) / 100;

    // grid[ratePlanId][roomTypeId] — null when not a single night resolved a price.
    const grid: Record<string, Record<string, {
      total: number;
      avgNightly: number;
      pricedNights: number;
      unpricedNights: number;
      extraOccupancyTotal: number;
    } | null>> = {};

    for (const rp of ratePlans) {
      const isDerived = !!rp.parentRatePlanId;
      const calendarPlanId = isDerived ? rp.parentRatePlanId! : rp.id;
      grid[rp.id] = {};
      for (const rt of roomTypes) {
        let total = 0;
        let extraOccupancyTotal = 0;
        let pricedNights = 0;
        const extraAdults = Math.max(0, adults - rt.baseOccupancy);
        for (let night = windowStart; night < windowEnd; night += DAY_MS) {
          const entry = calendar.get(calKey(calendarPlanId, rt.id, night));
          let baseRoomPrice = entry?.price;
          if (baseRoomPrice == null && basePlan && calendarPlanId !== basePlan.id) {
            baseRoomPrice = calendar.get(calKey(basePlan.id, rt.id, night))?.price;
          }
          if (baseRoomPrice != null) {
            if (isDerived) {
              baseRoomPrice = applyRateAdjustment(baseRoomPrice, rp.derivedAdjustmentType!, rp.derivedAdjustmentValue!);
            }
            total += baseRoomPrice;
            pricedNights += 1;
          }
          extraOccupancyTotal += extraAdults * (entry?.extraAdultPrice ?? 0) + children * (entry?.extraChildPrice ?? 0);
        }
        grid[rp.id][rt.id] = pricedNights === 0
          ? null
          : {
              total: round2(total),
              avgNightly: round2(total / pricedNights),
              pricedNights,
              unpricedNights: nights - pricedNights,
              extraOccupancyTotal: round2(extraOccupancyTotal),
            };
      }
    }

    return NextResponse.json({
      nights,
      roomTypes: roomTypes.map((rt) => ({
        id: rt.id,
        code: rt.code,
        name: rt.name,
        baseOccupancy: rt.baseOccupancy,
        maxOccupancy: rt.maxOccupancy,
        isPseudo: rt.isPseudo,
        ...availabilityByType.get(rt.id)!,
      })),
      ratePlans: ratePlans.map((rp) => ({
        id: rp.id,
        code: rp.code,
        name: rp.name,
        priority: rp.priority,
        isLocked: rp.isLocked,
        isNegotiated: rp.isNegotiated,
        isComplimentary: rp.isComplimentary,
        isHouseUse: rp.isHouseUse,
        parentRatePlanId: rp.parentRatePlanId,
        negotiatedForProfileIds: rp.agentAccess.map((a) => a.upid),
      })),
      grid,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
