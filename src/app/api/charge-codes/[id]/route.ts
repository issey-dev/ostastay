import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// PAYMENT removed — payment types are Payment Methods, not charge codes.
const CATEGORIES = ["ROOM", "FOOD_BEVERAGE", "TRANSPORTATION", "OTHERS", "TAX", "SYSTEM", "NON_REVENUE"];

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    if (!body.code || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (body.category && !CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const existing = await prisma.chargeCode.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    const useDefaultTax = body.useDefaultTax !== undefined ? !!body.useDefaultTax : existing.useDefaultTax;
    let taxProfileId: string | null = null;
    if (!useDefaultTax) {
      if (!body.taxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when not using the default tax" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = body.taxProfileId;
    }

    const updatedChargeCode = await prisma.chargeCode.update({
      where: { id },
      data: {
        code: body.code.toUpperCase(),
        description: body.description,
        category: body.category ?? existing.category,
        useDefaultTax,
        taxProfileId,
      },
      include: {
        taxProfile: {
          include: {
            rates: {
              orderBy: { effectiveFrom: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "ChargeCode",
      entityId: updatedChargeCode.id,
      description: `Updated charge code ${updatedChargeCode.code} — ${updatedChargeCode.description}`,
    });

    return NextResponse.json(updatedChargeCode);
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
    const existing = await prisma.chargeCode.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    // Optional Check: Is this charge code already used in FolioLineItems?
    const existingFolios = await prisma.folioLineItem.findFirst({
      where: { chargeCodeId: id }
    });

    if (existingFolios) {
      return NextResponse.json(
        { error: "Cannot delete this Charge Code as it is currently linked to active Folio Line Items." },
        { status: 400 }
      );
    }

    await prisma.chargeCode.delete({
      where: { id },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "ChargeCode",
      entityId: id,
      description: `Deleted charge code ${existing.code} — ${existing.description}`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
