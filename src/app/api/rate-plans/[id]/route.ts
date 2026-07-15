import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

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
    const { id } = await params;
    const body = await request.json();
    
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
    console.error("Error updating rate plan:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.ratePlan.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting rate plan:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
