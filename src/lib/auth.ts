import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { JWT_SECRET } from "@/lib/jwt-secret";
import { createSessionRecord, revokeSession } from "@/lib/session-store";

// The JWT carries identity only (id + jti + exp) — never role/enterpriseId/name. Every
// authorization decision re-fetches the live User row (see src/lib/scope.ts) instead of
// trusting claims that could be up to 24h stale (e.g. after a role change or disable).
//
// Since 2026-08-04 it also carries a `jti` naming a Session row. The token remains the
// credential; the row decides whether it is still HONOURED. That is what makes "sign this
// person out" and the idle timeout immediate instead of waiting out the 24h expiry.

/** Session lifetime. Kept in one place — the JWT exp, the cookie, and the Session row all read it. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24;

export async function signToken(userId: string, jti: string, ttlSeconds = SESSION_TTL_SECONDS) {
  return await new SignJWT({ id: userId, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;
  return await verifyToken(token);
}

export async function createSession(
  userId: string,
  meta?: { propertyId?: string | null; ipAddress?: string | null; userAgent?: string | null }
) {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  // The row goes in BEFORE the cookie: if this throws, the user simply isn't signed in,
  // whereas a cookie without a row would be a token that can never be honoured.
  await createSessionRecord({
    userId,
    jti,
    expiresAt,
    propertyId: meta?.propertyId ?? null,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });

  const token = await signToken(userId, jti);
  const cookieStore = await cookies();

  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  // Revoke the row too, so signing out on one device can't be undone by replaying a
  // copied cookie — the whole point of holding server-side state.
  const token = cookieStore.get("auth_token")?.value;
  if (token) {
    const payload = await verifyToken(token);
    const jti = typeof payload?.jti === "string" ? payload.jti : null;
    if (jti) await revokeSession(jti, "LOGOUT");
  }
  cookieStore.delete("auth_token");
}
