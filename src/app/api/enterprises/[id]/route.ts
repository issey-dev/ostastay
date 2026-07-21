import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();

    // Osta staff can view any enterprise; anyone else can only view their own.
    if (!ctx.isInternal && ctx.enterpriseId !== id) {
      throw new ForbiddenError("Not authorized for this enterprise");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const enterprise = await prisma.enterprise.findUnique({
      where: { id },
      include: {
        license: true,
        properties: { orderBy: { createdAt: "desc" } },
        _count: { select: { users: true, properties: true } },
      },
    });
    if (!enterprise) {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }
    return NextResponse.json(enterprise);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can edit enterprises");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    const enterprise = await prisma.enterprise.update({
      where: { id },
      data: {
        name: body.name,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Enterprise",
      entityId: enterprise.id,
      description: `Updated enterprise "${enterprise.name}"`,
    });

    return NextResponse.json(enterprise);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
