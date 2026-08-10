import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError, getOstaEnterpriseId } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { isPlatformSmtpConfigured } from "@/lib/mailer";
import { sendPlatformMail, MAIL_KINDS } from "@/lib/mail-sender";
import { buildEnterpriseWelcomeEmail } from "@/lib/email-templates";

// Mint a customer enterprise's FIRST user — the handover account the operator gives the
// client so they can sign in and take over (app-owner requirement, 2026-08-03:
// enterprise / properties / INITIAL USER ONLY from the Osta side).
//
// "Initial user only" is enforced, not advisory: this refuses outright once the
// enterprise has any user at all. Ongoing user management belongs to the tenant's own
// Controls — a platform-side path that could quietly add accounts to a customer's
// enterprise at any time would be a standing backdoor, and scoping it to the empty
// enterprise is what keeps it an onboarding tool instead.
//
// The password is GENERATED, never chosen: 12 random base64url characters, returned
// once in this response and stored only as a bcrypt hash — the same show-once posture
// as webhook URLs and eRegistration links. It is also TEMPORARY, enforced rather than
// advisory: mustChangePassword makes login refuse to mint a session until the client
// replaces it with their own at first sign-in.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can create an enterprise's initial user");
    }
    requirePermission(ctx, "CONTROLS", "create");

    const enterprise = await prisma.enterprise.findUnique({ where: { id } });
    if (!enterprise || enterprise.type !== "STANDARD") {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    const existingUsers = await prisma.user.count({ where: { enterpriseId: id } });
    if (existingUsers > 0) {
      return NextResponse.json(
        { error: "This enterprise already has users — its own admin manages accounts from Controls." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }
    if (!firstName || !lastName) {
      return NextResponse.json({ error: "First and last name are required" }, { status: 400 });
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
    }

    // The shared system "Admin" role (full permissions) — the handover account must be
    // able to do everything, including creating the enterprise's real user accounts.
    // Guaranteed to exist: the container entrypoint ensures it on every boot.
    const ostaEnterpriseId = await getOstaEnterpriseId();
    const adminRole = await prisma.role.findFirst({
      where: { enterpriseId: ostaEnterpriseId, name: "Admin", isSystem: true },
    });
    if (!adminRole) {
      return NextResponse.json({ error: "System roles are missing — run the platform bootstrap" }, { status: 500 });
    }

    // 9 random bytes → 12 base64url characters: matches the bootstrap script's minimum
    // password length, with ~72 bits of entropy. Never logged, never stored readable.
    const password = randomBytes(9).toString("base64url");

    const user = await prisma.user.create({
      data: {
        enterpriseId: id,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        firstName,
        lastName,
        roles: { create: { roleId: adminRole.id } },
        scope: "ENTERPRISE",
        // The handover account is PROTECTED: it can never be deleted, deactivated,
        // demoted to a single property, or stripped of its roles. User management lives
        // in the Hub, which refuses property-scoped users, so this account is what
        // guarantees a tenant can always administer itself without an Osta support
        // ticket. See .agents/docs/USER_MANAGEMENT_PLAN.md decision 9.
        isProtected: true,
        // The generated password is TEMPORARY: login refuses to mint a session until
        // the client replaces it with their own (see /api/auth/login and
        // /api/auth/change-password).
        mustChangePassword: true,
      },
    });

    const description = `Created initial admin user ${email} for "${enterprise.name}" — by Osta platform admin`;
    await logActivity({ ctx, module: "CONTROLS", action: "CREATE", entityType: "User", entityId: user.id, description });
    await logActivity({ ctx, module: "CONTROLS", action: "CREATE", entityType: "User", entityId: user.id, description, targetEnterpriseId: id });

    // Email the handover details from the PLATFORM sender — this is mail from Uppsolut
    // Stay, and a brand-new enterprise has no SMTP of its own to send it with.
    //
    // Deliberately NON-FATAL, and deliberately after the activity log: the user genuinely
    // exists by this point, so a failed send must not turn into a 500 that suggests
    // otherwise and tempts the operator to retry (the retry would be refused — this
    // endpoint only ever mints the FIRST user). The password is still returned below for
    // manual handover, which is the flow that worked before mail existed at all. The
    // outcome is reported so the operator knows which of the two happened.
    let emailed = false;
    let emailError: string | null = null;
    if (!isPlatformSmtpConfigured()) {
      emailError = "Platform SMTP is not configured — hand these details over manually.";
    } else {
      try {
        const mail = buildEnterpriseWelcomeEmail({
          firstName,
          email,
          password,
          enterpriseName: enterprise.name,
          enterpriseSlug: enterprise.slug,
        });
        await sendPlatformMail({
          kind: MAIL_KINDS.ENTERPRISE_WELCOME,
          // Tags the log row so the send is attributable to this enterprise. It is still
          // recorded as PLATFORM and is never billable — this is Uppsolut's own mail.
          enterpriseId: id,
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        emailed = true;
        await logActivity({
          ctx,
          module: "CONTROLS",
          action: "CREATE",
          entityType: "User",
          entityId: user.id,
          description: `Emailed handover sign-in details to ${email}`,
          targetEnterpriseId: id,
        });
      } catch (mailError) {
        // Never log the message body — it contains the plaintext password.
        console.error("Failed to email handover credentials:", mailError);
        emailError = "The account was created, but the welcome email could not be sent.";
      }
    }

    return NextResponse.json(
      {
        email,
        // The one and only time this password exists outside its bcrypt hash.
        password,
        enterpriseSlug: enterprise.slug,
        emailed,
        emailError,
        warning:
          "Copy these now — the password is shown only once, and it is TEMPORARY: the client will be required to set their own password at first sign-in before anything else works.",
      },
      { status: 201 }
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
