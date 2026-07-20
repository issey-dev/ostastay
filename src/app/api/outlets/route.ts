import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export const OUTLET_TYPES = ["SPA", "RESTAURANT", "BAR", "RETAIL", "TRANSPORT", "RECREATION", "OTHER"];
export const TAX_OVERRIDE_MODES = ["NONE", "DEFAULT_ENGINE", "CUSTOM"];

const OUTLET_INCLUDE = {
  taxProfile: { include: { rates: true } },
  chargeCodes: { include: { chargeCode: true } },
};

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const outlets = await prisma.outlet.findMany({
      where: { propertyId },
      include: OUTLET_INCLUDE,
      orderBy: { name: "asc" },
    });
    return NextResponse.json(outlets);
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

    if (!body.name || !body.propertyId) {
      return NextResponse.json({ error: "Name and Property ID are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const outletType = OUTLET_TYPES.includes(body.outletType) ? body.outletType : "OTHER";
    const taxOverrideMode = TAX_OVERRIDE_MODES.includes(body.taxOverrideMode) ? body.taxOverrideMode : "NONE";

    let taxProfileId: string | null = null;
    if (taxOverrideMode === "CUSTOM") {
      if (!body.taxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when the tax override mode is Custom" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = body.taxProfileId;
    }

    const chargeCodeIds: string[] = Array.isArray(body.chargeCodeIds) ? body.chargeCodeIds : [];
    if (chargeCodeIds.length > 0) {
      const chargeCodes = await prisma.chargeCode.findMany({ where: { id: { in: chargeCodeIds } } });
      if (chargeCodes.length !== chargeCodeIds.length || chargeCodes.some((cc) => cc.enterpriseId !== ctx.enterpriseId)) {
        return NextResponse.json({ error: "One or more charge codes were not found" }, { status: 404 });
      }
    }

    const appointmentCapPerSlot = body.appointmentCapPerSlot !== undefined && body.appointmentCapPerSlot !== null && body.appointmentCapPerSlot !== ""
      ? parseInt(body.appointmentCapPerSlot)
      : null;

    const newOutlet = await prisma.outlet.create({
      data: {
        propertyId: body.propertyId,
        name: body.name,
        description: body.description || null,
        outletType,
        taxOverrideMode,
        taxProfileId,
        appointmentCapPerSlot,
        chargeCodes: chargeCodeIds.length > 0 ? { create: chargeCodeIds.map((id) => ({ chargeCodeId: id })) } : undefined,
      },
      include: OUTLET_INCLUDE,
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Outlet",
      entityId: newOutlet.id,
      description: `Created outlet "${newOutlet.name}" (${outletType})`,
    });

    return NextResponse.json(newOutlet, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
