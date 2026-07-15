import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  try {
    const ratePlans = await prisma.ratePlan.findMany({
      where: propertyId ? { propertyId } : undefined,
      orderBy: { priority: 'asc' }, // Higher priority (lower number) first
    });
    return NextResponse.json(ratePlans);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch rate plans" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.code || !body.name || !body.propertyId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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
    return NextResponse.json({ error: "Failed to create rate plan" }, { status: 500 });
  }
}
