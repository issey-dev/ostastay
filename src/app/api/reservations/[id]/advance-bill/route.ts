import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { postCharge, chargeCodeInclude, type PostableChargeCode } from "@/lib/posting/post-charge";
import { resolveChargeCode, MissingChargeCodeError } from "@/lib/posting/resolve-charge-code";
import type { GenerateRow } from "@/lib/posting/run-generates";
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

// Thrown when the reservation's advanceBilledThrough changed between the read and the
// posting transaction (a concurrent advance-bill, or a night-audit post, already advanced
// it). Turned into a clean 409 rather than double-billing the same nights.
class AdvanceBillConflict extends Error {}

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

    // Charge-code resolution mirrors Night Audit, but by ROLE rather than by literal code
    // string: per-plan accommodation code → the enterprise's ACCOMMODATION code; Green Tax
    // via the GREEN_TAX role. See src/lib/posting/resolve-charge-code.ts.
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: reservation.property.enterpriseId } });
    const fallbackRoom = await resolveChargeCode(reservation.property.enterpriseId, "ACCOMMODATION", { settings });
    if (!fallbackRoom) {
      return NextResponse.json({ error: new MissingChargeCodeError("ACCOMMODATION").message }, { status: 400 });
    }
    const gtxCode = await resolveChargeCode(reservation.property.enterpriseId, "GREEN_TAX", { settings });

    const quote = await computeReservationQuote({
      propertyId: reservation.propertyId,
      assignments: truncated.map(({ a, start, end }) => ({
        roomTypeId: a.roomTypeId,
        chargeRoomTypeId: a.chargeRoomTypeId,
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

    // Every charge code this run can post against, loaded once in the postCharge shape
    // (tax profile included) so the posting loop never issues a per-line lookup.
    const allocRows = quote.allocations.length > 0
      ? await prisma.allocation.findMany({
          where: { id: { in: quote.allocations.map((al) => al.allocationId) } },
          select: { id: true, chargeCodeId: true },
        })
      : [];
    const neededCodeIds = [...new Set([
      fallbackRoom.id,
      ...(gtxCode ? [gtxCode.id] : []),
      ...reservation.assignments.map((a) => a.ratePlan?.chargeCode?.id).filter((x): x is string => !!x),
      ...allocRows.map((al) => al.chargeCodeId).filter((x): x is string => !!x),
    ])];
    const codeById = new Map(
      (await prisma.chargeCode.findMany({
        where: { id: { in: neededCodeIds }, enterpriseId: reservation.property.enterpriseId },
        include: chargeCodeInclude(),
      })).map((c) => [c.id, c])
    );

    const allocCodeMap = new Map<string, PostableChargeCode>();
    for (const al of allocRows) {
      const code = al.chargeCodeId ? codeById.get(al.chargeCodeId) : undefined;
      if (code) allocCodeMap.set(al.id, code);
    }

    // The accommodation code for a segment: the assignment's rate plan's own code when it
    // sets one, else the role-resolved enterprise accommodation code.
    const codeForSeg = (roomTypeId: string, ratePlanId: string): PostableChargeCode => {
      const asg = reservation.assignments.find((a) => a.roomTypeId === roomTypeId && a.ratePlanId === ratePlanId);
      const planCodeId = asg?.ratePlan?.chargeCode?.id;
      return (planCodeId ? codeById.get(planCodeId) : undefined) ?? fallbackRoom;
    };

    let linesPosted = 0;
    let amountPosted = 0;
    try {
      await prisma.$transaction(async (tx) => {
      // Atomic check-and-set: claim the billing window by advancing advanceBilledThrough
      // from the exact value observed at read time to lastNight, in one statement. A
      // concurrent advance-bill (or a night-audit post that also advances it) will have
      // changed it, so only one run matches and posts — the other gets 0 rows and aborts,
      // preventing the same nights being billed twice.
      const claimed = await tx.reservation.updateMany({
        where: { id, advanceBilledThrough: reservation.advanceBilledThrough },
        data: { advanceBilledThrough: lastNight },
      });
      if (claimed.count === 0) throw new AdvanceBillConflict();

      // Every line below posts through postCharge with `amounts` (not `inputAmount`):
      // the reservation quote is the authority here — these are the exact figures the
      // guest was shown — so the tax engine must NOT re-derive them.
      //
      // Generates DO run. That is the whole point of declaring them: posting a charge
      // code posts everything derived from it, on every path, not just at Night Audit.
      // With pre-computed amounts, a SERVICE_CHARGE / GST generate simply routes the
      // figures supplied here onto the group's own tax codes — nothing is recalculated,
      // so an advance bill and the nights it replaces produce identical totals and
      // identical per-code attribution.
      const postPreComputed = async (args: {
        chargeCode: PostableChargeCode; description: string;
        baseAmount: number; taxAmount: number; serviceChargeAmount: number;
        postingContext?: { adults: number; children: number; nights: number };
        extraGenerates?: GenerateRow[];
      }) => {
        const posted = await postCharge(tx, {
          folioId: folio.id,
          chargeCode: args.chargeCode,
          amounts: { baseAmount: args.baseAmount, taxAmount: args.taxAmount, serviceChargeAmount: args.serviceChargeAmount },
          settings,
          pricesIncludeTaxes: reservation.property.pricesIncludeTaxes,
          date: businessDate,
          description: args.description,
          postingContext: args.postingContext ?? null,
          extraGenerates: args.extraGenerates,
        });
        amountPosted += posted.grandTotal;
        linesPosted += 1 + posted.generated.length;
      };

      // Green Tax rides on the FIRST accommodation segment, covering the whole billed
      // window in one line — the same shape Night Audit posts per night, and the same
      // figure the quote showed. Later segments (a room move mid-stay) suppress it so a
      // split stay isn't levied twice. `impliedGreenTax` covers an accommodation code
      // that carries no Green Tax row of its own, exactly as in Night Audit.
      const impliedGreenTax: GenerateRow[] = gtxCode && quote.greenTax.enabled
        ? [{
            id: `implied-green-tax:${gtxCode.id}`,
            generatedCodeId: gtxCode.id,
            method: "GREEN_TAX",
            value: 0,
            calculateOn: "NET",
            basisGenerateId: null,
            sortOrder: 1000,
            isActive: true,
          }]
        : [];
      let greenTaxPending = quote.greenTax.enabled && quote.greenTax.total > 0.005;

      for (const seg of quote.segments) {
        const code = codeForSeg(seg.roomTypeId, seg.ratePlanId);
        if (seg.roomBase > 0.005 || seg.roomTax > 0.005 || seg.roomServiceCharge > 0.005) {
          const levyThisSegment = greenTaxPending;
          greenTaxPending = false;
          await postPreComputed({
            chargeCode: code,
            description: `Advance — Accommodation (${seg.nights} night${seg.nights === 1 ? "" : "s"})`,
            baseAmount: seg.roomBase, taxAmount: seg.roomTax, serviceChargeAmount: seg.roomServiceCharge,
            // The levy covers every billed night in this run, not just this segment's.
            ...(levyThisSegment
              ? { postingContext: { adults: reservation.adults, children: reservation.children, nights }, extraGenerates: impliedGreenTax }
              : {}),
          });
        }
        if (seg.extraOccupancyBase > 0.005) {
          await postPreComputed({
            chargeCode: code,
            description: "Advance — Extra Occupancy",
            baseAmount: seg.extraOccupancyBase, taxAmount: seg.extraOccupancyTax, serviceChargeAmount: seg.extraOccupancyServiceCharge,
          });
        }
      }

      for (const al of quote.allocations) {
        const code = allocCodeMap.get(al.allocationId);
        if (!code || (al.base <= 0.005 && al.tax <= 0.005 && al.serviceCharge <= 0.005)) continue;
        await postPreComputed({
          chargeCode: code,
          description: `Advance — ${al.name}`,
          baseAmount: al.base, taxAmount: al.tax, serviceChargeAmount: al.serviceCharge,
        });
      }

      // Fallback for a stay whose accommodation lines were all zero (fully discounted,
      // or a rate gap): the levy still applies, so post it directly rather than losing it.
      if (greenTaxPending && gtxCode) {
        await postPreComputed({
          chargeCode: gtxCode,
          description: "Advance — Green Tax",
          baseAmount: quote.greenTax.total, taxAmount: 0, serviceChargeAmount: 0,
        });
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
          const dir = leg.direction === "PICKUP" ? "Pickup" : "Dropoff";
          // A transport leg's price is NOT part of the quote's pre-computed totals, so
          // unlike the lines above this one does go through the tax engine.
          const posted = await postCharge(tx, {
            folioId: folio.id,
            chargeCode: code,
            inputAmount: leg.chargeAmount!,
            settings,
            pricesIncludeTaxes: reservation.property.pricesIncludeTaxes,
            date: businessDate,
            description: `Advance — Transport (${dir})`,
          });
          await tx.reservationTransport.update({ where: { id: leg.id }, data: { chargedLineItemId: posted.parent.id } });
          amountPosted += posted.grandTotal; linesPosted += 1 + posted.generated.length;
        }
      }

      // (advanceBilledThrough was already set atomically by the claim above, so Night
      // Audit skips these nights — no second write needed here.)

      const user = await tx.user.findUnique({ where: { id: ctx.userId } });
      await tx.reservationTrace.create({
        data: {
          reservationId: id, traceType: "FRONT_DESK",
          description: `Advance bill by ${user ? `${user.firstName} ${user.lastName}` : ctx.userId} — ${nights} night(s), $${amountPosted.toFixed(2)} posted upfront (billed through ${lastNight.toISOString().slice(0, 10)}).`,
          actionDate: new Date(), isResolved: true,
        },
      });
      });
    } catch (txError) {
      if (txError instanceof AdvanceBillConflict) {
        return NextResponse.json(
          { error: "These nights were just advance-billed by another action. Refresh the folio and try again." },
          { status: 409 }
        );
      }
      throw txError;
    }

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
