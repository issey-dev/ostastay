import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { addMinutesToTime, rateForDate, computeAppointmentTotal } from "@/lib/spa";
import { isSlotFeasible, type TherapistRequirement } from "@/lib/spa-availability";
import type { SpaTreatment, SpaSettings } from "@prisma/client";

// Shared by both response modes below — every bookable start time on ONE calendar day,
// each checked against the exact same per-participant requirements the booking route
// will re-validate at save time (never trust a cached slot list, same rule as
// Excursions). `requirements.length` IS the party size; a mismatch with the `partySize`
// query param is rejected by the caller before this runs.
async function computeSlotsForDay(params: {
  propertyId: string;
  treatmentId: string;
  date: Date;
  treatment: Pick<SpaTreatment, "defaultDurationMinutes" | "cleanupBufferMinutes" | "preparationBufferMinutes">;
  settings: Pick<SpaSettings, "defaultOpeningTime" | "defaultClosingTime" | "slotIntervalMinutes"> | null;
  partySize: number;
  requirements?: TherapistRequirement[];
}): Promise<{ startTime: string; available: boolean }[]> {
  const { propertyId, treatmentId, date, treatment, settings, partySize, requirements } = params;
  const openingTime = settings?.defaultOpeningTime ?? "09:00";
  const closingTime = settings?.defaultClosingTime ?? "18:00";
  const slotIntervalMinutes = settings?.slotIntervalMinutes ?? 15;

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
      requirements,
    });
    slots.push({ startTime: cursor, available });
    cursor = addMinutesToTime(cursor, slotIntervalMinutes);
  }
  return slots;
}

// Same day-loop as computeSlotsForDay, but for the from/to range mode below, which
// only needs a yes/no per day — stops at the FIRST feasible slot instead of always
// computing the full day's grid. A 60-day horizon (the therapist-first DatePicker's
// real call) doing a full per-slot scan on every day would be a genuine, needless
// N-times-slower cost for the common case (most open days have an early slot free);
// this only pays the full-day cost on days that turn out to have nothing available.
async function isDayFeasible(params: {
  propertyId: string;
  treatmentId: string;
  date: Date;
  treatment: Pick<SpaTreatment, "defaultDurationMinutes" | "cleanupBufferMinutes" | "preparationBufferMinutes">;
  settings: Pick<SpaSettings, "defaultOpeningTime" | "defaultClosingTime" | "slotIntervalMinutes"> | null;
  partySize: number;
  requirements?: TherapistRequirement[];
}): Promise<boolean> {
  const { propertyId, treatmentId, date, treatment, settings, partySize, requirements } = params;
  const openingTime = settings?.defaultOpeningTime ?? "09:00";
  const closingTime = settings?.defaultClosingTime ?? "18:00";
  const slotIntervalMinutes = settings?.slotIntervalMinutes ?? 15;

  let cursor = openingTime;
  while (cursor < closingTime) {
    const treatmentEndTime = addMinutesToTime(cursor, treatment.defaultDurationMinutes);
    const blockedUntilTime = addMinutesToTime(treatmentEndTime, treatment.cleanupBufferMinutes);
    const blockedFromTime = addMinutesToTime(cursor, -treatment.preparationBufferMinutes);
    if (blockedUntilTime > closingTime) break;

    const available = await isSlotFeasible({ propertyId, treatmentId, partySize, date, blockedFromTime, blockedUntilTime, requirements });
    if (available) return true;
    cursor = addMinutesToTime(cursor, slotIntervalMinutes);
  }
  return false;
}

// Server-computed bookable time slots for a treatment on a given date — the booking
// screen's slot picker calls this, and POST /api/spa/appointments re-runs the exact
// same feasibility check at save time (SPA_PLAN.md §7: "never trust a client-cached
// slot list"). Also returns the effective price for the date so the UI can show it
// before the guest confirms, without a second round trip.
//
// Two response shapes depending on which date param is passed:
// - `date`: today's original behavior — every slot on that one day (unchanged shape).
// - `from`+`to` (added for therapist-first booking): which DAYS in that range have at
//   least one feasible slot at all, for the DatePicker's `availableDates` — so a day a
//   specifically-requested therapist doesn't work simply grays out in the calendar
//   instead of the guest picking it and hitting a dead end.
// `requirements` (optional, JSON-encoded array, one entry per participant) narrows
// either mode to a specific therapist/gender ask instead of "any qualified therapist."
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const treatmentId = searchParams.get("treatmentId");
    const dateParam = searchParams.get("date");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const partySize = parseInt(searchParams.get("partySize") ?? "1");

    if (!propertyId || !treatmentId || (!dateParam && !(fromParam && toParam))) {
      return NextResponse.json({ error: "propertyId, treatmentId, and either date or from+to are required" }, { status: 400 });
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

    let requirements: TherapistRequirement[] | undefined;
    const requirementsParam = searchParams.get("requirements");
    if (requirementsParam) {
      try {
        const parsed = JSON.parse(requirementsParam);
        if (!Array.isArray(parsed) || parsed.length !== partySize) {
          return NextResponse.json({ error: "requirements must be an array with one entry per participant" }, { status: 400 });
        }
        requirements = parsed;
      } catch {
        return NextResponse.json({ error: "requirements must be valid JSON" }, { status: 400 });
      }
    }

    const settings = await prisma.spaSettings.findUnique({ where: { propertyId } });

    if (fromParam && toParam) {
      const from = new Date(fromParam);
      const to = new Date(toParam);
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
      }
      const days: { date: string; available: boolean }[] = [];
      for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
        const day = new Date(cursor);
        const available = await isDayFeasible({ propertyId, treatmentId, date: day, treatment, settings, partySize, requirements });
        days.push({ date: day.toISOString().slice(0, 10), available });
      }
      return NextResponse.json({ days });
    }

    const date = new Date(dateParam!);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const rate = rateForDate(treatment.rates, date);
    const price = rate ? computeAppointmentTotal(rate, treatment.pricingMode, partySize) : null;
    const slots = await computeSlotsForDay({ propertyId, treatmentId, date, treatment, settings, partySize, requirements });

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
