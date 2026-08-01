import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";
import { lockoutRemainingSeconds, recordLoginFailure, recordLoginSuccess } from "@/lib/login-rate-limit";
import { logAuthActivity } from "@/lib/activity-log";
import { getOstaEnterpriseId } from "@/lib/scope";
import { getLicenseStatus, isLicenseUsable } from "@/lib/license";

const GENERIC_ERROR = "Incorrect enterprise code, email, or password.";

export async function POST(request: Request) {
  try {
    const { email, password, enterpriseSlug } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Throttled per email (existing or not) — 5 failures in 15 minutes locks the
    // email out for 15 minutes. Checked before any DB work.
    const lockedFor = lockoutRemainingSeconds(email);
    if (lockedFor > 0) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60)} minute${lockedFor > 60 ? "s" : ""}.` },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { enterprise: { select: { slug: true } } }
    });

    // A wrong enterprise code, a wrong email, and a wrong password all produce the
    // identical generic error — no enumeration of which one was actually wrong.
    if (!user || !user.isActive) {
      recordLoginFailure(email);
      await logAuthActivity({
        action: "LOGIN_FAILED",
        email,
        description: user ? "Failed sign-in: account disabled" : "Failed sign-in: unknown email",
        userId: user?.id,
        enterpriseId: user?.enterpriseId,
      });
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    if (enterpriseSlug) {
      const enterprise = await prisma.enterprise.findUnique({ where: { slug: enterpriseSlug.toLowerCase() } });
      if (!enterprise || enterprise.id !== user.enterpriseId) {
        recordLoginFailure(email);
        await logAuthActivity({
          action: "LOGIN_FAILED",
          email,
          description: `Failed sign-in: wrong enterprise code (${enterpriseSlug})`,
          userId: user.id,
          enterpriseId: user.enterpriseId,
        });
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
      }
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      recordLoginFailure(email);
      await logAuthActivity({
        action: "LOGIN_FAILED",
        email,
        description: "Failed sign-in: wrong password",
        userId: user.id,
        enterpriseId: user.enterpriseId,
      });
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    }

    // License gate — AFTER the password check (so this never becomes an enumeration
    // oracle) and BEFORE the session is created. EXPIRED (past grace) and REVOKED block
    // sign-in outright; GRACE signs in but carries a warning for the client to surface.
    // Osta's own users are exempt — they must always be able to reach the console.
    const ostaId = await getOstaEnterpriseId();
    let licenseWarning: string | null = null;
    if (user.enterpriseId !== ostaId) {
      const { state, graceEndsAt } = await getLicenseStatus(user.enterpriseId);
      if (!isLicenseUsable(state)) {
        await logAuthActivity({
          action: "LOGIN_FAILED",
          email,
          description: `Failed sign-in: license ${state.toLowerCase()}`,
          userId: user.id,
          enterpriseId: user.enterpriseId,
        });
        return NextResponse.json(
          {
            error:
              state === "REVOKED"
                ? "This enterprise's license has been revoked. Contact Osta to restore access."
                : "This enterprise's license has expired. Contact Osta to renew access.",
          },
          { status: 403 }
        );
      }
      if (state === "GRACE") {
        licenseWarning = `This enterprise's license has expired. Access ends ${graceEndsAt ? graceEndsAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "soon"} unless payment is received.`;
      }
    }

    recordLoginSuccess(email);
    await createSession(user.id);
    await logAuthActivity({
      action: "LOGIN",
      email,
      description: "Signed in",
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      enterpriseId: user.enterpriseId,
    });

    const isInternal = user.enterpriseId === (await getOstaEnterpriseId());

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`
      },
      enterpriseSlug: user.enterprise.slug,
      isInternal,
      licenseWarning,
    });

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
