import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie fake as tests/business-rules/hub-access.test.ts — the routes
// under test are session routes.
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

process.env.SECRETS_ENCRYPTION_KEY = "test-osta-channel-key";

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { isEncryptedSecret } = await import("@/lib/secret-crypto");
const { hashWebhookToken } = await import("@/lib/channels/webhook-token");
const connectionsRoute = await import("@/app/api/osta/channels/connections/route");
const connectionByIdRoute = await import("@/app/api/osta/channels/connections/[id]/route");
const webhookGenRoute = await import("@/app/api/osta/channels/connections/[id]/webhook/route");
const publicWebhookRoute = await import("@/app/api/channels/webhook/[token]/route");

/** Stub Beds24's HTTP surface so no test ever makes a real outbound call. */
function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response)
  );
}

// The Osta console's cross-tenant channel administration — the master-account topology
// (.agents/docs/DECISIONS.md, 2026-08-02). The invariant under test throughout: reach
// across tenants is granted by ctx.isInternal and NOTHING else, and every action on a
// tenant's connection leaves a trace in that tenant's own activity trail.
describe("Osta platform channel administration", () => {
  let ostaAdminId: string;
  let tenantAId: string;
  let tenantBId: string;
  let tenantAdminAId: string;
  let connectionAId: string;
  let connectionBId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const ostaRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id,
        email: `osta-chan-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Osta",
        lastName: "Chan",
        roleId: ostaRoleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    const mkTenant = async (label: string) => {
      const ent = await prisma.enterprise.create({
        data: {
          name: `OstaChan ${label} ${Date.now()}`,
          slug: `test-ostachan-${label}-${Date.now()}`,
          type: "STANDARD",
        },
      });
      await prisma.enterpriseLicense.create({
        data: { enterpriseId: ent.id, tier: "STANDARD", maxProperties: 1 },
      });
      const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
      const admin = await prisma.user.create({
        data: {
          enterpriseId: ent.id,
          email: `ostachan-${label}-${Date.now()}@test.local`,
          passwordHash,
          firstName: "Tenant",
          lastName: label,
          roleId: roleIds["Admin"],
          scope: "ENTERPRISE",
        },
      });
      const connection = await prisma.channelConnection.create({
        data: {
          enterpriseId: ent.id,
          provider: "BEDS24",
          name: `Conn ${label}`,
          refreshToken: "x",
        },
      });
      return { entId: ent.id, adminId: admin.id, connectionId: connection.id };
    };

    const a = await mkTenant("A");
    const b = await mkTenant("B");
    tenantAId = a.entId;
    tenantBId = b.entId;
    tenantAdminAId = a.adminId;
    connectionAId = a.connectionId;
    connectionBId = b.connectionId;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await destroySession();
    cookieJar.clear();
  });

  it("a tenant admin is refused, even with full INTEGRATIONS permission", async () => {
    await createSession(tenantAdminAId);

    // The tenant admin's own Hub grants INTEGRATIONS — this proves the refusal comes
    // from isInternal, not from a missing permission bit.
    const list = await connectionsRoute.GET();
    expect(list.status).toBe(403);

    const create = await connectionsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: tenantAId, name: "X", inviteCode: "code" }),
      })
    );
    expect(create.status).toBe(403);

    const webhook = await webhookGenRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: connectionAId }),
    });
    expect(webhook.status).toBe(403);
  });

  it("an Osta admin lists connections across every enterprise", async () => {
    await createSession(ostaAdminId);

    const res = await connectionsRoute.GET();
    expect(res.status).toBe(200);
    const { connections } = (await res.json()) as {
      connections: { id: string; enterprise: { id: string; name: string } }[];
    };

    const ids = connections.map((c) => c.id);
    expect(ids).toContain(connectionAId);
    expect(ids).toContain(connectionBId);
    // The enterprise is attached, so the console can tell whose connection is whose.
    expect(connections.find((c) => c.id === connectionAId)!.enterprise.id).toBe(tenantAId);
    expect(connections.find((c) => c.id === connectionBId)!.enterprise.id).toBe(tenantBId);
    // And no credential fields ride along — PublicConnection deliberately has none
    // (metadata like lastTokenRefreshAt is fine; the stored values are what must not be).
    const serialized = JSON.stringify(connections);
    expect(serialized).not.toContain("refreshToken\"");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("webhookTokenHash");
  });

  it("creates a connection FOR a tenant from an invite code", async () => {
    await createSession(ostaAdminId);
    stubBeds24({ refreshToken: "beds-refresh", token: "beds-access", expiresIn: 86400 });

    const res = await connectionsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: tenantAId, name: "Master-set", inviteCode: "invite-1" }),
      })
    );
    expect(res.status).toBe(201);
    const { connection } = await res.json();

    // The row landed in the TENANT's enterprise, with encrypted credentials.
    const row = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.enterpriseId).toBe(tenantAId);
    expect(isEncryptedSecret(row.refreshToken)).toBe(true);

    // The tenant's own trail shows what the platform did — not just Osta's.
    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId: tenantAId, entityType: "ChannelConnection", entityId: connection.id },
    });
    expect(trail).toBeTruthy();
    expect(trail!.userId).toBe(ostaAdminId);
  });

  it("refuses to create a connection on the INTERNAL enterprise itself", async () => {
    await createSession(ostaAdminId);
    const osta = await prisma.enterprise.findFirstOrThrow({ where: { type: "INTERNAL" } });

    const res = await connectionsRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: osta.id, name: "Nope", inviteCode: "invite-x" }),
      })
    );
    // Osta has no operational properties — a connection there can only be a mistake.
    expect(res.status).toBe(404);
  });

  it("sets a tenant connection's rate-limit pause threshold cross-tenant", async () => {
    await createSession(ostaAdminId);

    const res = await connectionByIdRoute.PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateLimitPauseThreshold: 50 }),
      }),
      { params: Promise.resolve({ id: connectionBId }) }
    );
    expect(res.status).toBe(200);

    const row = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionBId } });
    expect(row.rateLimitPauseThreshold).toBe(50);
  });

  it("generates a webhook URL for a tenant connection — show-once, hash at rest, logged to the tenant", async () => {
    await createSession(ostaAdminId);

    const res = await webhookGenRoute.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: connectionAId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; regenerated: boolean };
    const minted = body.path.replace("/api/channels/webhook/", "");
    expect(minted).toMatch(/^[0-9a-f]{64}$/);
    expect(body.regenerated).toBe(false);

    // Only the hash is stored — same posture as the Hub's own generate endpoint.
    const row = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionAId } });
    expect(row.webhookTokenHash).toBe(hashWebhookToken(minted));
    expect(JSON.stringify(row)).not.toContain(minted);

    // The minted URL authenticates on the public webhook route (empty payload is fine —
    // authentication is the part under test here).
    const hook = await publicWebhookRoute.POST(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ token: minted }) }
    );
    expect(hook.status).toBe(200);

    // And the tenant's trail records that the platform minted it.
    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId: tenantAId, entityType: "ChannelConnection", entityId: connectionAId },
      orderBy: { createdAt: "desc" },
    });
    expect(trail).toBeTruthy();
    expect(trail!.description).toContain("webhook");
  });

  it("removes a tenant connection cross-tenant, and the removal lands in the tenant's trail", async () => {
    await createSession(ostaAdminId);

    const doomed = await prisma.channelConnection.create({
      data: { enterpriseId: tenantBId, provider: "BEDS24", name: "Doomed", refreshToken: "x" },
    });

    const res = await connectionByIdRoute.DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: doomed.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.channelConnection.findUnique({ where: { id: doomed.id } })).toBeNull();

    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId: tenantBId, entityType: "ChannelConnection", entityId: doomed.id },
    });
    expect(trail).toBeTruthy();
    expect(trail!.action).toBe("DELETE");
  });
});
