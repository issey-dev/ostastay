import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { ALLOCATION_TYPES, POSTING_RHYTHMS, ALLOCATION_MODES, parseRatesInput } from "@/lib/allocations";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REVENUE", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.allocation.findUnique({
      where: { id },
      include: { property: { select: { enterpriseId: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    if (body.type && !ALLOCATION_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${ALLOCATION_TYPES.join(", ")}` }, { status: 400 });
    }
    if (body.postingRhythm && !POSTING_RHYTHMS.includes(body.postingRhythm)) {
      return NextResponse.json({ error: `postingRhythm must be one of ${POSTING_RHYTHMS.join(", ")}` }, { status: 400 });
    }
    if (body.mode && !ALLOCATION_MODES.includes(body.mode)) {
      return NextResponse.json({ error: `mode must be one of ${ALLOCATION_MODES.join(", ")}` }, { status: 400 });
    }

    if (body.chargeCodeId && body.chargeCodeId !== existing.chargeCodeId) {
      const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
      if (!chargeCode || chargeCode.enterpriseId !== existing.property.enterpriseId) {
        return NextResponse.json({ error: "Charge code does not belong to this enterprise" }, { status: 400 });
      }
    }

    // `rates` (when provided) is a full replacement of the dated price rows — the UI
    // always submits the complete set, which keeps overlap validation whole-set.
    let ratesUpdate: { deleteMany: object; create: Array<{ adultPrice: number; childPrice: number; effectiveFrom: Date; effectiveTo: Date | null }> } | undefined;
    if (body.rates !== undefined) {
      const parsed = parseRatesInput(body.rates);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      ratesUpdate = { deleteMany: {}, create: parsed.rates };
    }

    const allocation = await prisma.allocation.update({
      where: { id },
      data: {
        code: body.code ? String(body.code).toUpperCase() : undefined,
        name: body.name ?? undefined,
        type: body.type ?? undefined,
        chargeCodeId: body.chargeCodeId ?? undefined,
        postingRhythm: body.postingRhythm ?? undefined,
        mode: body.mode ?? undefined,
        sellSeparate: body.sellSeparate !== undefined ? !!body.sellSeparate : undefined,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined,
        rates: ratesUpdate,
      },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        rates: { orderBy: { effectiveFrom: "asc" } },
      },
    });

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "UPDATE",
      entityType: "Allocation",
      entityId: allocation.id,
      description: `Updated allocation "${allocation.name}" (${allocation.code})`,
    });

    return NextResponse.json(allocation);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An allocation with this code already exists for this property" }, { status: 400 });
    }
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
    requirePermission(ctx, "REVENUE", "delete");

    const { id } = await params;
    const existing = await prisma.allocation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Reservations referencing this allocation block deletion (the FK is RESTRICT on
    // purpose) — deactivating preserves history while hiding it from new use.
    const usageCount = await prisma.reservationAllocation.count({ where: { allocationId: id } });
    if (usageCount > 0) {
      return NextResponse.json(
        { error: "This allocation is attached to reservations and cannot be deleted — deactivate it instead" },
        { status: 400 }
      );
    }

    await prisma.allocation.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "REVENUE",
      action: "DELETE",
      entityType: "Allocation",
      entityId: id,
      description: `Deleted allocation "${existing.name}" (${existing.code})`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
