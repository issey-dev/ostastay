import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { saveUpload, readUpload, UploadValidationError, MAX_UPLOAD_BYTES } from "@/lib/eregistration/storage";

// A separate call from the JSON draft save — a flaky mobile upload shouldn't risk losing
// the rest of the already-typed form, and a guest can capture/replace the photo eagerly
// right after taking it, independent of when they finally finalize.
export async function POST(request: Request, { params }: { params: Promise<{ token: string; slotId: string }> }) {
  const { token, slotId } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  const reservationIds = await reservationIdsForLink(link);
  const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } });
  if (!slot) return NextResponse.json({ error: "Guest slot not found" }, { status: 404 });
  if (slot.status !== "PENDING") {
    return NextResponse.json({ error: "This guest's details have already been submitted." }, { status: 409 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES * 1.4) {
    // A little headroom over the raw cap for multipart framing overhead — the real,
    // authoritative check is on the parsed file bytes below.
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { relativePath, mimeType } = await saveUpload(buffer);
    await prisma.eRegistrationGuestSlot.update({ where: { id: slotId }, data: { idPhotoPath: relativePath, idPhotoMimeType: mimeType } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

// The guest's own preview of what they just uploaded, before finalizing.
export async function GET(request: Request, { params }: { params: Promise<{ token: string; slotId: string }> }) {
  const { token, slotId } = await params;
  const resolution = await resolveEregistrationLink(token);
  if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: resolution.status });
  const { link } = resolution;

  const reservationIds = await reservationIdsForLink(link);
  const slot = await prisma.eRegistrationGuestSlot.findFirst({ where: { id: slotId, reservationId: { in: reservationIds } } });
  if (!slot?.idPhotoPath) return NextResponse.json({ error: "No photo uploaded yet" }, { status: 404 });

  try {
    const buffer = await readUpload(slot.idPhotoPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": slot.idPhotoMimeType ?? "application/octet-stream", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
