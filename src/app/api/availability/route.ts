import { NextResponse } from "next/server";
import { expireOptionsSoon } from "@/lib/reservations/options";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import {
  INVENTORY_HOLDING_STATUSES,
  UNSELLABLE_ROOM_STATUSES,
  outstandingBlockHolds,
} from "@/lib/availability";
import { getClosedDates } from "@/lib/restrictions";
import { sellLimitsInWindow } from "@/lib/availability-sell-limit";
import { overflowCountsByNight } from "@/lib/reservations/overflow";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";

const DAY_MS = 86_400_000;
const MAX_DAYS = 60;

// Property availability grid: for a date window, per room type (and a House total),
// the count of available rooms plus the expandable metrics (Arrivals / Occupancy /
// Departures / Adults / Children / Infants) and Stop-Sale closed flags. Each column
// represents the NIGHT of that date (who is in-house that night). Read-only.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "AVAILABILITY", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);
    await expireOptionsSoon(propertyId);

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { businessDate: true },
    });

    const startParam = searchParams.get("startDate");
    const start = startParam ? toUtcMidnight(new Date(startParam)) : resolveBusinessDate(property ?? {});
    if (isNaN(start.getTime())) {
      return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
    }
    const days = Math.min(MAX_DAYS, Math.max(1, parseInt(searchParams.get("days") ?? "14", 10) || 14));

    const windowStart = start.getTime();
    const windowEnd = windowStart + days * DAY_MS;
    const dateMsList = Array.from({ length: days }, (_, i) => windowStart + i * DAY_MS);

    // Real, sellable room types only (pseudo/overbooking buckets have no physical rooms).
    const roomTypes = await prisma.roomType.findMany({
      where: { propertyId, isPseudo: false },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
    const typeIds = roomTypes.map((t) => t.id);

    // Capacity per type = sellable physical rooms (excludes OOO/OOS).
    const roomRows = await prisma.room.groupBy({
      by: ["roomTypeId"],
      where: { propertyId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
      _count: { _all: true },
    });
    const capacityByType = new Map<string, number>(
      roomRows.map((r) => [r.roomTypeId, r._count._all])
    );

    // Every inventory-holding assignment overlapping the window, with its reservation's
    // occupancy counts. One query drives occupancy, arrivals, departures, and pax.
    const assignments = await prisma.roomAssignment.findMany({
      where: {
        roomTypeId: { in: typeIds },
        startDate: { lt: new Date(windowEnd) },
        endDate: { gt: new Date(windowStart) },
        reservation: { propertyId, status: { in: INVENTORY_HOLDING_STATUSES } },
      },
      select: {
        roomTypeId: true,
        startDate: true,
        endDate: true,
        reservation: { select: { adults: true, children: true, infants: true, status: true } },
      },
    });

    // Outstanding group-block holds per type — only DEFINITE blocks count against
    // availability here (a tentative block is not a firm hold on this grid).
    const holdsByType = new Map<string, { startMs: number; endMs: number; outstanding: number }[]>();
    await Promise.all(
      typeIds.map(async (id) => {
        holdsByType.set(
          id,
          await outstandingBlockHolds({
            propertyId,
            roomTypeId: id,
            windowStart,
            windowEnd,
            blockStatusIn: ["DEFINITE"],
          })
        );
      })
    );

    // Agent Portal plan Phase 2: the option forecast. "Allotted" = rooms still held in
    // TENTATIVE blocks (not counted against availability on this grid, as before), shown so
    // "0 free" can be read as "may loosen". "On option" (per cell below) = tentative bookings.
    const allottedByType = new Map<string, { startMs: number; endMs: number; outstanding: number }[]>();
    await Promise.all(
      typeIds.map(async (id) => {
        allottedByType.set(
          id,
          await outstandingBlockHolds({ propertyId, roomTypeId: id, windowStart, windowEnd, blockStatusIn: ["TENTATIVE"] })
        );
      })
    );
    const sellLimits = await sellLimitsInWindow(propertyId, new Date(windowStart), new Date(windowEnd));
    const limitOf = (typeId: string | null, night: number) =>
      sellLimits.find((l) => l.roomTypeId === typeId && l.date === new Date(night).toISOString().slice(0, 10))?.extraRooms ?? null;
    const overflowByNight = await overflowCountsByNight(propertyId, new Date(windowStart), new Date(windowEnd));

    const { propertyLevel: propertyClosed, byRoomType: typeClosed } = await getClosedDates({
      propertyId,
      windowStart,
      windowEnd,
      roomTypeIds: typeIds,
    });

    const dayStartMs = (d: Date) => toUtcMidnight(d).getTime();

    type Cell = {
      available: number;
      occupancy: number;
      arrivals: number;
      departures: number;
      adults: number;
      children: number;
      infants: number;
      groupBlocks: number;
      closed: boolean;
      /** Tentative bookings in house that night (counted in occupancy too). */
      onOption: number;
      /** Rooms still held in TENTATIVE blocks (not deducted from `available` here). */
      allotted: number;
      /** Sell limit for the night (extra rooms past capacity), null = none set. */
      sellLimit: number | null;
      /** Sold past capacity. */
      oversold: boolean;
    };

    // Per-type rows.
    const rows = roomTypes.map((type) => {
      const capacity = capacityByType.get(type.id) ?? 0;
      const typeAssignments = assignments.filter((a) => a.roomTypeId === type.id);
      const holds = holdsByType.get(type.id) ?? [];
      const closedSet = typeClosed.get(type.id);

      const cells: Cell[] = dateMsList.map((night) => {
        let occupancy = 0;
        let onOption = 0;
        let adults = 0;
        let children = 0;
        let infants = 0;
        let arrivals = 0;
        let departures = 0;
        for (const a of typeAssignments) {
          const s = dayStartMs(a.startDate);
          const e = dayStartMs(a.endDate);
          if (s <= night && e > night) {
            occupancy += 1;
            if (a.reservation.status === "TENTATIVE") onOption += 1;
            adults += a.reservation.adults;
            children += a.reservation.children;
            infants += a.reservation.infants;
          }
          if (s === night) arrivals += 1;
          if (e === night) departures += 1;
        }
        const held = holds.reduce(
          (sum, h) => (h.startMs <= night && h.endMs > night ? sum + h.outstanding : sum),
          0
        );
        const allotted = (allottedByType.get(type.id) ?? []).reduce(
          (sum, h) => (h.startMs <= night && h.endMs > night ? sum + h.outstanding : sum),
          0
        );
        return {
          available: capacity - occupancy - held,
          onOption,
          allotted,
          sellLimit: limitOf(type.id, night),
          oversold: capacity - occupancy - held < 0,
          occupancy,
          arrivals,
          departures,
          adults,
          children,
          infants,
          groupBlocks: held,
          closed: propertyClosed.has(night) || (closedSet?.has(night) ?? false),
        };
      });
      return { roomTypeId: type.id, cells };
    });

    // House total = column-wise sum across types; House capacity = all sellable rooms.
    const houseCapacity = [...capacityByType.values()].reduce((a, b) => a + b, 0);
    const houseCells: Cell[] = dateMsList.map((night, i) => {
      const agg = rows.reduce(
        (acc, r) => {
          const c = r.cells[i];
          acc.occupancy += c.occupancy;
          acc.arrivals += c.arrivals;
          acc.departures += c.departures;
          acc.adults += c.adults;
          acc.children += c.children;
          acc.infants += c.infants;
          acc.onOption += c.onOption;
          acc.allotted += c.allotted;
          return acc;
        },
        { occupancy: 0, arrivals: 0, departures: 0, adults: 0, children: 0, infants: 0, onOption: 0, allotted: 0 }
      );
      const heldTotal = typeIds.reduce((sum, id) => {
        const holds = holdsByType.get(id) ?? [];
        return sum + holds.reduce((s, h) => (h.startMs <= night && h.endMs > night ? s + h.outstanding : s), 0);
      }, 0);
      return {
        ...agg,
        available: houseCapacity - agg.occupancy - heldTotal,
        sellLimit: limitOf(null, night),
        oversold: houseCapacity - agg.occupancy - heldTotal < 0,
        groupBlocks: heldTotal,
        closed: propertyClosed.has(night),
      };
    });

    return NextResponse.json({
      startDate: start.toISOString(),
      days,
      dates: dateMsList.map((ms) => new Date(ms).toISOString()),
      roomTypes: roomTypes.map((t) => ({ ...t, capacity: capacityByType.get(t.id) ?? 0 })),
      house: { capacity: houseCapacity, cells: houseCells },
      // Overflow bookings (partner hotel) per night — the Overflow line under the house.
      overflow: dateMsList.map((night) => overflowByNight.get(night) ?? 0),
      rows,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
