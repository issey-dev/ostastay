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

process.env.SECRETS_ENCRYPTION_KEY = "test-sync-log-key";

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createConnection, testConnection } = await import("@/lib/channels/connection");
const { listSyncLogs, pruneSyncLogs } = await import("@/lib/channels/sync-log");
const { redactForLog, redactHeaders, redactErrorMessage, REDACTED } = await import("@/lib/channels/redact");
const syncLogsRoute = await import("@/app/api/hub/sync-logs/route");

function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response)
  );
}

describe("Channel sync log", () => {
  let enterpriseId: string;
  let otherEnterpriseId: string;
  let adminId: string;
  let propertyScopedUserId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ent = await prisma.enterprise.create({
      data: { name: `Log Ent ${Date.now()}`, slug: `test-log-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });

    const other = await prisma.enterprise.create({
      data: { name: `Log Other ${Date.now()}`, slug: `test-logo-${Date.now()}`, type: "STANDARD" },
    });
    otherEnterpriseId = other.id;
    await prisma.enterpriseLicense.create({
      data: { enterpriseId: otherEnterpriseId, tier: "STANDARD", maxProperties: 1 },
    });

    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `log-admin-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Log",
        lastName: "Admin",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Log Property",
        code: `LP-${Date.now()}`,
        legalName: "Log LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    const propUser = await prisma.user.create({
      data: {
        enterpriseId,
        email: `log-prop-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Prop",
        lastName: "User",
        roleId: roleIds["Admin"],
        scope: "PROPERTY",
        propertyId: property.id,
      },
    });
    propertyScopedUserId = propUser.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Redaction — the safety property this whole feature depends on.
  // ---------------------------------------------------------------------------

  it("redactForLog is deny-by-default: unrecognised keys are masked, not kept", () => {
    const out = redactForLog({ token: "super-secret", refreshToken: "also-secret", somethingNew: "unknown-field" });
    expect(out).not.toContain("super-secret");
    expect(out).not.toContain("also-secret");
    // The key a future Beds24 release might add is masked WITHOUT anyone having to
    // remember to blocklist it — this is the point of the whitelist design.
    expect(out).not.toContain("unknown-field");
    // Structure survives, so the shape is still diagnosable.
    expect(out).toContain("token");
    expect(out).toContain(REDACTED);
  });

  it("redactForLog keeps genuinely diagnostic fields", () => {
    const out = redactForLog({ error: "Token not valid", expiresIn: 86400, status: 401 });
    expect(out).toContain("Token not valid");
    expect(out).toContain("86400");
  });

  it("redactHeaders masks every value while keeping header names", () => {
    const out = redactHeaders({ code: "invite-secret-123", token: "access-secret-456" });
    expect(out).not.toContain("invite-secret-123");
    expect(out).not.toContain("access-secret-456");
    // Knowing WHICH auth header was sent is useful; its value never is.
    expect(out).toContain("code");
    expect(out).toContain("token");
  });

  it("redactErrorMessage strips token-shaped strings quoted back in an error", () => {
    const out = redactErrorMessage("Rejected credential abcdefghijklmnopqrstuvwxyz123456 is invalid");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(out).toContain("Rejected credential");
  });

  // ---------------------------------------------------------------------------
  // End-to-end: a real exchange must not leave a credential in the table.
  // ---------------------------------------------------------------------------

  it("a successful connection logs the exchange without storing any credential", async () => {
    const INVITE = "invite-code-TOPSECRET-9999";
    const REFRESH = "refresh-token-TOPSECRET-8888";
    const ACCESS = "access-token-TOPSECRET-7777";
    stubBeds24({ refreshToken: REFRESH, token: ACCESS, expiresIn: 86400 });

    const created = await createConnection({
      enterpriseId,
      name: `Logged ${Date.now()}`,
      inviteCode: INVITE,
    });

    const rows = await prisma.channelSyncLog.findMany({ where: { enterpriseId } });
    expect(rows.length).toBeGreaterThan(0);

    // The whole table, serialised — no credential may appear anywhere in it.
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(INVITE);
    expect(dump).not.toContain(REFRESH);
    expect(dump).not.toContain(ACCESS);

    // But the exchange IS recorded usefully.
    const setup = rows.find((r) => r.operation === "auth.setup");
    expect(setup).toBeTruthy();
    expect(setup!.direction).toBe("OUTBOUND");
    expect(setup!.ok).toBe(true);
    expect(setup!.endpoint).toContain("/authentication/setup");
    expect(setup!.latencyMs).not.toBeNull();
    expect(created.status).toBe("CONNECTED");
  });

  it("a REJECTED invite code is still logged, even though no connection row is created", async () => {
    const before = await prisma.channelSyncLog.count({ where: { enterpriseId } });
    stubBeds24({ error: "Token not valid" }, false, 401);

    await expect(
      createConnection({ enterpriseId, name: "Doomed", inviteCode: "bad-code" })
    ).rejects.toThrow();

    const rows = await prisma.channelSyncLog.findMany({
      where: { enterpriseId },
      orderBy: { createdAt: "desc" },
    });
    // The most common setup failure must leave a trace rather than vanishing.
    expect(rows.length).toBe(before + 1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].httpStatus).toBe(401);
    expect(rows[0].errorMessage).toContain("Token not valid");
    // No connection exists to attach it to — the entry still records the typed name.
    expect(rows[0].connectionId).toBeNull();
    expect(rows[0].connectionName).toBe("Doomed");
  });

  it("logs survive deletion of the connection they belong to", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const conn = await createConnection({ enterpriseId, name: `Ephemeral ${Date.now()}`, inviteCode: "x" });

    const before = await prisma.channelSyncLog.count({ where: { connectionId: conn.id } });
    expect(before).toBeGreaterThan(0);

    await prisma.channelConnection.delete({ where: { id: conn.id } });

    // SetNull, not Cascade — the entries explaining WHY a connection was removed are
    // exactly the ones worth keeping, and the snapshotted name keeps them readable.
    const after = await prisma.channelSyncLog.findMany({ where: { connectionName: { startsWith: "Ephemeral" } } });
    expect(after.length).toBe(before);
    expect(after[0].connectionId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  it("filters by outcome and scopes to the caller's enterprise", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const conn = await createConnection({ enterpriseId, name: `Filter ${Date.now()}`, inviteCode: "x" });
    stubBeds24({ error: "nope" }, false, 401);
    await testConnection(conn.id);

    const failed = await listSyncLogs(enterpriseId, { outcome: "failed" });
    expect(failed.logs.length).toBeGreaterThan(0);
    expect(failed.logs.every((l) => !l.ok)).toBe(true);

    const ok = await listSyncLogs(enterpriseId, { outcome: "ok" });
    expect(ok.logs.every((l) => l.ok)).toBe(true);

    // A different enterprise sees none of it.
    const other = await listSyncLogs(otherEnterpriseId);
    expect(other.logs).toEqual([]);
  });

  it("pages with a cursor rather than an offset", async () => {
    const page1 = await listSyncLogs(enterpriseId, { limit: 2 });
    expect(page1.logs.length).toBeLessThanOrEqual(2);
    if (page1.nextCursor) {
      const page2 = await listSyncLogs(enterpriseId, { limit: 2, cursor: page1.nextCursor });
      const ids1 = page1.logs.map((l) => l.id);
      // No repeats across the boundary — the reason for cursor paging on a table that is
      // written to continuously.
      expect(page2.logs.every((l) => !ids1.includes(l.id))).toBe(true);
    }
  });

  it("pruneSyncLogs removes only entries older than the cutoff", async () => {
    const old = await prisma.channelSyncLog.create({
      data: {
        enterpriseId,
        connectionName: "Ancient",
        direction: "OUTBOUND",
        operation: "auth.token",
        ok: true,
        createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      },
    });
    const recentCount = await prisma.channelSyncLog.count({ where: { enterpriseId } });

    const removed = await pruneSyncLogs(enterpriseId, 30);

    expect(removed).toBe(1);
    expect(await prisma.channelSyncLog.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.channelSyncLog.count({ where: { enterpriseId } })).toBe(recentCount - 1);
  });

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  it("GET /api/hub/sync-logs refuses a PROPERTY-scoped user even with Admin rights", async () => {
    cookieJar.clear();
    await createSession(propertyScopedUserId);
    const res = await syncLogsRoute.GET(new Request("http://localhost/api/hub/sync-logs"));
    expect(res.status).toBe(403);
    await destroySession();
  });

  it("GET /api/hub/sync-logs returns only the caller's own enterprise's entries", async () => {
    cookieJar.clear();
    await createSession(adminId);
    const res = await syncLogsRoute.GET(new Request("http://localhost/api/hub/sync-logs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
    // Every returned row belongs to this enterprise — verified against the DB, not just
    // trusted from the response.
    const ids = body.logs.map((l: { id: string }) => l.id);
    const mine = await prisma.channelSyncLog.count({ where: { id: { in: ids }, enterpriseId } });
    expect(mine).toBe(ids.length);
    await destroySession();
  });
});
