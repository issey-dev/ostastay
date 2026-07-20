import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const body = await request.json();

    if (!body.fromCurrency || !body.toCurrency || !body.rate || !body.amountFrom || !body.amountTo) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) {
      return NextResponse.json({ error: "No property found for this session" }, { status: 400 });
    }

    // The client no longer picks a shift explicitly — currency exchanges always post
    // against the caller's own currently-open cashier shift, auto-opening one (0 float)
    // if they don't have one yet, mirroring how folio payments are posted.
    let shift = await prisma.cashierShift.findFirst({
      where: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, closedAt: null }
    });
    if (!shift) {
      shift = await prisma.cashierShift.create({
        data: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, openingFloat: 0 }
      });
    }

    const currencyExchange = await prisma.currencyExchange.create({
      data: {
        propertyId,
        shiftId: shift.id,
        guestName: body.guestName || null,
        fromCurrency: body.fromCurrency,
        toCurrency: body.toCurrency,
        rate: parseFloat(body.rate),
        amountFrom: parseFloat(body.amountFrom),
        amountTo: parseFloat(body.amountTo),
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
