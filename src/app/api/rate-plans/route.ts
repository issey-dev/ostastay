import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const ratePlans = await prisma.ratePlan.findMany({
      where: { propertyId },
      orderBy: { priority: 'asc' }, // Higher priority (lower number) first
    });
    return NextResponse.json(ratePlans);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "create");

    const body = await request.json();

    if (!body.code || !body.name || !body.propertyId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const newRatePlan = await prisma.ratePlan.create({
      data: {
        propertyId: body.propertyId,
        code: body.code.toUpperCase(),
        name: body.name,
        description: body.description,
        priority: parseInt(body.priority) || 10,
        isNegotiated: !!body.isNegotiated,
        mealPlan: body.mealPlan || "NONE",
      },
    });

    return NextResponse.json(newRatePlan, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
