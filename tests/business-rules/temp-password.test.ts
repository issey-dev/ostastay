import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const initialUserRoute = await import("@/app/api/osta/enterprises/[id]/initial-user/route");
const loginRoute = await import("@/app/api/auth/login/route");
const changePasswordRoute = await import("@/app/api/auth/change-password/route");

const jsonPost = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// The platform-issued handover password is TEMPORARY, and enforcement is at the door:
// login never mints a session under it, so the temp credential can only ever be used to
// replace itself. (App-owner requirement, 2026-08-03.)
describe("Temporary handover password", () => {
  let ostaAdminId: string;
  let tenantId: string;
  let tenantSlug: string;
  const stamp = Date.now();
  const handoverEmail = `temp-pw-${stamp}@client.local`;
  const NEW_PASSWORD = `own-password-${stamp}`;
  let tempPassword: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id,
        email: `temp-pw-osta-${stamp}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Temp",
        lastName: "Issuer",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    const tenant = await prisma.enterprise.create({
      data: { name: `TempPw ${stamp}`, slug: `test-temp-pw-${stamp}`, type: "STANDARD" },
    });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;
    await prisma.enterpriseLicense.create({ data: { enterpriseId: tenantId, tier: "STANDARD", maxProperties: 1 } });

    // Mint the handover account through the real endpoint, capturing the temp password.
    cookieJar.clear();
    await createSession(ostaAdminId);
    const res = await initialUserRoute.POST(jsonPost({ email: handoverEmail, firstName: "Hand", lastName: "Over" }), {
      params: Promise.resolve({ id: tenantId }),
    });
    expect(res.status).toBe(201);
    tempPassword = ((await res.json()) as { password: string }).password;
    await destroySession();
    cookieJar.clear();
  });

  afterEach(() => {
    cookieJar.clear();
  });

  it("the handover account is created flagged", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: handoverEmail } });
    expect(user.mustChangePassword).toBe(true);
  });

  it("logging in with the temp password issues NO session — only the change demand", async () => {
    const res = await loginRoute.POST(jsonPost({ email: handoverEmail, password: tempPassword, enterpriseSlug: tenantSlug }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mustChangePassword).toBe(true);
    // The whole point: no auth cookie was set, so the temp password operates nothing.
    expect(cookieJar.has("auth_token")).toBe(false);
    expect(body.user).toBeUndefined();
  });

  it("change-password rejects a wrong temp password, a short new one, and a reused one — all without leaking which", async () => {
    const wrong = await changePasswordRoute.POST(
      jsonPost({ email: handoverEmail, currentPassword: "not-the-temp-password", newPassword: NEW_PASSWORD })
    );
    expect(wrong.status).toBe(401);

    const short = await changePasswordRoute.POST(
      jsonPost({ email: handoverEmail, currentPassword: tempPassword, newPassword: "short" })
    );
    expect(short.status).toBe(400);

    const reused = await changePasswordRoute.POST(
      jsonPost({ email: handoverEmail, currentPassword: tempPassword, newPassword: tempPassword })
    );
    expect(reused.status).toBe(400);
  });

  it("the happy path: set own password → temp dies → real login works and mints a session", async () => {
    const change = await changePasswordRoute.POST(
      jsonPost({ email: handoverEmail, enterpriseSlug: tenantSlug, currentPassword: tempPassword, newPassword: NEW_PASSWORD })
    );
    expect(change.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: handoverEmail } });
    expect(user.mustChangePassword).toBe(false);

    // The temporary password is dead…
    const stale = await loginRoute.POST(jsonPost({ email: handoverEmail, password: tempPassword, enterpriseSlug: tenantSlug }));
    expect(stale.status).toBe(401);

    // …and the user's own password signs in for real.
    cookieJar.clear();
    const login = await loginRoute.POST(jsonPost({ email: handoverEmail, password: NEW_PASSWORD, enterpriseSlug: tenantSlug }));
    expect(login.status).toBe(200);
    const body = await login.json();
    expect(body.success).toBe(true);
    expect(cookieJar.has("auth_token")).toBe(true);
  });

  it("change-password refuses an account that is not in the temporary state, behind the generic error", async () => {
    // The account just completed the flow — a second change attempt with the (correct)
    // new password must read exactly like any other failure.
    const res = await changePasswordRoute.POST(
      jsonPost({ email: handoverEmail, currentPassword: NEW_PASSWORD, newPassword: `another-${stamp}-long-enough` })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Incorrect enterprise code, email, or password.");
  });
});
