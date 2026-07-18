import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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
      where: { id: targetFolioId },
      include: { reservation: true }
    });

    if (!targetFolio) {
      return NextResponse.json({ error: "Target folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, targetFolio.reservation.propertyId);

    // Every line item must belong to a folio under the *same reservation* as the
    // target — moving a charge across guests/reservations, not just across an
    // enterprise boundary, would be a real billing bug, not just a tenant-scope one.
    const lineItems = await prisma.folioLineItem.findMany({
      where: { id: { in: lineItemIds } },
      include: { folio: { include: { reservation: true } } }
    });
    if (
      lineItems.length !== lineItemIds.length ||
      lineItems.some((li) => li.folio.reservationId !== targetFolio.reservationId)
    ) {
      return NextResponse.json({ error: "One or more line items do not belong to this reservation" }, { status: 400 });
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

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
