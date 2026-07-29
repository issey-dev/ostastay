import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveEregistrationLink, reservationIdsForLink } from "@/lib/eregistration/resolve-link";
import { isValidSignatureDataUrl } from "@/lib/eregistration/storage";

// One-shot: requires the mandatory fields (server-side, not just trusting whatever the
// client's own form validation already did — this is a public, unauthenticated write
// path) plus a live signature, then locks the slot. Everything after this is staff-only
// (reopen, or apply into the live Profile records) — no further guest PATCH succeeds.
const REQUIRED_FIELDS = ["firstName", "lastName", "dateOfBirth", "nationality", "documentType", "documentNumber"] as const;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

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

  const missing = REQUIRED_FIELDS.filter((f) => !slot[f]);
  if (missing.length > 0) {
    return NextResponse.json({ error: `Please complete: ${missing.join(", ")}.` }, { status: 400 });
  }
  if (!isValidSignatureDataUrl(slot.signatureDataUrl)) {
    return NextResponse.json({ error: "A signature is required to complete eRegistration." }, { status: 400 });
  }

  const updated = await prisma.eRegistrationGuestSlot.update({
    where: { id: slotId },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      submittedIp: clientIp(request),
      submittedUserAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    },
  });

  // Informational only: when every slot for every reservation this link covers has
  // been submitted, mark the link COMPLETED for the staff-facing status display. A
  // slot's own lock (SUBMITTED/APPLIED) is what actually matters for correctness.
  const allReservationIds = await reservationIdsForLink(link);
  const remaining = await prisma.eRegistrationGuestSlot.count({
    where: { reservationId: { in: allReservationIds }, status: "PENDING" },
  });
  if (remaining === 0) {
    await prisma.eRegistrationLink.updateMany({
      where: { id: link.id, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  return NextResponse.json(updated);
}
