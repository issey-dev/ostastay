import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { POSTING_TYPES, type PostingType } from "@/lib/posting/charge-tree";
import { CHARGE_CODE_INCLUDE } from "@/app/api/charge-codes/route";

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
      return NextResponse.json({ error: "Code and description are required" }, { status: 400 });
    }

    const existing = await prisma.chargeCode.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    const code = String(body.code).trim().toUpperCase();
    // A system code's identity is what resolveChargeCode falls back to, and what the
    // seeder re-adopts on the next run — renaming it would strand every role lookup.
    if (existing.isSystem && code !== existing.code) {
      return NextResponse.json(
        { error: "This is a system charge code — its code can't be changed. Its description, subgroup and tax handling are still editable." },
        { status: 400 }
      );
    }
    if (code !== existing.code) {
      const clash = await prisma.chargeCode.findUnique({
        where: { enterpriseId_code: { enterpriseId: ctx.enterpriseId, code } },
      });
      if (clash) return NextResponse.json({ error: `A charge code ${code} already exists` }, { status: 400 });
    }

    let chargeSubgroupId = existing.chargeSubgroupId;
    if (body.chargeSubgroupId && body.chargeSubgroupId !== existing.chargeSubgroupId) {
      const subgroup = await prisma.chargeSubgroup.findUnique({ where: { id: body.chargeSubgroupId } });
      if (!subgroup || subgroup.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Charge subgroup not found" }, { status: 404 });
      }
      chargeSubgroupId = subgroup.id;
    }

    const postingType: PostingType = POSTING_TYPES.includes(body.postingType)
      ? body.postingType
      : (existing.postingType as PostingType);

    const useDefaultTax = body.useDefaultTax !== undefined ? !!body.useDefaultTax : existing.useDefaultTax;
    let taxProfileId: string | null = null;
    if (!useDefaultTax && postingType !== "TAX") {
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
        code,
        description: body.description,
        chargeSubgroupId,
        postingType,
        isActive: body.isActive !== undefined ? !!body.isActive : existing.isActive,
        useDefaultTax,
        taxProfileId,
      },
      include: CHARGE_CODE_INCLUDE,
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

    // System codes back the role lookups Night Audit and billing depend on. Deactivate
    // rather than delete when one is genuinely unwanted.
    if (existing.isSystem) {
      return NextResponse.json(
        { error: "This is a system charge code and can't be deleted. Deactivate it instead if it isn't in use." },
        { status: 400 }
      );
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

    // Any generate row referencing it (either side) cascades via the schema's
    // onDelete: Cascade, so a deleted code can't leave a dangling cascade behind.
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
