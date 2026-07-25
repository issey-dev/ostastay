import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, requirePropertyScope, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Lets a tenant put a REJECTED property back into the Osta approval queue after
// addressing whatever the rejection reason called out. Only legal from REJECTED —
// PENDING is already in the queue, and ACTIVE has nothing to resubmit.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property || property.enterpriseId !== ctx.enterpriseId) {
      throw new ForbiddenError("Property not found");
    }
    // A PROPERTY-scoped user may only resubmit their own work location, not a sibling.
    requirePropertyScope(ctx, id);
    if (property.status !== "REJECTED") {
      return NextResponse.json({ error: "Only a rejected property can be resubmitted." }, { status: 400 });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null, rejectionReason: null },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Property",
      entityId: property.id,
      description: `Resubmitted property "${property.name}" (${property.code}) for Osta approval`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
