import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { countMealPlanUsage, isUniqueViolation, usageMessages } from "@/lib/revenue-usage";

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

    // Reservation.mealPlan stores the CODE as text — renaming a used plan would orphan
    // every booking on it, so the code is frozen once any reservation carries it.
    const nextCode = body.code ? String(body.code).trim().toUpperCase() : existing.code;
    if (nextCode !== existing.code) {
      const used = await countMealPlanUsage(existing.propertyId, existing.code);
      if (used > 0) {
        return NextResponse.json({ error: usageMessages.mealPlanCode(existing.code, used) }, { status: 409 });
      }
    }

    // Linked allocations (full replacement when provided) — what selecting this meal
    // plan brings onto a reservation (BB → {BF}). Any allocation belonging to this
    // property is linkable.
    let allocationIds: string[] | undefined;
    if (body.allocationIds !== undefined) {
      if (!Array.isArray(body.allocationIds)) {
        return NextResponse.json({ error: "allocationIds must be an array" }, { status: 400 });
      }
      allocationIds = [...new Set(body.allocationIds as string[])];
      if (allocationIds.length > 0) {
        const linkable = await prisma.allocation.findMany({
          where: { id: { in: allocationIds }, propertyId: existing.propertyId },
        });
        if (linkable.length !== allocationIds.length) {
          return NextResponse.json(
            { error: "Allocations must belong to this property" },
            { status: 400 }
          );
        }
      }
    }

    const mealPlan = await prisma.mealPlan.update({
      where: { id },
      data: {
        code: nextCode,
        name: body.name ?? existing.name,
        isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
        allocationLinks:
          allocationIds !== undefined
            ? { deleteMany: {}, create: allocationIds.map((allocationId) => ({ allocationId })) }
            : undefined,
      },
      include: {
        allocationLinks: {
          include: { allocation: { select: { id: true, code: true, name: true, mode: true } } },
        },
      },
    });

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "UPDATE",
      entityType: "MealPlan",
      entityId: mealPlan.id,
      description: `Updated meal plan "${mealPlan.name}" (${mealPlan.code})`,
    });

    return NextResponse.json(mealPlan);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: "A meal plan with this code already exists for this property" }, { status: 409 });
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

    // Reservations store the plan's code as text, so deleting a used plan would leave
    // them pointing at nothing — deactivating hides it from new bookings instead.
    const used = await countMealPlanUsage(existing.propertyId, existing.code);
    if (used > 0) {
      return NextResponse.json({ error: usageMessages.mealPlanDelete(existing.code, used) }, { status: 409 });
    }

    await prisma.mealPlan.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "DELETE",
      entityType: "MealPlan",
      entityId: id,
      description: `Deleted meal plan "${existing.name}" (${existing.code})`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
