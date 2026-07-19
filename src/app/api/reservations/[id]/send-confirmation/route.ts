import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding";
import { sendMail, SmtpNotConfiguredError } from "@/lib/mailer";
import { formatAllGuestNames, formatRoomCategories, nightsCount } from "@/lib/confirmation-letter";

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
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        primaryGuest: { include: { contacts: true } },
        accompanyingGuests: { include: { profile: { include: { contacts: true } } } },
        assignments: { include: { roomType: true }, orderBy: { startDate: "asc" } },
        property: true,
      },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    const guestEmail =
      reservation.primaryGuest.contacts.find((c) => c.isPrimary)?.email ||
      reservation.primaryGuest.contacts[0]?.email;
    if (!guestEmail) {
      return NextResponse.json({ error: "The primary guest has no email address on file." }, { status: 400 });
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

    try {
      await sendMail({
        settings: settings ?? { smtpHost: null, smtpPort: null, smtpUsername: null, smtpPassword: null, smtpFromAddress: null, smtpUseTls: true },
        to: guestEmail,
        subject: `Booking Confirmation — ${reservation.confirmationNo} | ${reservation.property.name}`,
        html,
      });
    } catch (mailError) {
      if (mailError instanceof SmtpNotConfiguredError) {
        return NextResponse.json({ error: mailError.message }, { status: 400 });
      }
      console.error("Failed to send confirmation email:", mailError);
      return NextResponse.json(
        { error: "Failed to send the confirmation email — check the SMTP settings and try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, sentTo: guestEmail });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
