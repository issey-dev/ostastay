import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { addDays, differenceInDays, startOfDay } from "date-fns";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const bulkUpsertSchema = z.object({
  ratePlanId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  price: z.number().min(0),
});

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const ratePlanId = searchParams.get("ratePlanId");
    const roomTypeId = searchParams.get("roomTypeId");
    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    if (!ratePlanId || !roomTypeId || !startDateStr || !endDateStr) {
      return NextResponse.json({ error: "Missing required query parameters" }, { status: 400 });
    }

    const ratePlan = await prisma.ratePlan.findUnique({ where: { id: ratePlanId } });
    if (!ratePlan) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, ratePlan.propertyId);

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    const prices = await prisma.priceCalendar.findMany({
      where: {
        ratePlanId,
        roomTypeId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { date: "asc" },
    });
    return NextResponse.json(prices);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "update");

    const body = await request.json();
    const data = bulkUpsertSchema.parse({
      ...body,
      price: parseFloat(body.price),
    });

    const [ratePlan, roomType] = await Promise.all([
      prisma.ratePlan.findUnique({ where: { id: data.ratePlanId } }),
      prisma.roomType.findUnique({ where: { id: data.roomTypeId } }),
    ]);
    if (!ratePlan) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, ratePlan.propertyId);
    if (!roomType || roomType.propertyId !== ratePlan.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
    }

    const startDate = startOfDay(new Date(data.startDate));
    const endDate = startOfDay(new Date(data.endDate));

    const totalDays = differenceInDays(endDate, startDate) + 1;

    if (totalDays <= 0 || totalDays > 365 * 2) {
      return NextResponse.json({ error: "Invalid date range or range too large (max 2 years)" }, { status: 400 });
    }

    const upserts = [];
    for (let i = 0; i < totalDays; i++) {
      const currentDate = addDays(startDate, i);

      upserts.push(
        prisma.priceCalendar.upsert({
          where: {
            ratePlanId_roomTypeId_date: {
              ratePlanId: data.ratePlanId,
              roomTypeId: data.roomTypeId,
              date: currentDate,
            }
          },
          update: {
            price: data.price,
          },
          create: {
            ratePlanId: data.ratePlanId,
            roomTypeId: data.roomTypeId,
            date: currentDate,
            price: data.price,
          }
        })
      );
    }

    // Execute all upserts in a transaction
    await prisma.$transaction(upserts);

    return NextResponse.json({ success: true, updatedDays: totalDays });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
