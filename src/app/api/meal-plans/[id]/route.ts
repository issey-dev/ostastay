import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.mealPlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    const mealPlan = await prisma.mealPlan.update({
      where: { id },
      data: {
        code: body.code ? body.code.toUpperCase() : existing.code,
        name: body.name ?? existing.name,
        isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
      },
    });

    return NextResponse.json(mealPlan);
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A meal plan with this code already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "delete");

    const { id } = await params;
    const existing = await prisma.mealPlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Cascades to RoomTypeMealPlanRate rows (schema onDelete: Cascade). Reservations
    // referencing this plan's code keep their string value — it simply stops
    // resolving to anything at Night Audit, same as an unconfigured meal plan.
    await prisma.mealPlan.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
