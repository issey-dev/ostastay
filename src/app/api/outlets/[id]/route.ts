import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { OUTLET_TYPES, TAX_OVERRIDE_MODES } from "../route";
import { logActivity } from "@/lib/activity-log";

const OUTLET_INCLUDE = {
  taxProfile: { include: { rates: true } },
  chargeCodes: { include: { chargeCode: true } },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const outlet = await prisma.outlet.findUnique({ where: { id }, include: OUTLET_INCLUDE });
    if (!outlet) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, outlet.propertyId);

    return NextResponse.json(outlet);
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
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.outlet.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    const outletType = body.outletType !== undefined
      ? (OUTLET_TYPES.includes(body.outletType) ? body.outletType : "OTHER")
      : existing.outletType;
    const taxOverrideMode = body.taxOverrideMode !== undefined
      ? (TAX_OVERRIDE_MODES.includes(body.taxOverrideMode) ? body.taxOverrideMode : "NONE")
      : existing.taxOverrideMode;

    let taxProfileId: string | null = existing.taxProfileId;
    if (taxOverrideMode === "CUSTOM") {
      const requestedTaxProfileId = body.taxProfileId !== undefined ? body.taxProfileId : existing.taxProfileId;
      if (!requestedTaxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when the tax override mode is Custom" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: requestedTaxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = requestedTaxProfileId;
    } else if (taxOverrideMode !== "CUSTOM") {
      taxProfileId = null;
    }

    let appointmentCapPerSlot = existing.appointmentCapPerSlot;
    if (body.appointmentCapPerSlot !== undefined) {
      appointmentCapPerSlot = body.appointmentCapPerSlot === null || body.appointmentCapPerSlot === ""
        ? null
        : parseInt(body.appointmentCapPerSlot);
    }

    let chargeCodeIds: string[] | undefined = undefined;
    if (Array.isArray(body.chargeCodeIds)) {
      chargeCodeIds = body.chargeCodeIds;
      if (chargeCodeIds!.length > 0) {
        const chargeCodes = await prisma.chargeCode.findMany({ where: { id: { in: chargeCodeIds } } });
        if (chargeCodes.length !== chargeCodeIds!.length || chargeCodes.some((cc) => cc.enterpriseId !== ctx.enterpriseId)) {
          return NextResponse.json({ error: "One or more charge codes were not found" }, { status: 404 });
        }
      }
    }

    const updatedOutlet = await prisma.$transaction(async (tx) => {
      const updated = await tx.outlet.update({
        where: { id },
        data: {
          name: body.name ?? existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
          outletType,
          taxOverrideMode,
          taxProfileId,
          appointmentCapPerSlot,
        },
      });

      // Resync the curated charge-code pool by diffing against what's already there,
      // rather than deleteMany+createMany — keeps createdAt stable for codes that stay
      // in the pool across an edit.
      if (chargeCodeIds !== undefined) {
        const current = await tx.outletChargeCode.findMany({ where: { outletId: id } });
        const currentIds = new Set(current.map((c) => c.chargeCodeId));
        const nextIds = new Set(chargeCodeIds);

        const toRemove = current.filter((c) => !nextIds.has(c.chargeCodeId));
        const toAdd = chargeCodeIds!.filter((cid) => !currentIds.has(cid));

        if (toRemove.length > 0) {
          await tx.outletChargeCode.deleteMany({ where: { id: { in: toRemove.map((c) => c.id) } } });
        }
        if (toAdd.length > 0) {
          await tx.outletChargeCode.createMany({ data: toAdd.map((chargeCodeId) => ({ outletId: id, chargeCodeId })) });
        }
      }

      return tx.outlet.findUniqueOrThrow({ where: { id }, include: OUTLET_INCLUDE });
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Outlet",
      entityId: updatedOutlet.id,
      description: `Updated outlet "${updatedOutlet.name}"`,
    });

    return NextResponse.json(updatedOutlet);
  } catch (error) {
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
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.outlet.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Never lose revenue/appointment history — same never-hard-delete-what-happened
    // pattern as RoomType.isActive. Deactivation (PATCH {isActive: false}) is the
    // primary path once an outlet has any real activity.
    const [lineItemCount, appointmentCount] = await Promise.all([
      prisma.folioLineItem.count({ where: { outletId: id } }),
      prisma.outletAppointment.count({ where: { outletId: id } }),
    ]);
    if (lineItemCount > 0 || appointmentCount > 0) {
      return NextResponse.json(
        { error: "Cannot delete an outlet with posted revenue or appointment history — deactivate it instead." },
        { status: 400 }
      );
    }

    await prisma.outlet.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "Outlet",
      entityId: id,
      description: `Deleted outlet "${existing.name}"`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
