import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.spaTreatmentCategory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const category = await prisma.spaTreatmentCategory.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        description: body.description !== undefined ? body.description || null : undefined,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTreatmentCategory", entityId: category.id,
      description: `Updated spa treatment category "${category.name}"`,
    });

    return NextResponse.json(category);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A category with this name already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.spaTreatmentCategory.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, existing.propertyId, "SPA");

    const treatmentCount = await prisma.spaTreatment.count({ where: { categoryId: id } });
    if (treatmentCount > 0) {
      return NextResponse.json(
        { error: "This category has treatments assigned and cannot be deleted — deactivate it instead" },
        { status: 400 }
      );
    }

    await prisma.spaTreatmentCategory.delete({ where: { id } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "SpaTreatmentCategory", entityId: id,
      description: `Deleted spa treatment category "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
