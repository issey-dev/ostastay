import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { verifySmtp, SmtpNotConfiguredError, PlatformSmtpNotConfiguredError } from "@/lib/mailer";
import { sendEnterpriseMail, resolveEnterpriseSender, MAIL_KINDS, MAIL_SENDER } from "@/lib/mail-sender";
import { buildSmtpTestEmail } from "@/lib/email-templates";
import { logActivity } from "@/lib/activity-log";

// Check the sender this enterprise's guest mail actually goes out through.
//
// That is deliberately NOT "the enterprise's own SMTP": since the PLATFORM_EMAIL add-on
// (2026-08-10) an enterprise with no SMTP of its own may be sending through Uppsolut's.
// A test that only ever exercised the tenant's own credentials would report "not
// configured" to a customer whose mail is working perfectly well — so this resolves the
// sender the same way a real send does, and says which one it used.
//
// Two modes, because they answer different questions and fail for different reasons:
//
//   no `to`   — authenticate only. Proves host/port/TLS/credentials. Fast, sends nothing.
//   with `to` — a real delivery. This is the only thing that proves the sending domain is
//               verified with the provider and that mail actually arrives; a hosted relay
//               will happily authenticate and then refuse the envelope (Amazon SES in
//               sandbox mode rejects any unverified recipient exactly this way).
//
// Tests the SAVED settings, not whatever is on screen — the form must be saved first. That
// keeps the stored password out of the request body: the settings form only ever holds a
// mask for an existing password, so accepting form values here would mean either testing
// with a literal "********" or shipping the real secret back and forth.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const body = await request.json().catch(() => null);
    const to = typeof body?.to === "string" ? body.to.trim() : "";
    if (to && !to.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address to send the test to." }, { status: 400 });
    }

    let choice;
    try {
      choice = await resolveEnterpriseSender(ctx.enterpriseId);
    } catch (e) {
      if (e instanceof SmtpNotConfiguredError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      if (e instanceof PlatformSmtpNotConfiguredError) {
        // They are paying for the mail service and it is our end that is unconfigured.
        console.error("Platform SMTP is unconfigured but an enterprise relies on it:", e);
        return NextResponse.json(
          { error: "Email is temporarily unavailable — Uppsolut has been notified." },
          { status: 503 }
        );
      }
      // Decryption failure: SECRETS_ENCRYPTION_KEY changed after values were encrypted.
      // A configuration fault worth naming rather than reporting as "auth failed".
      console.error("Could not resolve the enterprise mail sender:", e);
      return NextResponse.json(
        { error: "The stored SMTP password could not be read — check SECRETS_ENCRYPTION_KEY, then re-enter it." },
        { status: 500 }
      );
    }

    const verified = await verifySmtp(choice.smtp);
    if (!verified.ok) {
      return NextResponse.json({ ok: false, stage: "connect", sender: choice.sender, error: verified.error });
    }

    if (!to) {
      return NextResponse.json({ ok: true, stage: "connect", sender: choice.sender, sentTo: null });
    }

    const mail = buildSmtpTestEmail({
      sender: choice.sender === MAIL_SENDER.PLATFORM ? "the Uppsolut Mail Service" : "your property",
    });
    try {
      await sendEnterpriseMail({
        enterpriseId: ctx.enterpriseId,
        kind: MAIL_KINDS.SMTP_TEST,
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        stage: "send",
        sender: choice.sender,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      // Keyed on the enterprise, not its settings row: the thing tested is the enterprise's
      // sender, which may be Uppsolut's and therefore not described by that row at all.
      entityType: "Enterprise",
      entityId: ctx.enterpriseId,
      description: `Sent an SMTP test email to ${to} via the ${choice.sender === MAIL_SENDER.PLATFORM ? "Uppsolut Mail Service" : "property's own SMTP"}`,
    });

    return NextResponse.json({ ok: true, stage: "send", sender: choice.sender, sentTo: to });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
