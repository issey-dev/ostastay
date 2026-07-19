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
      where: { id: targetFolioId }
    });

    if (!targetFolio) {
      return NextResponse.json({ error: "Target folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, targetFolio.propertyId);

    // Walk-in/outlet folios have no reservation to group charges under — moving charges
    // to or from one isn't a meaningful concept here (a walk-in's whole point is being
    // closed out on the spot), so it's rejected outright rather than falling through to
    // a reservationId comparison that would be meaningless (or, for two walk-ins,
    // wrongly permissive — null !== null is false).
    if (!targetFolio.reservationId) {
      return NextResponse.json({ error: "Cannot move charges to a walk-in folio" }, { status: 400 });
    }

    // Every line item must belong to a folio under the *same reservation* as the
    // target — moving a charge across guests/reservations, not just across an
    // enterprise boundary, would be a real billing bug, not just a tenant-scope one.
    const lineItems = await prisma.folioLineItem.findMany({
      where: { id: { in: lineItemIds } },
      include: { folio: true }
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
