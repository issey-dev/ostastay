import { prisma as defaultPrisma } from "@/lib/db";
import { resolveChargeTax, type TaxBreakdownLine } from "@/lib/tax-calc";
import { applyRateAdjustment } from "@/lib/derived-rate";
import {
  allocationAmountForNight,
  allocationStayBreakdown,
  resolveLinkedAllocationIds,
  type AllocationLike,
  type AllocationStayBreakdown,
  type AllocationCalculationMode,
} from "@/lib/allocations";

const DAY_MS = 86_400_000;
const dayStartMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ReservationQuoteInput = {
  propertyId: string;
  assignments: Array<{
    roomTypeId: string;
    // Optional "room type to charge" — when set, pricing (calendar + base occupancy)
    // resolves off this type instead of the physical roomTypeId (kept-rate room move).
    chargeRoomTypeId?: string | null;
    ratePlanId: string;
    startDate: Date;
    endDate: Date;
    overrideRate?: number | null;
  }>;
  adults: number;
  children: number;
  mealPlanCode?: string | null;
  manualAllocationIds?: string[];
};

export type ReservationQuoteSegment = {
  roomTypeId: string;
  ratePlanId: string;
  nights: number;
  roomBase: number;
  roomTax: number;
  roomServiceCharge: number;
  extraOccupancyBase: number;
  extraOccupancyTax: number;
  extraOccupancyServiceCharge: number;
  unpricedNights: number;
};

export type ReservationQuoteAllocation = {
  allocationId: string;
  code: string;
  name: string;
  source: "RATE_PLAN" | "MEAL_PLAN" | "MANUAL";
  mode: string;
  base: number;
  tax: number;
  serviceCharge: number;
  breakdown: AllocationStayBreakdown;
};

export type ReservationQuoteTaxLine = {
  name: string;
  ratePercent: number;
  calculateOn: "BASE" | "COMPOUND";
  amount: number;
};

// One row per night for the reservation "Daily Details" grid. Reconciles to the quote
// totals: sum(roomCharge) = roomBase+extraOccupancyBase, sum(allocationCharge) =
// allocationsBase, sum(taxes) = taxTotal+greenTaxTotal, sum(total) = grandTotal.
export type ReservationQuoteDay = {
  date: string; // yyyy-mm-dd (the night's calendar date)
  assignmentIndex: number | null; // index into the input `assignments` covering this night
  roomTypeId: string | null;
  ratePlanId: string | null;
  rate: number; // the night's room rate before tax/carve-out
  adults: number;
  children: number;
  roomCharge: number; // room base + extra-occupancy base
  allocationCharge: number; // allocation base for the night
  taxes: number; // GST + service charge + green tax for the night
  total: number; // roomCharge + allocationCharge + taxes
};

export type ReservationQuote = {
  nights: number;
  pricesIncludeTaxes: boolean;
  segments: ReservationQuoteSegment[];
  allocations: ReservationQuoteAllocation[];
  days: ReservationQuoteDay[];
  taxLines: ReservationQuoteTaxLine[];
  greenTax: {
    enabled: boolean;
    adults: number;
    children: number;
    perAdultAmount: number;
    perChildAmount: number;
    nights: number;
    total: number;
  };
  totals: {
    roomBase: number;
    extraOccupancyBase: number;
    allocationsBase: number;
    taxTotal: number;
    greenTaxTotal: number;
    grandTotal: number;
  };
  warnings: string[];
};

// A dry-run quote for the booking form's summary — projects the FULL stay's cost
// across every night from check-in to check-out, using the exact same resolution
// chain Night Audit posts with (derived-plan adjustment, locked Base plan fallback,
// INCLUDE_IN_RATE carve-out before tax, per-charge-code tax/Custom Tax profile, flat
// Green Tax) so the quote can never disagree with what actually gets billed. Nothing
// is written — this only reads.
export async function computeReservationQuote(
  input: ReservationQuoteInput,
  prisma: typeof defaultPrisma = defaultPrisma
): Promise<ReservationQuote> {
  const { propertyId, assignments, adults, children } = input;
  const mealPlanCode = input.mealPlanCode && input.mealPlanCode !== "NONE" ? input.mealPlanCode : null;
  const requestedManualIds = input.manualAllocationIds ?? [];
  const warnings: string[] = [];

  if (assignments.length === 0) {
    throw new Error("At least one room segment is required");
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found");
  const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: property.enterpriseId } });
  const pricesIncludeTaxes = property.pricesIncludeTaxes;

  const taxInclude = { taxProfile: { include: { rates: true } } } as const;

  const defaultAccommodationCode = settings?.defaultAccommodationChargeCodeId
    ? await prisma.chargeCode.findFirst({
        where: { id: settings.defaultAccommodationChargeCodeId, enterpriseId: property.enterpriseId },
        include: taxInclude,
      })
    : null;
  const legacyRoomCode = await prisma.chargeCode.findFirst({
    where: { enterpriseId: property.enterpriseId, code: "ROOM" },
    include: taxInclude,
  });
  const fallbackRoomCode = defaultAccommodationCode ?? legacyRoomCode;
  if (!fallbackRoomCode) {
    warnings.push("No accommodation charge code configured — room charges cannot be quoted.");
  }

  const baseRatePlan = await prisma.ratePlan.findFirst({ where: { propertyId, isLocked: true } });

  const ratePlanIds = [...new Set(assignments.map((a) => a.ratePlanId))];
  const ratePlans = await prisma.ratePlan.findMany({
    where: { id: { in: ratePlanIds } },
    include: {
      chargeCode: { include: taxInclude },
      allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } },
      parentRatePlan: {
        include: { allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } } },
      },
    },
  });
  const ratePlanById = new Map(ratePlans.map((rp) => [rp.id, rp]));

  // Include any "charge as" room types so their prices AND base occupancy are loaded.
  const roomTypeIds = [...new Set(assignments.flatMap((a) => [a.roomTypeId, a.chargeRoomTypeId ?? a.roomTypeId]))];
  const roomTypes = await prisma.roomType.findMany({ where: { id: { in: roomTypeIds } } });
  const roomTypeById = new Map(roomTypes.map((rt) => [rt.id, rt]));

  const overallStart = Math.min(...assignments.map((a) => dayStartMs(a.startDate)));
  const overallEnd = Math.max(...assignments.map((a) => dayStartMs(a.endDate)));
  const nights = Math.max(0, Math.round((overallEnd - overallStart) / DAY_MS));

  const calendarPlanIdFor = (rp: NonNullable<ReturnType<typeof ratePlanById.get>>) => rp.parentRatePlanId ?? rp.id;
  const calendarPlanIds = new Set<string>();
  for (const rp of ratePlans) calendarPlanIds.add(calendarPlanIdFor(rp));
  if (baseRatePlan) calendarPlanIds.add(baseRatePlan.id);

  const calendarRows = await prisma.priceCalendar.findMany({
    where: {
      ratePlanId: { in: [...calendarPlanIds] },
      roomTypeId: { in: roomTypeIds },
      date: { gte: new Date(overallStart), lt: new Date(overallEnd) },
    },
    select: { ratePlanId: true, roomTypeId: true, date: true, price: true, extraAdultPrice: true, extraChildPrice: true },
  });
  const calKey = (planId: string, typeId: string, nightMs: number) => `${planId}|${typeId}|${nightMs}`;
  const calendar = new Map<string, { price: number; extraAdultPrice: number | null; extraChildPrice: number | null }>();
  for (const row of calendarRows) {
    calendar.set(calKey(row.ratePlanId, row.roomTypeId, dayStartMs(row.date)), {
      price: row.price,
      extraAdultPrice: row.extraAdultPrice,
      extraChildPrice: row.extraChildPrice,
    });
  }

  // ── Attached allocations (reservation-wide, not per-segment) ─────────────────
  const primaryRatePlan = ratePlanById.get(assignments[0].ratePlanId);
  const mealPlan = mealPlanCode
    ? await prisma.mealPlan.findUnique({
        where: { propertyId_code: { propertyId, code: mealPlanCode } },
        include: { allocationLinks: { include: { allocation: { select: { id: true, isActive: true } } } } },
      })
    : null;

  const activeLinks = (
    links: Array<{ allocationId: string; allocation: { isActive: boolean } }> | undefined
  ) => (links ?? []).filter((l) => l.allocation.isActive).map((l) => ({ allocationId: l.allocationId }));

  const mode: AllocationCalculationMode = property.allocationCalculationMode === "MEAL_PLAN" ? "MEAL_PLAN" : "RATE_PLAN";
  const linked = resolveLinkedAllocationIds({
    mode,
    ratePlanLinks: activeLinks(primaryRatePlan?.allocationLinks),
    parentRatePlanLinks: activeLinks(primaryRatePlan?.parentRatePlan?.allocationLinks),
    mealPlanLinks: activeLinks(mealPlan?.allocationLinks),
  });
  const linkedIds = new Set(linked.map((l) => l.allocationId));
  const manualIds = requestedManualIds.filter((id) => !linkedIds.has(id));

  const allAllocationIds = [...new Set([...linkedIds, ...manualIds])];
  const allocationRecords = allAllocationIds.length
    ? await prisma.allocation.findMany({
        where: { id: { in: allAllocationIds }, propertyId },
        include: { rates: true, chargeCode: { include: taxInclude } },
      })
    : [];
  const allocationById = new Map(allocationRecords.map((a) => [a.id, a]));
  if (allocationById.size !== allAllocationIds.length) {
    warnings.push("One or more add-on allocations were not found for this property and were ignored.");
  }

  const attachedAllocations: Array<{ allocationId: string; source: "RATE_PLAN" | "MEAL_PLAN" | "MANUAL" }> = [
    ...linked.filter((l) => allocationById.has(l.allocationId)),
    ...manualIds.filter((id) => allocationById.has(id)).map((id) => ({ allocationId: id, source: "MANUAL" as const })),
  ];

  // ── Tax aggregation shared across room, extra-occupancy, and allocations ────
  const taxLineTotals = new Map<string, ReservationQuoteTaxLine>();
  const addTaxBreakdown = (lines: TaxBreakdownLine[]) => {
    for (const line of lines) {
      const existing = taxLineTotals.get(line.name);
      if (existing) {
        existing.amount = round2(existing.amount + line.amount);
      } else {
        taxLineTotals.set(line.name, { name: line.name, ratePercent: line.ratePercent, calculateOn: line.calculateOn, amount: line.amount });
      }
    }
  };

  // ── Per-segment room + extra-occupancy accumulators ─────────────────────────
  const segmentAccum = assignments.map(() => ({
    roomBase: 0, roomTax: 0, roomServiceCharge: 0,
    extraOccupancyBase: 0, extraOccupancyTax: 0, extraOccupancyServiceCharge: 0,
    unpricedNights: 0,
  }));

  // ── Allocation accumulators, reservation-wide ───────────────────────────────
  const allocationAccum = new Map<string, { base: number; tax: number; serviceCharge: number }>();
  for (const { allocationId } of attachedAllocations) {
    allocationAccum.set(allocationId, { base: 0, tax: 0, serviceCharge: 0 });
  }

  let greenTaxTotal = 0;
  const greenTaxEnabled = settings?.greenTaxEnabled ?? false;
  const greenTaxAdultAmount = settings?.greenTaxAdultAmount ?? 0;
  const greenTaxChildAmount = settings?.greenTaxChildAmount ?? 0;

  // Per-night rows for the Daily Details grid — populated as the same loop runs.
  const days: ReservationQuoteDay[] = [];

  for (let nightMs = overallStart; nightMs < overallEnd; nightMs += DAY_MS) {
    const segIndex = assignments.findIndex((a) => dayStartMs(a.startDate) <= nightMs && dayStartMs(a.endDate) > nightMs);
    const assignment = segIndex >= 0 ? assignments[segIndex] : undefined;

    // This night's figures, captured alongside the running accumulators for the grid.
    let nightRate = 0;
    let nRoomBase = 0, nRoomTax = 0, nRoomSC = 0;
    let nExtraBase = 0, nExtraTax = 0, nExtraSC = 0;
    let nAllocBase = 0, nAllocTax = 0, nAllocSC = 0;

    // Tonight's allocation amounts — computed first so INCLUDE_IN_RATE ones can be
    // carved out of the room line, exactly like Night Audit.
    const night = new Date(nightMs);
    const allocationsTonight: Array<{ allocationId: string; amount: number; mode: string; chargeCodeId: string }> = [];
    for (const { allocationId } of attachedAllocations) {
      const alloc = allocationById.get(allocationId);
      if (!alloc) continue;
      const like: AllocationLike = {
        id: alloc.id, code: alloc.code, name: alloc.name,
        mode: alloc.mode, postingRhythm: alloc.postingRhythm,
        rates: alloc.rates.map((r) => ({ adultPrice: r.adultPrice, childPrice: r.childPrice, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo })),
      };
      const amount = allocationAmountForNight({
        allocation: like, adults, children,
        checkInDate: new Date(overallStart), checkOutDate: new Date(overallEnd),
        auditDate: night,
      });
      if (amount != null && amount > 0) {
        allocationsTonight.push({ allocationId, amount, mode: alloc.mode, chargeCodeId: alloc.chargeCodeId });
      }
    }
    const includeInRateGross = allocationsTonight.filter((a) => a.mode === "INCLUDE_IN_RATE").reduce((s, a) => s + a.amount, 0);

    if (assignment && segIndex >= 0) {
      // Price against the "charge as" room type when set, else the physical one.
      const chargeTypeId = assignment.chargeRoomTypeId ?? assignment.roomTypeId;
      const rp = ratePlanById.get(assignment.ratePlanId);
      const roomType = roomTypeById.get(chargeTypeId);
      if (rp && roomType && fallbackRoomCode) {
        const isDerived = !!rp.parentRatePlanId;
        const calendarPlanId = calendarPlanIdFor(rp);
        const roomCode = rp.chargeCode ?? fallbackRoomCode;
        const entry = calendar.get(calKey(calendarPlanId, chargeTypeId, nightMs));

        let inputAmount = assignment.overrideRate ?? null;
        if (inputAmount == null) {
          let baseRoomPrice = entry?.price;
          if (baseRoomPrice == null && baseRatePlan && calendarPlanId !== baseRatePlan.id) {
            baseRoomPrice = calendar.get(calKey(baseRatePlan.id, chargeTypeId, nightMs))?.price;
          }
          if (baseRoomPrice == null) segmentAccum[segIndex].unpricedNights += 1;
          let price = baseRoomPrice ?? 0;
          if (isDerived) price = applyRateAdjustment(price, rp.derivedAdjustmentType!, rp.derivedAdjustmentValue!);
          inputAmount = price;
        }

        nightRate = inputAmount ?? 0;

        const roomInputAfterCarveOut = Math.max(0, inputAmount - includeInRateGross);
        const roomTaxResult = resolveChargeTax({ chargeCode: roomCode, inputAmount: roomInputAfterCarveOut, settings, pricesIncludeTaxes });
        nRoomBase = roomTaxResult.baseAmount; nRoomTax = roomTaxResult.taxAmount; nRoomSC = roomTaxResult.serviceChargeAmount;
        segmentAccum[segIndex].roomBase = round2(segmentAccum[segIndex].roomBase + roomTaxResult.baseAmount);
        segmentAccum[segIndex].roomTax = round2(segmentAccum[segIndex].roomTax + roomTaxResult.taxAmount);
        segmentAccum[segIndex].roomServiceCharge = round2(segmentAccum[segIndex].roomServiceCharge + roomTaxResult.serviceChargeAmount);
        addTaxBreakdown(roomTaxResult.breakdown);

        const extraAdults = Math.max(0, adults - roomType.baseOccupancy);
        const extraOccupancyInput = extraAdults * (entry?.extraAdultPrice ?? 0) + children * (entry?.extraChildPrice ?? 0);
        if (extraOccupancyInput > 0) {
          const extraTaxResult = resolveChargeTax({ chargeCode: roomCode, inputAmount: extraOccupancyInput, settings, pricesIncludeTaxes });
          nExtraBase = extraTaxResult.baseAmount; nExtraTax = extraTaxResult.taxAmount; nExtraSC = extraTaxResult.serviceChargeAmount;
          segmentAccum[segIndex].extraOccupancyBase = round2(segmentAccum[segIndex].extraOccupancyBase + extraTaxResult.baseAmount);
          segmentAccum[segIndex].extraOccupancyTax = round2(segmentAccum[segIndex].extraOccupancyTax + extraTaxResult.taxAmount);
          segmentAccum[segIndex].extraOccupancyServiceCharge = round2(segmentAccum[segIndex].extraOccupancyServiceCharge + extraTaxResult.serviceChargeAmount);
          addTaxBreakdown(extraTaxResult.breakdown);
        }
      }
    } else {
      warnings.push(`No room segment covers ${night.toISOString().slice(0, 10)} — that night was not quoted.`);
    }

    for (const { allocationId, amount, chargeCodeId } of allocationsTonight) {
      const alloc = allocationById.get(allocationId);
      if (!alloc) continue;
      const allocTax = resolveChargeTax({ chargeCode: alloc.chargeCode, inputAmount: amount, settings, pricesIncludeTaxes });
      nAllocBase += allocTax.baseAmount; nAllocTax += allocTax.taxAmount; nAllocSC += allocTax.serviceChargeAmount;
      const accum = allocationAccum.get(allocationId)!;
      accum.base = round2(accum.base + allocTax.baseAmount);
      accum.tax = round2(accum.tax + allocTax.taxAmount);
      accum.serviceCharge = round2(accum.serviceCharge + allocTax.serviceChargeAmount);
      addTaxBreakdown(allocTax.breakdown);
      void chargeCodeId;
    }

    const nGreenTax = greenTaxEnabled ? adults * greenTaxAdultAmount + children * greenTaxChildAmount : 0;
    if (greenTaxEnabled) {
      greenTaxTotal = round2(greenTaxTotal + nGreenTax);
    }

    const nTaxes = nRoomTax + nRoomSC + nExtraTax + nExtraSC + nAllocTax + nAllocSC + nGreenTax;
    const nRoomCharge = nRoomBase + nExtraBase;
    // Date from the night's LOCAL calendar components (nightMs is a local-midnight key),
    // not toISOString() which would shift it a day in a non-UTC timezone.
    const pad = (n: number) => String(n).padStart(2, "0");
    days.push({
      date: `${night.getFullYear()}-${pad(night.getMonth() + 1)}-${pad(night.getDate())}`,
      assignmentIndex: segIndex >= 0 ? segIndex : null,
      roomTypeId: assignment?.roomTypeId ?? null,
      ratePlanId: assignment?.ratePlanId ?? null,
      rate: round2(nightRate),
      adults, children,
      roomCharge: round2(nRoomCharge),
      allocationCharge: round2(nAllocBase),
      taxes: round2(nTaxes),
      total: round2(nRoomCharge + nAllocBase + nTaxes),
    });
  }

  const segmentsOut: ReservationQuoteSegment[] = assignments.map((a, i) => ({
    roomTypeId: a.roomTypeId,
    ratePlanId: a.ratePlanId,
    nights: Math.max(0, Math.round((dayStartMs(a.endDate) - dayStartMs(a.startDate)) / DAY_MS)),
    ...segmentAccum[i],
  }));

  const allocationsOut: ReservationQuoteAllocation[] = attachedAllocations
    .map(({ allocationId, source }) => {
      const alloc = allocationById.get(allocationId);
      const accum = allocationAccum.get(allocationId);
      if (!alloc || !accum) return null;
      const breakdown = allocationStayBreakdown({
        allocation: {
          id: alloc.id, code: alloc.code, name: alloc.name,
          mode: alloc.mode, postingRhythm: alloc.postingRhythm,
          rates: alloc.rates.map((r) => ({ adultPrice: r.adultPrice, childPrice: r.childPrice, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo })),
        },
        adults, children,
        checkInDate: new Date(overallStart), checkOutDate: new Date(overallEnd),
      });
      return {
        allocationId, code: alloc.code, name: alloc.name, source,
        mode: alloc.mode, base: accum.base, tax: accum.tax, serviceCharge: accum.serviceCharge,
        breakdown,
      };
    })
    .filter((a): a is ReservationQuoteAllocation => a !== null);

  const roomBaseTotal = round2(segmentsOut.reduce((s, seg) => s + seg.roomBase, 0));
  const extraOccupancyBaseTotal = round2(segmentsOut.reduce((s, seg) => s + seg.extraOccupancyBase, 0));
  const allocationsBaseTotal = round2(allocationsOut.reduce((s, a) => s + a.base, 0));
  const taxLines = [...taxLineTotals.values()].filter((l) => l.amount !== 0);
  const taxTotal = round2(taxLines.reduce((s, l) => s + l.amount, 0));

  for (const seg of segmentsOut) {
    if (seg.unpricedNights > 0) {
      warnings.push(`${seg.unpricedNights} night(s) have no configured rate for this room type/plan and were quoted as $0.`);
    }
  }

  return {
    nights,
    pricesIncludeTaxes,
    segments: segmentsOut,
    allocations: allocationsOut,
    days,
    taxLines,
    greenTax: {
      enabled: greenTaxEnabled,
      adults, children,
      perAdultAmount: greenTaxAdultAmount,
      perChildAmount: greenTaxChildAmount,
      nights,
      total: greenTaxTotal,
    },
    totals: {
      roomBase: roomBaseTotal,
      extraOccupancyBase: extraOccupancyBaseTotal,
      allocationsBase: allocationsBaseTotal,
      taxTotal,
      greenTaxTotal,
      grandTotal: round2(roomBaseTotal + extraOccupancyBaseTotal + allocationsBaseTotal + taxTotal + greenTaxTotal),
    },
    warnings,
  };
}
