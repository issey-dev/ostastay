import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { readUpload, UploadValidationError } from "@/lib/eregistration/storage";

// Staff-side authenticated fetch of a slot's uploaded ID photo — for review before/after
// apply. The private storage directory is never served statically; this is the only way
// staff see the image (mirroring the guest's own pre-finalize preview route).
export async function GET(request: Request, { params }: { params: Promise<{ id: string; slotId: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");
    const { id, slotId } = await params;

    const reservation = await prisma.reservation.findUnique({ where: { id }, select: { propertyId: true } });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: id } });
    if (!slot?.idPhotoPath) return NextResponse.json({ error: "No photo on file for this guest" }, { status: 404 });

    const buffer = await readUpload(slot.idPhotoPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": slot.idPhotoMimeType ?? "application/octet-stream", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
