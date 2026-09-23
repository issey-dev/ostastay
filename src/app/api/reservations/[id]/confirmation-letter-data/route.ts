import { NextResponse } from "next/server";
import { loadDocumentSettings } from "@/lib/document-settings";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const CONFIRMATION_LETTER_INCLUDE = {
  primaryGuest: { include: { communications: true } },
  accompanyingGuests: { include: { profile: { include: { communications: true } } } },
  assignments: { include: { roomType: true }, orderBy: { startDate: "asc" as const } },
  property: true,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");

    const { id } = await params;
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: CONFIRMATION_LETTER_INCLUDE,
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const settings = await loadDocumentSettings(reservation.propertyId);

    return NextResponse.json({ reservation, settings });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
