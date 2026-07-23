import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { addMinutesToTime, rateForDate, computeAppointmentTotal } from "@/lib/spa";
import { isSlotFeasible } from "@/lib/spa-availability";

// Server-computed bookable time slots for a treatment on a given date — the booking
// screen's slot picker calls this, and POST /api/spa/appointments re-runs the exact
// same feasibility check at save time (SPA_PLAN.md §7: "never trust a client-cached
// slot list"). Also returns the effective price for the date so the UI can show it
// before the guest confirms, without a second round trip.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const treatmentId = searchParams.get("treatmentId");
    const dateParam = searchParams.get("date");
    const partySize = parseInt(searchParams.get("partySize") ?? "1");

    if (!propertyId || !treatmentId || !dateParam) {
      return NextResponse.json({ error: "propertyId, treatmentId, and date are required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    const treatment = await prisma.spaTreatment.findUnique({
      where: { id: treatmentId },
      include: { rates: true, property: { select: { defaultCurrency: true } } },
    });
    if (!treatment || treatment.propertyId !== propertyId) {
      return NextResponse.json({ error: "Treatment not found at this property" }, { status: 404 });
    }
    if (!treatment.isActive) {
      return NextResponse.json({ error: "This treatment is not currently active" }, { status: 400 });
    }
    if (isNaN(partySize) || partySize < 1 || partySize > treatment.maxParticipants) {
      return NextResponse.json({ error: `partySize must be between 1 and ${treatment.maxParticipants} for this treatment` }, { status: 400 });
    }

    const date = new Date(dateParam);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });
    const openingTime = settings?.defaultOpeningTime ?? "09:00";
    const closingTime = settings?.defaultClosingTime ?? "18:00";
    const slotIntervalMinutes = settings?.slotIntervalMinutes ?? 15;

    const rate = rateForDate(treatment.rates, date);
    const price = rate ? computeAppointmentTotal(rate, treatment.pricingMode, partySize) : null;

    const slots: { startTime: string; available: boolean }[] = [];
    let cursor = openingTime;
    while (cursor < closingTime) {
      const treatmentEndTime = addMinutesToTime(cursor, treatment.defaultDurationMinutes);
      const blockedUntilTime = addMinutesToTime(treatmentEndTime, treatment.cleanupBufferMinutes);
      const blockedFromTime = addMinutesToTime(cursor, -treatment.preparationBufferMinutes);

      if (blockedUntilTime > closingTime) break; // wouldn't fit before closing

      const available = await isSlotFeasible({
        propertyId,
        treatmentId,
        partySize,
        date,
        blockedFromTime,
        blockedUntilTime,
      });
      slots.push({ startTime: cursor, available });
      cursor = addMinutesToTime(cursor, slotIntervalMinutes);
    }

    return NextResponse.json({
      slots,
      price,
      currency: treatment.property.defaultCurrency,
      durationMinutes: treatment.defaultDurationMinutes,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
