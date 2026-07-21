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
      throw new ForbiddenError("Only Osta staff can reject properties");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.rejectionReason || typeof body.rejectionReason !== "string") {
      return NextResponse.json({ error: "rejectionReason is required" }, { status: 400 });
    }

    const property = await prisma.property.findUnique({ where: { id } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    if (property.status === "ACTIVE") {
      return NextResponse.json({ error: "An already-active property cannot be rejected." }, { status: 400 });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: { status: "REJECTED", reviewedByUserId: ctx.userId, reviewedAt: new Date(), rejectionReason: body.rejectionReason },
    });

    const description = `Rejected property "${property.name}" (${property.code}) — ${body.rejectionReason}`;
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description });
    await logActivity({ ctx, module: "CONTROLS", action: "UPDATE", entityType: "Property", entityId: id, description, targetEnterpriseId: property.enterpriseId });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
