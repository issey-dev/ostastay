import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can approve properties");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    if (property.status === "ACTIVE") {
      return NextResponse.json({ error: "This property is already active." }, { status: 400 });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: { status: "ACTIVE", reviewedByUserId: ctx.userId, reviewedAt: new Date(), rejectionReason: null },
    });

    const description = `Approved property "${property.name}" (${property.code})`;
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description });
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description, targetEnterpriseId: property.enterpriseId });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
