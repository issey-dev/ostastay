import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Catalog management is gated by CONTROLS, same trust level as every other catalog
// (RatePlan, Allocation, Outlet, ExcursionType) — see SPA_PLAN.md §3 row 2. The SPA
// module itself is reserved for day-to-day booking operations only.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    const categories = await prisma.spaTreatmentCategory.findMany({
      where: { propertyId },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(categories);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    if (!body.propertyId || !body.name) {
      return NextResponse.json({ error: "Missing required fields (propertyId, name)" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "SPA");

    const category = await prisma.spaTreatmentCategory.create({
      data: {
        propertyId: body.propertyId,
        name: body.name,
        description: body.description || null,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : 0,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaTreatmentCategory", entityId: category.id,
      description: `Created spa treatment category "${category.name}"`,
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A category with this name already exists for this property" }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
