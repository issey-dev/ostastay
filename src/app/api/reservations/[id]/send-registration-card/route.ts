import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { generateStationeryPdf } from "@/lib/stationery-pdf";
import { sendStationeryEmail } from "@/lib/send-stationery-email";
import { logActivity } from "@/lib/activity-log";

// A registration card is per-guest (see the print page), so both handlers below resolve
// the SAME target profile the page itself would show — the ?guest= upid if given and
// still one of this reservation's people, else the primary guest — rather than always
// mailing/downloading the primary guest's copy.
const SEND_INCLUDE = {
  primaryGuest: { select: { upid: true, companyName: true, title: true, firstName: true, middleName: true, lastName: true } },
  accompanyingGuests: {
    include: { profile: { select: { upid: true, companyName: true, title: true, firstName: true, middleName: true, lastName: true } } },
  },
  property: { include: { enterprise: true } },
} as const;

type ReservationForSend = NonNullable<Awaited<ReturnType<typeof loadReservation>>>;

function loadReservation(id: string) {
  return prisma.reservation.findUnique({ where: { id }, include: SEND_INCLUDE });
}

function resolveTargetGuest(reservation: ReservationForSend, guestUpid?: string | null) {
  const people = [reservation.primaryGuest, ...reservation.accompanyingGuests.map((a) => a.profile)];
  if (guestUpid) return people.find((p) => p.upid === guestUpid) ?? reservation.primaryGuest;
  return reservation.primaryGuest;
}

function formatGuestName(guest: ReservationForSend["primaryGuest"]) {
  return guest.companyName || [guest.title, guest.firstName, guest.middleName, guest.lastName].filter(Boolean).join(" ");
}

function buildRegistrationCardEmailHtml(propertyName: string): string {
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
  <p style="font-size: 14px; line-height: 1.6;">
    Please find attached your registration card from ${propertyName}. Please review, sign, and return.
  </p>
</div>`.trim();
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const { email, slug, guest: guestUpid } = (await request.json()) as { email?: string; slug?: string; guest?: string };
    if (!email || !slug) {
      return NextResponse.json({ error: "Missing email or slug" }, { status: 400 });
    }

    const reservation = await loadReservation(id);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const guest = resolveTargetGuest(reservation, guestUpid);
    const authToken = (await cookies()).get("auth_token")?.value ?? "";

    const result = await sendStationeryEmail({
      enterpriseId: reservation.property.enterpriseId,
      to: email,
      subject: `Registration Card — ${reservation.confirmationNo} | ${reservation.property.name}`,
      html: buildRegistrationCardEmailHtml(reservation.property.name),
      pdfPath: `/e/${slug}/dashboard/reservations/${id}/registration-card${guestUpid ? `?guest=${guestUpid}` : ""}`,
      pdfFilename: `Registration-Card-${reservation.confirmationNo}.pdf`,
      authToken,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "SEND_REGISTRATION_CARD",
      entityType: "Reservation",
      entityId: reservation.id,
      description: `Emailed registration card for ${formatGuestName(guest)} (${reservation.confirmationNo}) to ${email}`,
    });

    return NextResponse.json({ ok: true, sentTo: email });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");

    const { id } = await params;
    const guestUpid = new URL(request.url).searchParams.get("guest") || undefined;

    const reservation = await loadReservation(id);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const guest = resolveTargetGuest(reservation, guestUpid);
    const authToken = (await cookies()).get("auth_token")?.value ?? "";

    const pdfPath = `/e/${reservation.property.enterprise.slug}/dashboard/reservations/${id}/registration-card${guestUpid ? `?guest=${guestUpid}` : ""}`;
    const pdfBuffer = await generateStationeryPdf(pdfPath, authToken);

    // Buffer<ArrayBufferLike> vs the DOM BodyInit type — the same pre-existing mismatch
    // every other stationery PDF-download GET has (send-confirmation, send-invoice,
    // send-receipt, send-statement).
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Registration-Card-${reservation.confirmationNo}-${formatGuestName(guest).replace(/\s+/g, "-")}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
