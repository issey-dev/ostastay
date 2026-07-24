import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { resolveChargeTax } from "@/lib/tax-calc";
import { logActivity } from "@/lib/activity-log";

// Advance Bill — post the remaining stay (or a chosen number of its nights) UPFRONT so the
// guest can settle before checkout. The charges (Rate + Extra Occupancy + Allocations +
// Green Tax + any uncharged Transport) are computed by the same quote engine Night Audit
// and the Proforma use, but posted as folio lines dated TODAY — revenue is recognized on
// the settlement date, not spread across the future nights. `advanceBilledThrough` is set
// to the last billed night so Night Audit skips re-posting those nights (no double-charge).
const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number) => new Date(toUtcMidnight(d).getTime() + n * DAY_MS);
const diffNights = (a: Date, b: Date) => Math.round((toUtcMidnight(b).getTime() - toUtcMidnight(a).getTime()) / DAY_MS);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const requestedNights = Math.floor(Number(body?.nights));

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: { select: { businessDate: true, enterpriseId: true, pricesIncludeTaxes: true } },
        assignments: { orderBy: { startDate: "asc" }, include: { ratePlan: { include: { chargeCode: true } } } },
        folios: { where: { isClosed: false }, orderBy: { folioNumber: "asc" } },
        transports: true,
        allocations: { where: { source: "MANUAL" }, select: { allocationId: true } },
      },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Advance billing is available only for an in-house guest." }, { status: 400 });
    }
    const folio = reservation.folios[0];
    if (!folio) {
      return NextResponse.json({ error: "This reservation has no open folio to post to." }, { status: 400 });
    }

    // The first night not yet posted: past nights were posted by Night Audit; already-
    // advance-billed nights end at advanceBilledThrough.
    const businessDate = toUtcMidnight(resolveBusinessDate(reservation.property));
    const checkOut = toUtcMidnight(reservation.checkOutDate);
    const billedThrough = reservation.advanceBilledThrough ? toUtcMidnight(reservation.advanceBilledThrough) : null;
    const firstUnbilled = billedThrough && addDays(billedThrough, 1).getTime() > businessDate.getTime()
      ? addDays(billedThrough, 1)
      : businessDate;
    const remainingNights = diffNights(firstUnbilled, checkOut);
    if (remainingNights <= 0) {
      return NextResponse.json({ error: "There are no un-billed nights left to advance-bill." }, { status: 400 });
    }

    // Default to the whole remaining stay; a valid smaller request caps the range.
    const nights = Number.isFinite(requestedNights) && requestedNights > 0
      ? Math.min(requestedNights, remainingNights)
      : remainingNights;
    const rangeStart = firstUnbilled;
    const rangeEnd = addDays(firstUnbilled, nights); // exclusive
    const lastNight = addDays(rangeEnd, -1);

    // Clip each assignment to the selected night window (handles split stays).
    const truncated = reservation.assignments
      .map((a) => {
        const s = toUtcMidnight(a.startDate);
        const e = toUtcMidnight(a.endDate);
        const start = s.getTime() > rangeStart.getTime() ? s : rangeStart;
        const end = e.getTime() < rangeEnd.getTime() ? e : rangeEnd;
        return { a, start, end };
      })
      .filter((x) => diffNights(x.start, x.end) > 0);
    if (truncated.length === 0) {
      return NextResponse.json({ error: "No room nights fall in the selected range." }, { status: 400 });
    }

    // Charge-code resolution mirrors Night Audit: per-plan accommodation code → enterprise
    // default → legacy ROOM; Green Tax via the enterprise's GTX code.
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: reservation.property.enterpriseId } });
    const fallbackRoom = settings?.defaultAccommodationChargeCodeId
      ? await prisma.chargeCode.findFirst({ where: { id: settings.defaultAccommodationChargeCodeId, enterpriseId: reservation.property.enterpriseId } })
      : await prisma.chargeCode.findFirst({ where: { enterpriseId: reservation.property.enterpriseId, code: "ROOM" } });
    if (!fallbackRoom) {
      return NextResponse.json({ error: "No accommodation charge code configured. Set a default in Controls > Finance." }, { status: 400 });
    }
    const gtxCode = await prisma.chargeCode.findFirst({ where: { enterpriseId: reservation.property.enterpriseId, code: "GTX" } });

    const quote = await computeReservationQuote({
      propertyId: reservation.propertyId,
      assignments: truncated.map(({ a, start, end }) => ({
        roomTypeId: a.roomTypeId,
        ratePlanId: a.ratePlanId,
        startDate: start,
        endDate: end,
        overrideRate: a.overrideRate,
      })),
      adults: reservation.adults,
      children: reservation.children,
      mealPlanCode: reservation.mealPlan,
      manualAllocationIds: reservation.allocations.map((m) => m.allocationId),
    });

    // Allocation charge codes by allocationId (the quote returns codes, not ids).
    const allocCodeMap = new Map<string, string>();
    if (quote.allocations.length > 0) {
      const allocs = await prisma.allocation.findMany({
        where: { id: { in: quote.allocations.map((al) => al.allocationId) } },
        select: { id: true, chargeCodeId: true },
      });
      allocs.forEach((al) => { if (al.chargeCodeId) allocCodeMap.set(al.id, al.chargeCodeId); });
    }

    const roomCodeForSeg = (roomTypeId: string, ratePlanId: string) => {
      const asg = reservation.assignments.find((a) => a.roomTypeId === roomTypeId && a.ratePlanId === ratePlanId);
      return asg?.ratePlan?.chargeCode?.id ?? fallbackRoom.id;
    };

    let linesPosted = 0;
    let amountPosted = 0;
    await prisma.$transaction(async (tx) => {
      for (const seg of quote.segments) {
        const codeId = roomCodeForSeg(seg.roomTypeId, seg.ratePlanId);
        if (seg.roomBase > 0.005 || seg.roomTax > 0.005 || seg.roomServiceCharge > 0.005) {
          await tx.folioLineItem.create({
            data: {
              folioId: folio.id, chargeCodeId: codeId,
              amount: seg.roomBase, taxAmount: seg.roomTax, serviceChargeAmount: seg.roomServiceCharge,
              description: `Advance — Accommodation (${seg.nights} night${seg.nights === 1 ? "" : "s"})`,
              date: businessDate,
            },
          });
          amountPosted += seg.roomBase + seg.roomTax + seg.roomServiceCharge; linesPosted++;
        }
        if (seg.extraOccupancyBase > 0.005) {
          await tx.folioLineItem.create({
            data: {
              folioId: folio.id, chargeCodeId: codeId,
              amount: seg.extraOccupancyBase, taxAmount: seg.extraOccupancyTax, serviceChargeAmount: seg.extraOccupancyServiceCharge,
              description: "Advance — Extra Occupancy", date: businessDate,
            },
          });
          amountPosted += seg.extraOccupancyBase + seg.extraOccupancyTax + seg.extraOccupancyServiceCharge; linesPosted++;
        }
      }

      for (const al of quote.allocations) {
        const codeId = allocCodeMap.get(al.allocationId);
        if (!codeId || (al.base <= 0.005 && al.tax <= 0.005 && al.serviceCharge <= 0.005)) continue;
        await tx.folioLineItem.create({
          data: {
            folioId: folio.id, chargeCodeId: codeId,
            amount: al.base, taxAmount: al.tax, serviceChargeAmount: al.serviceCharge,
            description: `Advance — ${al.name}`, date: businessDate,
          },
        });
        amountPosted += al.base + al.tax + al.serviceCharge; linesPosted++;
      }

      if (quote.greenTax.enabled && quote.greenTax.total > 0.005 && gtxCode) {
        await tx.folioLineItem.create({
          data: {
            folioId: folio.id, chargeCodeId: gtxCode.id,
            amount: quote.greenTax.total, taxAmount: 0, serviceChargeAmount: 0,
            description: "Advance — Green Tax", date: businessDate,
          },
        });
        amountPosted += quote.greenTax.total; linesPosted++;
      }

      // Uncharged, hotel-booked transport legs — posted here and flagged charged so Night
      // Audit's transport pass (chargedLineItemId: null) never double-charges them.
      const legs = reservation.transports.filter(
        (t) => t.chargeToGuest && t.chargeAmount != null && t.chargeAmount > 0 && t.chargeCodeId && !t.chargedLineItemId
      );
      if (legs.length > 0) {
        const codeIds = [...new Set(legs.map((l) => l.chargeCodeId!).filter(Boolean))];
        const codes = await tx.chargeCode.findMany({
          where: { id: { in: codeIds }, enterpriseId: reservation.property.enterpriseId },
          include: { taxProfile: { include: { rates: true } } },
        });
        const cmap = new Map(codes.map((c) => [c.id, c]));
        for (const leg of legs) {
          const code = cmap.get(leg.chargeCodeId!);
          if (!code) continue;
          const t = resolveChargeTax({ chargeCode: code, inputAmount: leg.chargeAmount!, settings, pricesIncludeTaxes: reservation.property.pricesIncludeTaxes });
          const dir = leg.direction === "PICKUP" ? "Pickup" : "Dropoff";
          const li = await tx.folioLineItem.create({
            data: {
              folioId: folio.id, chargeCodeId: code.id,
              amount: t.baseAmount, taxAmount: t.taxAmount, serviceChargeAmount: t.serviceChargeAmount,
              description: `Advance — Transport (${dir})`, date: businessDate,
            },
          });
          await tx.reservationTransport.update({ where: { id: leg.id }, data: { chargedLineItemId: li.id } });
          amountPosted += t.baseAmount + t.taxAmount + t.serviceChargeAmount; linesPosted++;
        }
      }

      // Mark the nights billed so Night Audit skips them.
      await tx.reservation.update({ where: { id }, data: { advanceBilledThrough: lastNight } });

      const user = await tx.user.findUnique({ where: { id: ctx.userId } });
      await tx.reservationTrace.create({
        data: {
          reservationId: id, traceType: "FRONT_DESK",
          description: `Advance bill by ${user ? `${user.firstName} ${user.lastName}` : ctx.userId} — ${nights} night(s), $${amountPosted.toFixed(2)} posted upfront (billed through ${lastNight.toISOString().slice(0, 10)}).`,
          actionDate: new Date(), isResolved: true,
        },
      });
    });

    await logActivity({
      ctx, module: "CASHIERING", action: "ADVANCE_BILL", entityType: "Reservation", entityId: id,
      description: `Advance bill for ${reservation.confirmationNo}: ${nights} night(s), $${amountPosted.toFixed(2)} posted`,
    });

    return NextResponse.json({
      success: true,
      nights,
      remainingNights,
      linesPosted,
      amountPosted: Math.round(amountPosted * 100) / 100,
      advanceBilledThrough: lastNight.toISOString().slice(0, 10),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
