import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, hasPermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Property-level Excursions settings — currently just the optional module-level Outlet
// link. Same "missing row = defaults/unlinked" convention as SpaSettings: GET never
// creates a row, PUT upserts one.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "EXCURSIONS");
    // Readable by an EXCURSIONS booking user OR a CONTROLS catalog manager.
    if (!hasPermission(ctx, "EXCURSIONS", "view") && !hasPermission(ctx, "CONTROLS", "view")) {
      throw new ForbiddenError("Missing view permission on Excursions");
    }

    const settings = await prisma.excursionSettings.findUnique({ where: { propertyId } });
    return NextResponse.json(settings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "EXCURSIONS");

    // Accept an outlet of the same property, or null/"" to unlink.
    let outletId: string | null = null;
    if (body.outletId !== undefined && body.outletId !== null && body.outletId !== "") {
      const outlet = await prisma.outlet.findUnique({ where: { id: body.outletId } });
      if (!outlet || outlet.propertyId !== body.propertyId) {
        return NextResponse.json({ error: "Outlet not found for this property" }, { status: 404 });
      }
      outletId = outlet.id;
    }

    const settings = await prisma.excursionSettings.upsert({
      where: { propertyId: body.propertyId },
      update: { outletId },
      create: { propertyId: body.propertyId, outletId },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "ExcursionSettings", entityId: settings.propertyId,
      description: "Updated excursion module settings",
    });

    return NextResponse.json(settings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
