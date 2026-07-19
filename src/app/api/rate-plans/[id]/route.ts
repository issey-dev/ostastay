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
  parentRatePlanId: z.string().uuid().nullable().optional(),
  derivedAdjustmentType: z.enum(["PERCENT", "FLAT"]).nullable().optional(),
  derivedAdjustmentValue: z.number().nullable().optional(),
  allocationIds: z.array(z.string().uuid()).optional(),
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

    const existing = await prisma.ratePlan.findUnique({
      where: { id },
      include: { _count: { select: { derivedRatePlans: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Rate plan not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Parse and validate the body
    const data = updateSchema.parse({
      ...body,
      priority: parseInt(body.priority) || 0,
      isNegotiated: !!body.isNegotiated,
      parentRatePlanId: body.parentRatePlanId || null,
      derivedAdjustmentType: body.derivedAdjustmentType || null,
      derivedAdjustmentValue:
        body.derivedAdjustmentValue === undefined || body.derivedAdjustmentValue === null || body.derivedAdjustmentValue === ""
          ? null
          : parseFloat(body.derivedAdjustmentValue),
    });

    let parentRatePlanId: string | null = null;
    let derivedAdjustmentType: string | null = null;
    let derivedAdjustmentValue: number | null = null;
    if (data.parentRatePlanId) {
      if (data.parentRatePlanId === id) {
        return NextResponse.json({ error: "A rate plan cannot derive from itself" }, { status: 400 });
      }
      if (existing._count.derivedRatePlans > 0) {
        return NextResponse.json({ error: "Cannot derive this rate plan from another — other rate plans already derive from it" }, { status: 400 });
      }
      const parent = await prisma.ratePlan.findUnique({ where: { id: data.parentRatePlanId } });
      if (!parent || parent.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Parent rate plan not found" }, { status: 404 });
      }
      if (parent.parentRatePlanId) {
        return NextResponse.json({ error: "Cannot derive from a rate plan that is itself derived" }, { status: 400 });
      }
      if (data.derivedAdjustmentType == null || data.derivedAdjustmentValue == null || isNaN(data.derivedAdjustmentValue)) {
        return NextResponse.json({ error: "derivedAdjustmentType and derivedAdjustmentValue are required when deriving from another rate plan" }, { status: 400 });
      }
      parentRatePlanId = parent.id;
      derivedAdjustmentType = data.derivedAdjustmentType;
      derivedAdjustmentValue = data.derivedAdjustmentValue;
    }

    // Package contents (full replacement when provided). Any allocation belonging to
    // this property is linkable — `sellSeparate` is independent of package membership.
    let allocationIds: string[] | undefined;
    if (data.allocationIds !== undefined) {
      allocationIds = [...new Set(data.allocationIds)];
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

    const updatedRatePlan = await prisma.ratePlan.update({
      where: { id },
      data: {
        code: data.code.toUpperCase(),
        name: data.name,
        description: data.description,
        priority: data.priority,
        isNegotiated: data.isNegotiated,
        parentRatePlanId,
        derivedAdjustmentType,
        derivedAdjustmentValue,
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
