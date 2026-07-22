import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Standing routing instructions for a reservation: charges of the chosen codes are
// auto-routed to a target folio (another window on this reservation, or another
// in-house room's folio) when posted by Night Audit or manual posting. Creating a
// rule also moves any already-posted matching charges (apply-now).

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const rules = await prisma.folioRoutingRule.findMany({
      where: { reservationId: id },
      include: {
        chargeCode: { select: { id: true, code: true, description: true } },
        targetFolio: {
          select: {
            id: true, folioNumber: true, reservationId: true,
            reservation: { select: { confirmationNo: true, primaryGuest: { select: { firstName: true, lastName: true } }, assignments: { include: { room: true } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(rules);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

const createSchema = z.object({
  chargeCodeIds: z.array(z.string().min(1)).min(1),
  targetFolioId: z.string().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");
    const { id } = await params;

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid routing payload", details: parsed.error.flatten() }, { status: 400 });
    }
    const { chargeCodeIds, targetFolioId } = parsed.data;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { folios: { select: { id: true, isClosed: true } } },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    // Target folio must be a real, open folio at the SAME property (a window on this
    // reservation, or another in-house room's folio).
    const targetFolio = await prisma.folio.findUnique({ where: { id: targetFolioId } });
    if (!targetFolio || targetFolio.propertyId !== reservation.propertyId) {
      return NextResponse.json({ error: "Target folio not found at this property" }, { status: 404 });
    }
    if (targetFolio.isClosed) {
      return NextResponse.json({ error: "Cannot route to a closed folio" }, { status: 400 });
    }
    if (reservation.folios.some((f) => f.id === targetFolioId)) {
      // routing to a window on the same reservation is fine
    }

    // Validate charge codes belong to the enterprise.
    const codes = await prisma.chargeCode.findMany({ where: { id: { in: chargeCodeIds }, enterpriseId: ctx.enterpriseId } });
    if (codes.length !== chargeCodeIds.length) {
      return NextResponse.json({ error: "One or more charge codes were not found" }, { status: 404 });
    }

    const sourceFolioIds = reservation.folios.map((f) => f.id);
    let movedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const chargeCodeId of chargeCodeIds) {
        await tx.folioRoutingRule.upsert({
          where: { reservationId_chargeCodeId: { reservationId: id, chargeCodeId } },
          update: { targetFolioId, createdByUserId: ctx.userId },
          create: { reservationId: id, chargeCodeId, targetFolioId, createdByUserId: ctx.userId },
        });

        // Apply-now: move already-posted, non-void matching charges from this
        // reservation's OTHER folios onto the target.
        const moved = await tx.folioLineItem.updateMany({
          where: {
            chargeCodeId,
            isVoid: false,
            folioId: { in: sourceFolioIds.filter((fid) => fid !== targetFolioId) },
          },
          data: { folioId: targetFolioId },
        });
        movedCount += moved.count;
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "CREATE",
      entityType: "FolioRoutingRule",
      entityId: id,
      description: `Set routing for ${codes.map((c) => c.code).join(", ")} → folio #${targetFolio.folioNumber}${movedCount > 0 ? ` (${movedCount} existing charge${movedCount > 1 ? "s" : ""} moved)` : ""}`,
    });

    return NextResponse.json({ success: true, movedCount });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");
    const { id } = await params;
    const ruleId = new URL(request.url).searchParams.get("ruleId");
    if (!ruleId) return NextResponse.json({ error: "ruleId is required" }, { status: 400 });

    const rule = await prisma.folioRoutingRule.findUnique({
      where: { id: ruleId },
      include: { reservation: { select: { id: true, propertyId: true } } },
    });
    if (!rule || rule.reservationId !== id) {
      return NextResponse.json({ error: "Routing rule not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, rule.reservation.propertyId);

    await prisma.folioRoutingRule.delete({ where: { id: ruleId } });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "DELETE",
      entityType: "FolioRoutingRule",
      entityId: ruleId,
      description: `Removed a folio routing rule`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
