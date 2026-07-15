import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ratePlanId, roomTypeIds, startDate, endDate, price } = body;

    if (!ratePlanId || !roomTypeIds || !startDate || !endDate || price === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!Array.isArray(roomTypeIds) || roomTypeIds.length === 0) {
      return NextResponse.json({ error: "roomTypeIds must be a non-empty array" }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const parsedPrice = parseFloat(price);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(parsedPrice)) {
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
              price: parsedPrice
            },
            create: {
              ratePlanId,
              roomTypeId,
              date,
              price: parsedPrice
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
    console.error("Failed to bulk update price calendar:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
