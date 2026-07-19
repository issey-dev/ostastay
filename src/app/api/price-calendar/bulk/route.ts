import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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

    // Generate array of dates between start and end (inclusive)
    const datesToUpdate: Date[] = [];
    let currentDate = new Date(start);
    // Ensure we start at midnight to avoid timezone drift issues in comparison
    currentDate.setHours(0, 0, 0, 0);
    const endMidnight = new Date(end);
    endMidnight.setHours(0, 0, 0, 0);

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

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${operations.length} price records.`
    }, { status: 201 });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
