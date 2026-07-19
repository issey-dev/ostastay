import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

// Opens a standalone bill for a guest who has no reservation — a passerby using an
// outlet without staying. Once created, this folio is posted to and paid off exactly
// like a reservation-backed one (POST /api/pos/charge, POST /api/folios/[id]/payments)
// since both now key off Folio.propertyId rather than Folio.reservation.propertyId.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "create");

    const body = await request.json();
    const { propertyId, walkInGuestName, walkInGuestContact } = body;

    if (!propertyId || !walkInGuestName) {
      return NextResponse.json({ error: "propertyId and walkInGuestName are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const folio = await prisma.folio.create({
      data: {
        propertyId,
        folioNumber: 1,
        walkInGuestName,
        walkInGuestContact: walkInGuestContact || null,
      },
    });

    return NextResponse.json(folio, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
