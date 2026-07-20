import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { MAX_PRICE_CALENDAR_RANGE_DAYS, MAX_PRICE_CALENDAR_RANGE_YEARS } from "@/lib/price-calendar";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "update");

    const body = await request.json();
    const { ratePlanId, roomTypeIds, startDate, endDate, price, extraAdultPrice, extraChildPrice } = body;

    if (!ratePlanId || !roomTypeIds || !startDate || !endDate || price === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!Array.isArray(roomTypeIds) || roomTypeIds.length === 0) {
      return NextResponse.json({ error: "roomTypeIds must be a non-empty array" }, { status: 400 });
    }

    const ratePlan = await prisma.ratePlan.findUnique({ where: { id: ratePlanId } });
    if (!ratePlan) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, ratePlan.propertyId);
    if (ratePlan.parentRatePlanId) {
      return NextResponse.json({ error: "This is a derived rate plan — its price is computed from its parent plan's price and adjustment, edit those on the Rate Plan instead." }, { status: 400 });
    }

    const roomTypes = await prisma.roomType.findMany({ where: { id: { in: roomTypeIds } } });
    if (roomTypes.length !== roomTypeIds.length || roomTypes.some((rt) => rt.propertyId !== ratePlan.propertyId)) {
      return NextResponse.json({ error: "One or more room types do not belong to this property" }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const parsedPrice = parseFloat(price);
    const parsedExtraAdultPrice = extraAdultPrice === "" || extraAdultPrice == null ? null : parseFloat(extraAdultPrice);
    const parsedExtraChildPrice = extraChildPrice === "" || extraChildPrice == null ? null : parseFloat(extraChildPrice);

    if (
      isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(parsedPrice) ||
      (parsedExtraAdultPrice !== null && isNaN(parsedExtraAdultPrice)) ||
      (parsedExtraChildPrice !== null && isNaN(parsedExtraChildPrice))
    ) {
      return NextResponse.json({ error: "Invalid data formats" }, { status: 400 });
    }
    if (parsedPrice < 0 || (parsedExtraAdultPrice !== null && parsedExtraAdultPrice < 0) || (parsedExtraChildPrice !== null && parsedExtraChildPrice < 0)) {
      return NextResponse.json({ error: "Prices cannot be negative." }, { status: 400 });
    }

    // Generate array of dates between start and end (inclusive)
    const datesToUpdate: Date[] = [];
    let currentDate = new Date(start);
    // Ensure we start at midnight to avoid timezone drift issues in comparison
    currentDate.setHours(0, 0, 0, 0);
    const endMidnight = new Date(end);
    endMidnight.setHours(0, 0, 0, 0);

    // An inverted range (start after end) previously fell through silently: the loop
    // below never runs, datesToUpdate stays empty, and an empty transaction "succeeds"
    // with zero rows touched — no error, nothing updated, no visible sign why. Reject
    // it explicitly instead, same as the single-room-type Price Calendar endpoint.
    if (currentDate > endMidnight) {
      return NextResponse.json({ error: "Invalid date range — the start date must be on or before the end date." }, { status: 400 });
    }
    // Same ceiling as /api/price-calendar — this loop also builds one row per room
    // type per day, so an unbounded range risks a very large transaction.
    if (Math.round((endMidnight.getTime() - currentDate.getTime()) / 86400000) + 1 > MAX_PRICE_CALENDAR_RANGE_DAYS) {
      return NextResponse.json({ error: `Date range too large (max ${MAX_PRICE_CALENDAR_RANGE_YEARS} years).` }, { status: 400 });
    }

    while (currentDate <= endMidnight) {
      datesToUpdate.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const operations = [];

    // Loop through every room type and every date
    for (const roomTypeId of roomTypeIds) {
      for (const date of datesToUpdate) {
        operations.push(
          prisma.priceCalendar.upsert({
            where: {
              ratePlanId_roomTypeId_date: {
                ratePlanId,
                roomTypeId,
                date
              }
            },
            update: {
              price: parsedPrice,
              extraAdultPrice: parsedExtraAdultPrice,
              extraChildPrice: parsedExtraChildPrice,
            },
            create: {
              ratePlanId,
              roomTypeId,
              date,
              price: parsedPrice,
              extraAdultPrice: parsedExtraAdultPrice,
              extraChildPrice: parsedExtraChildPrice,
            }
          })
        );
      }
    }

    // Execute all upserts in a transaction for atomicity and speed
    await prisma.$transaction(operations);

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "UPDATE",
      entityType: "PriceCalendar",
      description: `Bulk-set prices on rate plan ${ratePlan.code}: ${parsedPrice} across ${roomTypeIds.length} room type(s), ${datesToUpdate.length} day(s)`,
    });

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${operations.length} price records.`
    }, { status: 201 });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
