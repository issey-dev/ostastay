import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding";
import { sendStationeryEmail } from "@/lib/send-stationery-email";
import { generateStationeryPdf } from "@/lib/stationery-pdf";
import { formatAllGuestNames, formatRoomCategories, nightsCount } from "@/lib/confirmation-letter";
import { logActivity } from "@/lib/activity-log";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function defaultPolicyText(checkInTime: string, checkOutTime: string): string {
  return `Check-in time is from ${checkInTime} and check-out time is until ${checkOutTime}. We kindly request that all guests carry a valid photo ID or passport upon arrival. This letter may be presented as confirmation of accommodation for immigration and travel purposes. Should your travel plans change, please notify us as early as possible so we can assist accordingly.`;
}

// Simple table-based layout with inline styles throughout — most email clients (Gmail,
// Outlook) strip <style> blocks and don't support modern CSS, so this deliberately
// does not share markup with the print page's Tailwind/JSX version, only the
// underlying content (see src/lib/confirmation-letter.ts).
function buildConfirmationEmailHtml(params: {
  reservation: any;
  settings: any;
  brandColor: string;
}): string {
  const { reservation, settings, brandColor } = params;
  const guestNames = formatAllGuestNames(reservation);
  const roomCategories = formatRoomCategories(reservation.assignments);
  const nights = nightsCount(reservation.checkInDate, reservation.checkOutDate);
  const brandName = settings.invoiceBrandName || reservation.property.name;
  const policyText = settings.confirmationLetterMessage || defaultPolicyText(reservation.property.checkInTime, reservation.property.checkOutTime);

  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: #1f2937;">
  <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px;">
    ${settings.invoiceLogoUrl
      ? `<img src="${settings.invoiceLogoUrl}" alt="${brandName}" style="max-height: 56px; max-width: 220px;" />`
      : `<div style="font-size: 22px; font-weight: bold; color: ${brandColor};">${brandName}</div>`
    }
  </div>

  <p style="font-size: 14px;">Dear ${guestNames[0]},</p>

  <p style="font-size: 14px; line-height: 1.6;">
    We are pleased to confirm your upcoming reservation with us. Please find your booking
    details below.
  </p>

  <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 20px 0;">
    <tr><td style="padding: 6px 0; color: #6b7280; width: 40%;">Confirmation No.</td><td style="padding: 6px 0; font-weight: bold;">${reservation.confirmationNo}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">Guest Name(s)</td><td style="padding: 6px 0; font-weight: bold;">${guestNames.join(", ")}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">Stay Period</td><td style="padding: 6px 0; font-weight: bold;">${formatDate(reservation.checkInDate)} &ndash; ${formatDate(reservation.checkOutDate)}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">Nights</td><td style="padding: 6px 0; font-weight: bold;">${nights}</td></tr>
    <tr><td style="padding: 6px 0; color: #6b7280;">Room Category</td><td style="padding: 6px 0; font-weight: bold;">${roomCategories.join(", ") || "TBA"}</td></tr>
    ${reservation.remarks ? `<tr><td style="padding: 6px 0; color: #6b7280;">Remarks</td><td style="padding: 6px 0;">${reservation.remarks}</td></tr>` : ""}
  </table>

  <p style="font-size: 13px; line-height: 1.6; color: #374151;">${policyText}</p>

  <p style="font-size: 14px; margin-top: 24px;">We look forward to welcoming you.</p>
  <p style="font-size: 14px;">Warm regards,<br/>${brandName} Reservations Team</p>

  <div style="border-top: 1px solid #e5e7eb; margin-top: 24px; padding-top: 12px; font-size: 12px; color: #6b7280;">
    ${settings.invoiceAddress ? `${settings.invoiceAddress}<br/>` : ""}
    ${settings.invoicePhone ? `${settings.invoicePhone}` : ""}${settings.invoicePhone && settings.invoiceEmail ? " &middot; " : ""}${settings.invoiceEmail || ""}
  </div>
</div>`.trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const { email, slug } = await request.json();
    if (!email || !slug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        primaryGuest: { include: { communications: true } },
        accompanyingGuests: { include: { profile: { include: { communications: true } } } },
        assignments: { include: { roomType: true }, orderBy: { startDate: "asc" } },
        property: true,
      },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: reservation.property.enterpriseId },
    });

    const brandColor = resolveInvoiceBrandColor(settings?.invoiceBrandColor ?? null);
    const html = buildConfirmationEmailHtml({
      reservation,
      settings: settings ?? {
        invoiceBrandName: null, invoiceLogoUrl: null, invoiceAddress: null,
        invoicePhone: null, invoiceEmail: null, confirmationLetterMessage: null,
      },
      brandColor,
    });

    const result = await sendStationeryEmail({
      enterpriseId: reservation.property.enterpriseId,
      to: email,
      subject: `Booking Confirmation — ${reservation.confirmationNo} | ${reservation.property.name}`,
      html,
      pdfPath: `/e/${slug}/dashboard/reservations/${id}/confirmation-letter`,
      pdfFilename: `Confirmation-${reservation.confirmationNo}.pdf`,
      authToken,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "SEND_CONFIRMATION",
      entityType: "Reservation",
      entityId: reservation.id,
      description: `Emailed booking confirmation ${reservation.confirmationNo} to ${email}`,
    });

    return NextResponse.json({ success: true, sentTo: email });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      select: { propertyId: true, confirmationNo: true },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const authToken = (await cookies()).get("auth_token")?.value;
    if (!authToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const pdfBuffer = await generateStationeryPdf(
      `/e/${slug}/dashboard/reservations/${id}/confirmation-letter`,
      authToken
    );

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Confirmation-${reservation.confirmationNo}.pdf"`,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
