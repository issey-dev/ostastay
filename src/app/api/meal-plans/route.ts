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

    const mealPlans = await prisma.mealPlan.findMany({
      where: { propertyId },
      include: {
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(mealPlans);
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
    if (!body.propertyId || !body.code || !body.name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    // Linked allocations — what selecting this meal plan brings onto a reservation
    // (BB → {BF}). Any allocation belonging to this property is linkable.
    let allocationIds: string[] = [];
    if (Array.isArray(body.allocationIds) && body.allocationIds.length > 0) {
      allocationIds = [...new Set(body.allocationIds as string[])];
      const linkable = await prisma.allocation.findMany({
        where: { id: { in: allocationIds }, propertyId: body.propertyId },
      });
      if (linkable.length !== allocationIds.length) {
        return NextResponse.json(
          { error: "Allocations must belong to this property" },
          { status: 400 }
        );
      }
    }

    const mealPlan = await prisma.mealPlan.create({
      data: {
        propertyId: body.propertyId,
        code: body.code.toUpperCase(),
        name: body.name,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        allocationLinks: allocationIds.length > 0
          ? { create: allocationIds.map((allocationId) => ({ allocationId })) }
          : undefined,
      },
      include: {
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
      },
    });

    return NextResponse.json(mealPlan, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A meal plan with this code already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
