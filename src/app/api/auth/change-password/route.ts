import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { lockoutRemainingSeconds, recordLoginFailure, recordLoginSuccess } from "@/lib/login-rate-limit";
import { logAuthActivity } from "@/lib/activity-log";

const GENERIC_ERROR = "Incorrect enterprise code, email, or password.";

// Matches the bootstrap script's minimum — the handover account is an enterprise Admin,
// and its self-chosen password should not be weaker than the platform operator's.
const MIN_PASSWORD_LENGTH = 12;

// The one step between a platform-issued TEMPORARY password and a usable account.
//
// Not a session route — by design the temporary password never earns a session (see
// /api/auth/login), so the caller cannot be authenticated yet. It authenticates the
// same way login does (email + current password + optional enterprise code, same
// per-email throttle, same generic error for every failure mode) and does exactly one
// thing: replaces the temp password with the user's own and clears the flag. It then
// deliberately does NOT mint a session — the client signs in again through the normal
// login route, so every gate that lives there (license, logging) applies once, in one
// place.
//
// Refuses accounts that are not in the temporary state, behind the same generic error:
// this endpoint exists for the handover flow, not as a general unauthenticated
// password-change surface.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const enterpriseSlug = typeof body?.enterpriseSlug === "string" ? body.enterpriseSlug.trim().toLowerCase() : "";
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!email || !currentPassword) {
      return NextResponse.json({ error: "Email and current password are required" }, { status: 400 });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: "The new password must be different from the temporary one" }, { status: 400 });
    }

    // Same throttle as login, same counter — this endpoint verifies the same credential,
    // so it must not be a cheaper brute-force surface than the login route.
    const lockedFor = lockoutRemainingSeconds(email);
    if (lockedFor > 0) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60)} minute${lockedFor > 60 ? "s" : ""}.` },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { enterprise: { select: { slug: true } } },
    });

    // Every rejection below reads identically — including "account exists but is not in
    // the temporary state" — so nothing about the account can be probed from here.
    const reject = async (why: string) => {
      recordLoginFailure(email);
      await logAuthActivity({
        action: "LOGIN_FAILED",
        email,
        description: `Failed password change: ${why}`,
        userId: user?.id,
        enterpriseId: user?.enterpriseId,
      });
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
    };

    if (!user || !user.isActive) return reject(user ? "account disabled" : "unknown email");
    if (enterpriseSlug && user.enterprise.slug !== enterpriseSlug) return reject(`wrong enterprise code (${enterpriseSlug})`);
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return reject("wrong temporary password");
    if (!user.mustChangePassword) return reject("account is not awaiting a password change");

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
    });

    recordLoginSuccess(email);
    await logAuthActivity({
      action: "LOGIN",
      email,
      description: "Replaced the temporary password with their own",
      userId: user.id,
      userName: `${user.firstName} ${user.lastName}`,
      enterpriseId: user.enterpriseId,
    });

    // No session — sign in with the new password through the normal route.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Change-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
