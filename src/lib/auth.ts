import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { JWT_SECRET } from "@/lib/jwt-secret";

// The JWT carries identity only (id + exp) — never role/enterpriseId/name. Every
// authorization decision re-fetches the live User row (see src/lib/scope.ts) instead of
// trusting claims that could be up to 24h stale (e.g. after a role change or disable).
export async function signToken(userId: string) {
  return await new SignJWT({ id: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
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

export async function createSession(userId: string) {
  const token = await signToken(userId);
  const cookieStore = await cookies();

  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 // 24 hours
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete("auth_token");
}
