import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const body = await request.json();
    const { lineItemIds, targetFolioId } = body;

    if (!lineItemIds || !Array.isArray(lineItemIds) || lineItemIds.length === 0 || !targetFolioId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify target folio exists and belongs to a property this actor can reach
    const targetFolio = await prisma.folio.findUnique({
      where: { id: targetFolioId }
    });

    if (!targetFolio) {
      return NextResponse.json({ error: "Target folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, targetFolio.propertyId);
    if (targetFolio.isClosed) {
      return NextResponse.json({ error: "Cannot move charges to a closed folio" }, { status: 400 });
    }

    // Charges can be moved to any open folio at the SAME property — another window on
    // the same reservation, or another in-house room's folio (front-desk "bill this to
    // that room"). Moving ACROSS properties is still a real billing bug, so every
    // source line item's folio must share the target's property.
    const lineItems = await prisma.folioLineItem.findMany({
      where: { id: { in: lineItemIds } },
      include: { folio: true }
    });
    if (
      lineItems.length !== lineItemIds.length ||
      lineItems.some((li) => li.folio.propertyId !== targetFolio.propertyId)
    ) {
      return NextResponse.json({ error: "One or more charges are not at this property" }, { status: 400 });
    }

    // Move the line items
    await prisma.folioLineItem.updateMany({
      where: {
        id: { in: lineItemIds }
      },
      data: {
        folioId: targetFolioId
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "UPDATE",
      entityType: "Folio",
      entityId: targetFolioId,
      description: `Moved ${lineItemIds.length} charge${lineItemIds.length > 1 ? "s" : ""} to folio #${targetFolio.folioNumber}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
