import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { hashEregistrationToken } from "@/lib/eregistration/token";
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding";
import { OBSIDIAN_BLACK, STEEL_SLATE } from "@/lib/brand";
import { SmtpNotConfiguredError, PlatformSmtpNotConfiguredError } from "@/lib/mailer";
import { sendEnterpriseMail, MAIL_KINDS } from "@/lib/mail-sender";
import { primaryEmail } from "@/lib/profile-communications";
import { logActivity } from "@/lib/activity-log";

// The server never stores the plaintext token (only its hash — see
// src/lib/eregistration/token.ts), so this route can only send the link the client just
// received from a Generate/Regenerate call in the SAME session. The raw token is passed
// back here and re-verified against the stored hash before it's ever put in an email —
// it is never trusted on its own to identify the link.
function buildEregistrationEmailHtml(params: { reservation: any; settings: any; brandColor: string; url: string; expiresAt: Date }): string {
  const { reservation, settings, brandColor, url, expiresAt } = params;
  const brandName = settings.invoiceBrandName || reservation.property.name;
  const guestName = [reservation.primaryGuest.title, reservation.primaryGuest.firstName].filter(Boolean).join(" ") || "Guest";
  const message = settings.eRegistrationMessage || "Please complete your registration details ahead of arrival — it only takes a few minutes.";

  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: ${OBSIDIAN_BLACK};">
  <div style="border-bottom: 3px solid ${brandColor}; padding-bottom: 16px; margin-bottom: 24px;">
    ${settings.invoiceLogoUrl
      ? `<img src="${settings.invoiceLogoUrl}" alt="${brandName}" style="max-height: 56px; max-width: 220px;" />`
      : `<div style="font-size: 22px; font-weight: bold; color: ${brandColor};">${brandName}</div>`
    }
  </div>
  <p style="font-size: 14px;">Dear ${guestName},</p>
  <p style="font-size: 14px; line-height: 1.6;">${message}</p>
  <p style="text-align: center; margin: 28px 0;">
    <a href="${url}" style="background: ${brandColor}; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: bold;">Complete eRegistration</a>
  </p>
  <p style="font-size: 12px; color: ${STEEL_SLATE};">This link expires on ${expiresAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} and is personal to your reservation — please don't forward it.</p>
  <p style="font-size: 14px; margin-top: 24px;">We look forward to welcoming you.</p>
  <p style="font-size: 14px;">Warm regards,<br/>${brandName} Reservations Team</p>
</div>`.trim();
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (!body.token || typeof body.token !== "string") {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        primaryGuest: { include: { communications: true } },
        property: true,
      },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const tokenHash = hashEregistrationToken(body.token);
    const link = await prisma.eRegistrationLink.findFirst({
      where: { tokenHash, reservationId: id, status: "ACTIVE" },
    });
    if (!link) {
      return NextResponse.json({ error: "This link is no longer valid — regenerate it first." }, { status: 400 });
    }
    if (link.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "This link has expired — regenerate it first." }, { status: 400 });
    }

    const guestEmail = primaryEmail(reservation.primaryGuest.communications);
    if (!guestEmail) {
      return NextResponse.json({ error: "The primary guest has no email address on file." }, { status: 400 });
    }

    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: reservation.property.enterpriseId } });
    const brandColor = resolveInvoiceBrandColor(settings?.invoiceBrandColor ?? null);
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/eregistration/${body.token}`;
    const html = buildEregistrationEmailHtml({
      reservation,
      settings: settings ?? { invoiceBrandName: null, invoiceLogoUrl: null, eRegistrationMessage: null },
      brandColor,
      url,
      expiresAt: link.expiresAt,
    });

    try {
      await sendEnterpriseMail({
        enterpriseId: reservation.property.enterpriseId,
        kind: MAIL_KINDS.EREGISTRATION_LINK,
        to: guestEmail,
        subject: `Complete your eRegistration — ${reservation.confirmationNo} | ${reservation.property.name}`,
        html,
      });
    } catch (mailError) {
      if (mailError instanceof SmtpNotConfiguredError) {
        return NextResponse.json({ error: mailError.message }, { status: 400 });
      }
      if (mailError instanceof PlatformSmtpNotConfiguredError) {
        console.error("Platform SMTP is unconfigured but an enterprise relies on it:", mailError);
        return NextResponse.json(
          { error: "Email is temporarily unavailable — Uppsolut has been notified. Please try again shortly." },
          { status: 503 }
        );
      }
      console.error("Failed to send eRegistration email:", mailError);
      return NextResponse.json({ error: "Failed to send the email — check the SMTP settings and try again." }, { status: 502 });
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "EREGISTRATION_LINK_EMAIL",
      entityType: "Reservation",
      entityId: id,
      description: `Emailed the eRegistration link for ${reservation.confirmationNo} to ${guestEmail}`,
    });

    return NextResponse.json({ success: true, sentTo: guestEmail });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
