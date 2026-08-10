import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { getPlatformSmtpConfig, getPlatformAlertRecipients, verifySmtp } from "@/lib/mailer";
import { sendPlatformMail, MAIL_KINDS } from "@/lib/mail-sender";
import { buildSmtpTestEmail, appBaseUrl } from "@/lib/email-templates";
import { PRODUCT_NAME } from "@/lib/brand";

// The platform's OWN mail sender — the account that sends enterprise handover credentials
// and channel-manager alerts (see the two-sender note in src/lib/mailer.ts).
//
// READ-ONLY by design. This reports what the environment is configured with and lets an
// operator prove it works; it deliberately offers no way to CHANGE it. Platform SMTP is a
// deployment concern living in the container's environment, and an endpoint that could
// rewrite the platform's own sending identity would be a standing route to sending mail as
// Uppsolut — worth more than any convenience it would buy. Editing it means editing the
// environment and restarting, which is also what makes the value auditable.

export async function GET() {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view platform mail settings");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const smtp = getPlatformSmtpConfig();
    const alertRecipients = getPlatformAlertRecipients();

    // The password is never returned in any form, not even masked by length.
    return NextResponse.json({
      configured: smtp !== null,
      host: smtp?.host ?? null,
      port: smtp?.port ?? null,
      username: smtp?.username ?? null,
      fromAddress: smtp?.fromAddress ?? null,
      fromName: smtp?.fromName ?? null,
      useTls: smtp?.useTls ?? null,
      alertRecipients,
      appUrl: appBaseUrl(),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/**
 * Verify the platform sender, and optionally send a real test message.
 *
 * Same two modes as the tenant test route: without `to` this only authenticates; with `to`
 * it performs an actual delivery, which is the only way to find out whether the provider
 * will accept the envelope rather than just the login.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can test platform mail");
    }
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json().catch(() => null);
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    if (to && !to.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address to send the test to." }, { status: 400 });
    }

    const smtp = getPlatformSmtpConfig();
    if (!smtp) {
      return NextResponse.json(
        {
          error:
            "Platform SMTP is not configured — set PLATFORM_SMTP_HOST, PLATFORM_SMTP_USERNAME, " +
            "PLATFORM_SMTP_PASSWORD and PLATFORM_SMTP_FROM_ADDRESS in the environment.",
        },
        { status: 400 }
      );
    }

    const verified = await verifySmtp(smtp);
    if (!verified.ok) {
      return NextResponse.json({ ok: false, stage: "connect", error: verified.error });
    }

    if (!to) {
      return NextResponse.json({ ok: true, stage: "connect", sentTo: null });
    }

    const mail = buildSmtpTestEmail({ sender: PRODUCT_NAME });
    try {
      await sendPlatformMail({ kind: MAIL_KINDS.SMTP_TEST, to, subject: mail.subject, html: mail.html, text: mail.text });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        stage: "send",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    return NextResponse.json({ ok: true, stage: "send", sentTo: to });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
