import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { sendMail, verifySmtp, resolveTenantSmtp, isTenantSmtpConfigured, SmtpNotConfiguredError } from "@/lib/mailer";
import { buildSmtpTestEmail } from "@/lib/email-templates";
import { logActivity } from "@/lib/activity-log";

// Check the enterprise's OWN SMTP settings — the ones that send guest mail.
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

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: ctx.enterpriseId },
    });

    if (!isTenantSmtpConfigured(settings)) {
      return NextResponse.json({ error: new SmtpNotConfiguredError().message }, { status: 400 });
    }

    // Decryption can throw when SECRETS_ENCRYPTION_KEY was removed after values were
    // encrypted — a configuration fault worth naming rather than reporting as "auth failed".
    let smtp;
    try {
      smtp = resolveTenantSmtp(settings);
    } catch {
      return NextResponse.json(
        { error: "The stored SMTP password could not be read — check SECRETS_ENCRYPTION_KEY, then re-enter it." },
        { status: 500 }
      );
    }

    const verified = await verifySmtp(smtp);
    if (!verified.ok) {
      return NextResponse.json({ ok: false, stage: "connect", error: verified.error }, { status: 200 });
    }

    if (!to) {
      return NextResponse.json({ ok: true, stage: "connect", sentTo: null });
    }

    const mail = buildSmtpTestEmail({ sender: settings.invoiceBrandName || "your property" });
    try {
      await sendMail({ settings, to, subject: mail.subject, html: mail.html, text: mail.text });
    } catch (e) {
      return NextResponse.json(
        { ok: false, stage: "send", error: e instanceof Error ? e.message : "Unknown error" },
        { status: 200 }
      );
    }

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "EnterpriseSettings",
      entityId: settings.id,
      description: `Sent an SMTP test email to ${to}`,
    });

    return NextResponse.json({ ok: true, stage: "send", sentTo: to });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
