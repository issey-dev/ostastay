import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const body = await request.json();

    if (!body.fromCurrency || !body.toCurrency || !body.rate || !body.amountFrom || !body.amountTo) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const rate = parseFloat(body.rate);
    const amountFrom = parseFloat(body.amountFrom);
    const amountTo = parseFloat(body.amountTo);

    // Every leg must be a positive number — a negative/zero or NaN amount would corrupt
    // the drawer's expected-cash reconciliation (these figures feed expectedCashForShift).
    if (![rate, amountFrom, amountTo].every((n) => Number.isFinite(n) && n > 0)) {
      return NextResponse.json({ error: "Rate and amounts must be positive numbers." }, { status: 400 });
    }

    // The triple must be internally consistent: amountTo ≈ amountFrom × rate. Validated
    // server-side (not trusted from the client) so a fat-fingered or tampered payout can't
    // be recorded. A 2% tolerance absorbs legitimate denomination rounding on the payout.
    const expectedTo = amountFrom * rate;
    if (Math.abs(amountTo - expectedTo) > Math.max(0.01, expectedTo * 0.02)) {
      return NextResponse.json(
        { error: `Amounts are inconsistent: ${amountFrom} × ${rate} ≈ ${expectedTo.toFixed(2)}, not ${amountTo}.` },
        { status: 400 }
      );
    }

    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) {
      return NextResponse.json({ error: "No property found for this session" }, { status: 400 });
    }

    // The client no longer picks a shift explicitly — currency exchanges always post
    // against the caller's own currently-open cashier shift FOR THIS PROPERTY, auto-opening
    // one (0 float, business-date-stamped) if needed. Uses the shared ensureOpenShift so
    // the exchange can never attach to a drawer at a different property.
    const shift = await ensureOpenShift(ctx, propertyId);

    const currencyExchange = await prisma.currencyExchange.create({
      data: {
        propertyId,
        shiftId: shift.id,
        guestName: body.guestName || null,
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        rate,
        amountFrom,
        amountTo,
        createdByUserId: ctx.userId,
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "CREATE",
      entityType: "CurrencyExchange",
      entityId: currencyExchange.id,
      description: `Currency exchange ${currencyExchange.amountFrom} ${currencyExchange.fromCurrency} → ${currencyExchange.amountTo} ${currencyExchange.toCurrency}${body.guestName ? ` for ${body.guestName}` : ""}`,
    });

    return NextResponse.json(currencyExchange, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
