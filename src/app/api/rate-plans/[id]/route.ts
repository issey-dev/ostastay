import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const updateSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  description: z.string().optional().nullable(),
  priority: z.number().int().nonnegative(),
  isNegotiated: z.boolean(),
  mealPlan: z.string().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.ratePlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Parse and validate the body
    const data = updateSchema.parse({
      ...body,
      priority: parseInt(body.priority) || 0,
      isNegotiated: !!body.isNegotiated,
      mealPlan: body.mealPlan,
    });

    const updatedRatePlan = await prisma.ratePlan.update({
      where: { id },
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        description: data.description,
        priority: data.priority,
        isNegotiated: data.isNegotiated,
        mealPlan: data.mealPlan,
      },
    });

    return NextResponse.json(updatedRatePlan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
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
    const existing = await prisma.ratePlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    await prisma.ratePlan.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
