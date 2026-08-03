import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { resolveChargeTax } from "@/lib/tax-calc";

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Day-by-day projected breakdown for the reservation "Daily Details" modal: Rate, Room
// Type, Room, Pax, Room Charge, Allocation, Other (transport), Taxes, Total per night.
// Reuses computeReservationQuote so it can't diverge from Night Audit, and folds in any
// hotel-booked transport charge on its realization date. Also returns a categorised
// summary (Room · Allocation · Other · Taxes) for the info drill-down. It's a projection
// of planned charges, independent of what has actually been posted yet.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: true,
        assignments: { orderBy: { startDate: "asc" }, include: { roomType: true, room: true, ratePlan: true } },
        allocations: true,
        transports: true,
      },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.assignments.length === 0) {
      return NextResponse.json({ days: [], nights: 0, totals: null, summary: null, warnings: ["No room segments on this reservation."] });
    }

    const manualAllocationIds = reservation.allocations
      .filter((a) => a.source === "MANUAL")
      .map((a) => a.allocationId);

    const quote = await computeReservationQuote({
      propertyId: reservation.propertyId,
      assignments: reservation.assignments.map((a) => ({
        roomTypeId: a.roomTypeId,
        chargeRoomTypeId: a.chargeRoomTypeId,
        ratePlanId: a.ratePlanId,
        startDate: a.startDate,
        endDate: a.endDate,
        overrideRate: a.overrideRate,
      })),
      adults: reservation.adults,
      children: reservation.children,
      mealPlanCode: reservation.mealPlan,
      manualAllocationIds,
    });

    // Attach room / room-type / rate-plan via the assignment INDEX the quote reports for
    // each night (timezone-proof — no date arithmetic), and seed an `other` bucket.
    const days = quote.days.map((d) => {
      const a = d.assignmentIndex != null ? reservation.assignments[d.assignmentIndex] : undefined;
      return {
        ...d,
        otherCharge: 0,
        roomTypeName: a?.roomType?.name ?? null,
        roomNumber: a?.room?.roomNumber ?? null,
        ratePlanCode: a?.ratePlan?.code ?? null,
        ratePlanName: a?.ratePlan?.name ?? null,
      };
    });
    const dayByDate = new Map(days.map((d) => [d.date, d]));

    // ── Fold in hotel-booked transport charges on their realization date ────────────
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: reservation.property.enterpriseId } });
    const pricesIncludeTaxes = reservation.property.pricesIncludeTaxes;

    const chargeableLegs = reservation.transports.filter(
      (t) => t.chargeToGuest && t.chargeAmount != null && t.chargeAmount > 0 && t.chargeCodeId
    );
    const legChargeCodeIds = [...new Set(chargeableLegs.map((t) => t.chargeCodeId!).filter(Boolean))];
    const legChargeCodes = legChargeCodeIds.length
      ? await prisma.chargeCode.findMany({
          where: { id: { in: legChargeCodeIds }, enterpriseId: reservation.property.enterpriseId },
          include: { taxProfile: { include: { rates: true } } },
        })
      : [];
    const legCodeMap = new Map(legChargeCodes.map((c) => [c.id, c]));

    const otherLines: { name: string; amount: number }[] = [];
    const taxLineMap = new Map<string, number>();
    for (const l of quote.taxLines) taxLineMap.set(l.name, round2(l.amount));
    let transportBaseTotal = 0;
    let transportTaxTotal = 0;

    for (const leg of chargeableLegs) {
      const code = legCodeMap.get(leg.chargeCodeId!);
      if (!code) continue;
      const t = resolveChargeTax({ chargeCode: code, inputAmount: leg.chargeAmount!, settings, pricesIncludeTaxes });
      const dir = leg.direction === "PICKUP" ? "Pickup" : "Dropoff";
      const realizeDate = leg.transportTime ?? leg.carrierTime ?? (leg.direction === "PICKUP" ? reservation.checkInDate : reservation.checkOutDate);
      const dateStr = localDateStr(new Date(realizeDate));
      const taxes = round2(t.taxAmount + t.serviceChargeAmount);

      transportBaseTotal = round2(transportBaseTotal + t.baseAmount);
      transportTaxTotal = round2(transportTaxTotal + taxes);
      otherLines.push({ name: `Transport – ${dir}${leg.transportType ? ` (${leg.transportType})` : ""}`, amount: round2(t.baseAmount) });
      for (const bl of t.breakdown) taxLineMap.set(bl.name, round2((taxLineMap.get(bl.name) ?? 0) + bl.amount));

      const day = dayByDate.get(dateStr);
      if (day) {
        day.otherCharge = round2(day.otherCharge + t.baseAmount);
        day.taxes = round2(day.taxes + taxes);
        day.total = round2(day.total + t.baseAmount + taxes);
      } else {
        // Transport falls on a date with no room night (e.g. departure day) — show it as
        // its own row so the charge is never hidden.
        days.push({
          date: dateStr,
          assignmentIndex: null,
          roomTypeId: null,
          ratePlanId: null,
          rate: 0,
          adults: reservation.adults,
          children: reservation.children,
          roomCharge: 0,
          allocationCharge: 0,
          otherCharge: round2(t.baseAmount),
          taxes,
          total: round2(t.baseAmount + taxes),
          // No room night here — the transport charge itself is carried in otherCharge
          // above, which the proforma projects separately from its own transport pass.
          parts: { room: { base: 0, tax: 0, serviceCharge: 0 }, greenTax: 0, allocations: [] },
          roomTypeName: null,
          roomNumber: null,
          ratePlanCode: null,
          ratePlanName: null,
        });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    // ── Categorised summary for the info drill-down ─────────────────────────────────
    const roomLines = [
      { name: "Room Charge", amount: round2(quote.totals.roomBase) },
      ...(quote.totals.extraOccupancyBase > 0 ? [{ name: "Extra Occupancy", amount: round2(quote.totals.extraOccupancyBase) }] : []),
    ].filter((l) => l.amount !== 0);
    const allocationLines = quote.allocations.map((a) => ({ name: `${a.code} — ${a.name}`, amount: round2(a.base) }));
    const taxLines = [...taxLineMap.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).filter((l) => l.amount !== 0);
    if (quote.greenTax.total > 0) taxLines.push({ name: "Green Tax", amount: round2(quote.greenTax.total) });

    const roomTotal = round2(quote.totals.roomBase + quote.totals.extraOccupancyBase);
    const allocationTotal = round2(quote.totals.allocationsBase);
    const otherTotal = transportBaseTotal;
    const taxesTotal = round2(quote.totals.taxTotal + quote.totals.greenTaxTotal + transportTaxTotal);
    const grandTotal = round2(roomTotal + allocationTotal + otherTotal + taxesTotal);

    return NextResponse.json({
      days,
      nights: quote.nights,
      pricesIncludeTaxes,
      totals: {
        roomBase: quote.totals.roomBase,
        extraOccupancyBase: quote.totals.extraOccupancyBase,
        allocationsBase: quote.totals.allocationsBase,
        otherBase: otherTotal,
        taxTotal: taxesTotal,
        greenTaxTotal: quote.totals.greenTaxTotal,
        grandTotal,
      },
      summary: {
        room: { total: roomTotal, lines: roomLines },
        allocation: { total: allocationTotal, lines: allocationLines },
        other: { total: otherTotal, lines: otherLines },
        taxes: { total: taxesTotal, lines: taxLines },
        grandTotal,
      },
      warnings: quote.warnings,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
