import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { voidPostedCharge, actorDisplayName } from "@/lib/posting/void-charge";

// Voids a posted charge — the ONLY sanctioned way to correct a mis-posted line item.
// Never deletes: the row stays on the folio flagged isVoid (every balance/print/
// checkout calculation already excludes voided lines), so the correction itself is
// visible history rather than a silent rewrite. Mirrors how real PMS ledgers handle
// corrections as reversals, sized down for this product.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const { id: folioId, itemId } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to void a charge" }, { status: 400 });
    }

    const lineItem = await prisma.folioLineItem.findUnique({
      where: { id: itemId },
      include: { folio: true },
    });
    if (!lineItem || lineItem.folioId !== folioId) {
      return NextResponse.json({ error: "Charge not found on this folio" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, lineItem.folio.propertyId);

    if (lineItem.isVoid) {
      return NextResponse.json({ error: "This charge is already voided" }, { status: 400 });
    }
    // A closed folio is a finalized document (checkout settled it, or it became a
    // debtor invoice) — its history is immutable. Corrections at that point are an
    // adjustment/refund conversation, not a silent void.
    if (lineItem.folio.isClosed) {
      return NextResponse.json({ error: "Cannot void a charge on a closed folio" }, { status: 400 });
    }

    // Voids the charge together with the tax/service lines it generated, and writes the
    // reservation trace — see src/lib/posting/void-charge.ts.
    const updated = await prisma.$transaction(async (tx) => {
      await voidPostedCharge(tx, { lineItemId: itemId, reason, actorName: await actorDisplayName(tx, ctx.userId) });
      return tx.folioLineItem.findUniqueOrThrow({ where: { id: itemId } });
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "VOID",
      entityType: "FolioLineItem",
      entityId: itemId,
      description: `Voided charge "${lineItem.description}" ($${(lineItem.amount + lineItem.taxAmount + (lineItem.serviceChargeAmount || 0)).toFixed(2)}) — ${reason}`,
    });

    return NextResponse.json({ success: true, lineItem: updated });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
