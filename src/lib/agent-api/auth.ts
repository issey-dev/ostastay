import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireCapability, type AuthContext } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Agent portal logins and sessions (Agent Portal plan A-3, §9 Security; Phase 5, 9.5.0).
//
//   · A login (AgentUser) belongs to one SOURCE profile. Staff add an email on the profile;
//     the system makes a single-use invite link for the person to set a password.
//   · Sign-in happens THROUGH the Agent API, so the portal stores no credentials.
//   · A session token is bound to the API key that issued it: a stolen token is useless with
//     another key. Tokens, invite and reset secrets are stored hashed only.
//   · Answers are uniform for unknown email and wrong password; 10 failures lock the account
//     for 15 minutes; logins are also rate limited per account and per IP (Postgres-backed).
//   · An agent can never satisfy requireSession(): this is a separate table and token.

export const AGENT_TOKEN_PREFIX = "agt_";
const SESSION_HOURS = 12;
const SESSION_MAX_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 2;
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;
export const MIN_AGENT_PASSWORD = 10;

export class AgentAuthError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const hashSecret = (raw: string) => createHash("sha256").update(raw).digest("hex");
const newSecret = (prefix = "") => prefix + randomBytes(32).toString("base64url");

export function portalLink(path: "accept-invite" | "reset-password", token: string): string | null {
  const base = process.env.AGENT_PORTAL_URL?.replace(/\/$/, "");
  return base ? `${base}/${path}?token=${encodeURIComponent(token)}` : null;
}

function assertPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < MIN_AGENT_PASSWORD) {
    throw new AgentAuthError(400, "WEAK_PASSWORD", `Use at least ${MIN_AGENT_PASSWORD} characters.`);
  }
  if (pw.length > 200) throw new AgentAuthError(400, "WEAK_PASSWORD", "That password is too long.");
  return pw;
}

const normalizeEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

// ── Staff side (Client Relations › Source profile › Portal logins) ─────────────────────

async function sourceFor(ctx: AuthContext, upid: string) {
  const p = await prisma.profile.findUnique({ where: { upid } });
  if (!p || p.enterpriseId !== ctx.enterpriseId) throw new AgentAuthError(404, "NOT_FOUND", "Profile not found");
  if (p.profileType !== "SOURCE") throw new AgentAuthError(400, "NOT_A_SOURCE", "Portal logins belong to Source profiles.");
  return p;
}

export async function listPortalLogins(ctx: AuthContext, upid: string) {
  await sourceFor(ctx, upid);
  return prisma.agentUser.findMany({
    where: { sourceProfileId: upid },
    select: { id: true, email: true, name: true, status: true, lastLoginAt: true, inviteExpiresAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Add a login: an invite link (and its raw token, shown once) to send or copy. */
export async function invitePortalLogin(ctx: AuthContext, upid: string, input: { email: unknown; name: unknown }) {
  requireCapability(ctx, "profiles.portalLogins");
  const source = await sourceFor(ctx, upid);
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AgentAuthError(400, "INVALID_EMAIL", "Enter a valid email.");
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 120) : email;
  const token = newSecret();
  const existing = await prisma.agentUser.findUnique({ where: { enterpriseId_email: { enterpriseId: ctx.enterpriseId, email } } });
  if (existing && existing.sourceProfileId !== upid) {
    throw new AgentAuthError(409, "EMAIL_IN_USE", "This email is already a portal login for another source.");
  }
  if (existing && existing.status === "ACTIVE") {
    throw new AgentAuthError(409, "EMAIL_IN_USE", "This person already has an active login. Use Reset to send a new password link.");
  }
  const data = {
    name,
    status: "INVITED",
    inviteTokenHash: hashSecret(token),
    inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
  };
  const user = existing
    ? await prisma.agentUser.update({ where: { id: existing.id }, data })
    : await prisma.agentUser.create({
        data: { ...data, enterpriseId: ctx.enterpriseId, sourceProfileId: upid, email, createdByUserId: ctx.userId },
      });
  await logActivity({
    ctx,
    module: "PROFILES",
    action: "CREATE",
    entityType: "AgentUser",
    entityId: user.id,
    description: `Portal login invited for ${email} (${source.companyName ?? source.firstName})`,
  });
  return { user: { id: user.id, email: user.email, name: user.name, status: user.status }, token, link: portalLink("accept-invite", token) };
}

export async function setPortalLoginStatus(ctx: AuthContext, upid: string, id: string, status: "ACTIVE" | "SUSPENDED") {
  requireCapability(ctx, "profiles.portalLogins");
  await sourceFor(ctx, upid);
  const u = await prisma.agentUser.findFirst({ where: { id, sourceProfileId: upid } });
  if (!u) throw new AgentAuthError(404, "NOT_FOUND", "Login not found");
  if (status === "ACTIVE" && !u.passwordHash) throw new AgentAuthError(409, "NOT_ACCEPTED", "This person has not set a password yet. Resend the invite.");
  await prisma.$transaction([
    prisma.agentUser.update({ where: { id }, data: { status, failedLogins: 0, lockedUntil: null } }),
    ...(status === "SUSPENDED" ? [prisma.agentSession.updateMany({ where: { agentUserId: id, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
  ]);
  await logActivity({ ctx, module: "PROFILES", action: "UPDATE", entityType: "AgentUser", entityId: id, description: `Portal login ${u.email} ${status === "SUSPENDED" ? "suspended" : "reactivated"}` });
}

/** Staff "Reset": a password link for an active login (or a fresh invite for an invited one). */
export async function resetPortalLogin(ctx: AuthContext, upid: string, id: string) {
  requireCapability(ctx, "profiles.portalLogins");
  await sourceFor(ctx, upid);
  const u = await prisma.agentUser.findFirst({ where: { id, sourceProfileId: upid } });
  if (!u) throw new AgentAuthError(404, "NOT_FOUND", "Login not found");
  const token = newSecret();
  if (!u.passwordHash) {
    await prisma.agentUser.update({ where: { id }, data: { inviteTokenHash: hashSecret(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    return { token, link: portalLink("accept-invite", token), kind: "invite" as const };
  }
  await prisma.agentUser.update({ where: { id }, data: { resetTokenHash: hashSecret(token), resetExpiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000) } });
  await logActivity({ ctx, module: "PROFILES", action: "UPDATE", entityType: "AgentUser", entityId: id, description: `Password reset link made for portal login ${u.email}` });
  return { token, link: portalLink("reset-password", token), kind: "reset" as const };
}

/** Deactivating a Source suspends its logins (Agent Portal plan §9 Operations). */
export async function suspendLoginsOfSource(upid: string) {
  const users = await prisma.agentUser.findMany({ where: { sourceProfileId: upid, status: { not: "SUSPENDED" } }, select: { id: true } });
  if (users.length === 0) return 0;
  await prisma.agentUser.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { status: "SUSPENDED" } });
  await prisma.agentSession.updateMany({ where: { agentUserId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
  return users.length;
}

// ── Agent side (through the API, with an AGENT-scoped key) ────────────────────────────

async function openSession(agentUserId: string, keyId: string, ip: string | null) {
  const token = newSecret(AGENT_TOKEN_PREFIX);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await prisma.agentSession.create({ data: { tokenHash: hashSecret(token), agentUserId, keyId, expiresAt, ip } });
  return { token, expiresAt };
}

let dummyHash: string | null = null;

/** Sign in. One answer for unknown email, wrong password, suspended or locked. */
export async function agentLogin(enterpriseId: string, keyId: string, email: unknown, password: unknown, ip: string | null) {
  const invalid = new AgentAuthError(401, "INVALID_CREDENTIALS", "Email or password is wrong, or the account is not active.");
  const e = normalizeEmail(email);
  if (!e || typeof password !== "string") throw invalid;
  const u = await prisma.agentUser.findUnique({
    where: { enterpriseId_email: { enterpriseId, email: e } },
    include: { sourceProfile: { select: { isActive: true } } },
  });
  // Spend comparable time when the account does not exist.
  if (!u || !u.passwordHash) {
    dummyHash ??= await bcrypt.hash("not-a-real-password", 10);
    await bcrypt.compare(password, dummyHash);
    throw invalid;
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw invalid;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    const fails = u.failedLogins + 1;
    await prisma.agentUser.update({
      where: { id: u.id },
      data: { failedLogins: fails >= LOCK_AFTER ? 0 : fails, lockedUntil: fails >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    throw invalid;
  }
  if (u.status !== "ACTIVE" || !u.sourceProfile.isActive) throw invalid;
  await prisma.agentUser.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return openSession(u.id, keyId, ip);
}

/** Set a password from an invite link; the person is signed in straight away. */
export async function acceptInvite(enterpriseId: string, keyId: string, token: unknown, password: unknown, ip: string | null) {
  const pw = assertPassword(password);
  if (typeof token !== "string" || !token) throw new AgentAuthError(400, "INVALID_TOKEN", "This link is not valid.");
  const u = await prisma.agentUser.findUnique({ where: { inviteTokenHash: hashSecret(token) } });
  if (!u || u.enterpriseId !== enterpriseId || !u.inviteExpiresAt || u.inviteExpiresAt < new Date() || u.status === "SUSPENDED") {
    throw new AgentAuthError(400, "INVALID_TOKEN", "This link has expired or was already used. Ask the hotel for a new one.");
  }
  await prisma.agentUser.update({
    where: { id: u.id },
    data: { passwordHash: await bcrypt.hash(pw, 10), status: "ACTIVE", inviteTokenHash: null, inviteExpiresAt: null, lastLoginAt: new Date() },
  });
  return openSession(u.id, keyId, ip);
}

/** Always "accepted": whether the email exists is never revealed. Returns the raw token for mailing. */
export async function forgotPassword(enterpriseId: string, email: unknown): Promise<{ to: string; token: string } | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const u = await prisma.agentUser.findUnique({ where: { enterpriseId_email: { enterpriseId, email: e } } });
  if (!u || u.status !== "ACTIVE") return null;
  const token = newSecret();
  await prisma.agentUser.update({ where: { id: u.id }, data: { resetTokenHash: hashSecret(token), resetExpiresAt: new Date(Date.now() + RESET_HOURS * 3_600_000) } });
  return { to: u.email, token };
}

export async function resetPassword(enterpriseId: string, token: unknown, password: unknown) {
  const pw = assertPassword(password);
  if (typeof token !== "string" || !token) throw new AgentAuthError(400, "INVALID_TOKEN", "This link is not valid.");
  const u = await prisma.agentUser.findUnique({ where: { resetTokenHash: hashSecret(token) } });
  if (!u || u.enterpriseId !== enterpriseId || !u.resetExpiresAt || u.resetExpiresAt < new Date() || u.status !== "ACTIVE") {
    throw new AgentAuthError(400, "INVALID_TOKEN", "This link has expired or was already used.");
  }
  await prisma.$transaction([
    prisma.agentUser.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 10), resetTokenHash: null, resetExpiresAt: null, failedLogins: 0, lockedUntil: null } }),
    // A password change signs every device out.
    prisma.agentSession.updateMany({ where: { agentUserId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export type AgentIdentity = {
  sessionId: string;
  agentUserId: string;
  email: string;
  name: string;
  sourceProfileId: string;
  sourceName: string;
  enterpriseId: string;
};

/** The agent behind a request's X-Agent-Token, for this key — or null. */
export async function resolveAgentSession(rawToken: string | null, keyId: string, enterpriseId: string): Promise<AgentIdentity | null> {
  if (!rawToken || !rawToken.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const s = await prisma.agentSession.findUnique({
    where: { tokenHash: hashSecret(rawToken) },
    include: { agentUser: { include: { sourceProfile: { select: { upid: true, companyName: true, firstName: true, isActive: true, enterpriseId: true } } } } },
  });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.keyId !== keyId) return null;
  const u = s.agentUser;
  if (u.status !== "ACTIVE" || u.enterpriseId !== enterpriseId || !u.sourceProfile.isActive || u.sourceProfile.enterpriseId !== enterpriseId) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await prisma.agentSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return {
    sessionId: s.id,
    agentUserId: u.id,
    email: u.email,
    name: u.name,
    sourceProfileId: u.sourceProfile.upid,
    sourceName: u.sourceProfile.companyName || u.sourceProfile.firstName,
    enterpriseId,
  };
}

/** A fresh token for a live session, up to SESSION_MAX_DAYS after sign-in. The old one is revoked. */
export async function refreshAgentSession(identity: AgentIdentity, keyId: string, ip: string | null) {
  const s = await prisma.agentSession.findUniqueOrThrow({ where: { id: identity.sessionId } });
  if (Date.now() - s.createdAt.getTime() > SESSION_MAX_DAYS * 86_400_000) {
    throw new AgentAuthError(401, "SESSION_EXPIRED", "Please sign in again.");
  }
  await prisma.agentSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  return openSession(identity.agentUserId, keyId, ip);
}

export async function agentLogout(identity: AgentIdentity) {
  await prisma.agentSession.update({ where: { id: identity.sessionId }, data: { revokedAt: new Date() } });
}
