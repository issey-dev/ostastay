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

// Encryption-at-rest is only active when a key is configured, so set one before the
// crypto module resolves it — otherwise the "stored encrypted" assertions below would
// silently pass against plaintext.
process.env.SECRETS_ENCRYPTION_KEY = "test-channel-connection-key";

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { isEncryptedSecret, decryptSecret } = await import("@/lib/secret-crypto");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createConnection, toPublicConnection, testConnection, listConnections } = await import(
  "@/lib/channels/connection"
);
const { daysUntilRefreshTokenExpiry, needsKeepAlive, isAccessTokenStale, REFRESH_TOKEN_IDLE_DAYS } = await import(
  "@/lib/channels/beds24"
);
const connectionsRoute = await import("@/app/api/hub/connections/route");
const connectionByIdRoute = await import("@/app/api/hub/connections/[id]/route");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stub Beds24's HTTP surface so no test ever makes a real outbound call. */
function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response)
  );
}

describe("Channel manager connection (Beds24)", () => {
  let enterpriseAId: string;
  let enterpriseBId: string;
  let adminAId: string;
  let adminBId: string;
  let propertyScopedUserId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const mk = async (label: string) => {
      const ent = await prisma.enterprise.create({
        data: { name: `Chan ${label} ${Date.now()}`, slug: `test-chan-${label}-${Date.now()}`, type: "STANDARD" },
      });
      await prisma.enterpriseLicense.create({
        data: { enterpriseId: ent.id, tier: "STANDARD", maxProperties: 1 },
      });
      const admin = await prisma.user.create({
        data: {
          enterpriseId: ent.id,
          email: `chan-${label}-${Date.now()}@test.local`,
          passwordHash,
          firstName: "Chan",
          lastName: label,
          roleId: roleIds["Admin"],
          scope: "ENTERPRISE",
        },
      });
      return { entId: ent.id, adminId: admin.id };
    };

    const a = await mk("a");
    const b = await mk("b");
    enterpriseAId = a.entId;
    adminAId = a.adminId;
    enterpriseBId = b.entId;
    adminBId = b.adminId;

    // A property-scoped user WITH full Admin rights — the Hub must still refuse them.
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterpriseAId,
        name: "Chan Property",
        code: `CP-${Date.now()}`,
        legalName: "Chan LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    const propUser = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId,
        email: `chan-prop-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Prop",
        lastName: "Scoped",
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
  // The 30-day idle trap — the single most important operational property here.
  // ---------------------------------------------------------------------------

  it("daysUntilRefreshTokenExpiry counts down from the idle window and goes negative once lapsed", () => {
    expect(daysUntilRefreshTokenExpiry(new Date())).toBe(REFRESH_TOKEN_IDLE_DAYS);
    expect(daysUntilRefreshTokenExpiry(new Date(Date.now() - 10 * DAY_MS))).toBe(REFRESH_TOKEN_IDLE_DAYS - 10);
    // Past the window: must report a negative number, not clamp to 0 — "expired 5 days
    // ago" and "expires today" need different operator responses.
    expect(daysUntilRefreshTokenExpiry(new Date(Date.now() - 35 * DAY_MS))).toBeLessThan(0);
    // Never refreshed — unknown, not "fine".
    expect(daysUntilRefreshTokenExpiry(null)).toBeNull();
  });

  it("needsKeepAlive fires well before the idle window closes, not at the edge", () => {
    expect(needsKeepAlive(new Date())).toBe(false);
    // A token untouched for most of the window must be flagged while there is still time
    // to act — flagging it on the final day turns one missed job into a dead connection.
    expect(needsKeepAlive(new Date(Date.now() - 25 * DAY_MS))).toBe(true);
    expect(needsKeepAlive(null)).toBe(true);
  });

  it("isAccessTokenStale treats a missing or nearly-expired token as stale", () => {
    expect(isAccessTokenStale(null)).toBe(true);
    expect(isAccessTokenStale(new Date(Date.now() - 1000))).toBe(true);
    // Within the refresh skew — must re-mint rather than risk expiry mid-sync.
    expect(isAccessTokenStale(new Date(Date.now() + 60 * 1000))).toBe(true);
    expect(isAccessTokenStale(new Date(Date.now() + 6 * 60 * 60 * 1000))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Credential handling
  // ---------------------------------------------------------------------------

  it("stores the refresh token encrypted at rest, never as plaintext", async () => {
    stubBeds24({ refreshToken: "plaintext-refresh-abc", token: "access-xyz", expiresIn: 86400 });

    const created = await createConnection({
      enterpriseId: enterpriseAId,
      name: `Enc ${Date.now()}`,
      inviteCode: "invite-123",
    });

    const row = await prisma.channelConnection.findUnique({ where: { id: created.id } });
    expect(row?.refreshToken).toBeTruthy();
    expect(isEncryptedSecret(row!.refreshToken)).toBe(true);
    expect(row!.refreshToken).not.toContain("plaintext-refresh-abc");
    // Round-trips back to the original, so encryption is real rather than mangling.
    expect(decryptSecret(row!.refreshToken)).toBe("plaintext-refresh-abc");
    // The short-lived access token is a bearer credential too — also encrypted.
    expect(isEncryptedSecret(row!.accessToken)).toBe(true);
  });

  it("the public connection shape carries no token fields at all", async () => {
    stubBeds24({ refreshToken: "secret-refresh", token: "secret-access", expiresIn: 86400 });
    const created = await createConnection({
      enterpriseId: enterpriseAId,
      name: `Redact ${Date.now()}`,
      inviteCode: "invite-456",
    });

    const row = await prisma.channelConnection.findUnique({ where: { id: created.id } });
    const pub = toPublicConnection(row!);

    // Absent, not masked — a field that cannot be serialised cannot leak via a careless
    // future spread.
    expect("refreshToken" in pub).toBe(false);
    expect("accessToken" in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("secret-refresh");
    expect(JSON.stringify(pub)).not.toContain("secret-access");
    // But the operator still learns that credentials exist.
    expect(pub.hasCredentials).toBe(true);
  });

  it("does not persist a connection when Beds24 rejects the invite code", async () => {
    stubBeds24({ error: "Invalid invite code" }, false, 401);
    const before = await prisma.channelConnection.count({ where: { enterpriseId: enterpriseAId } });

    await expect(
      createConnection({ enterpriseId: enterpriseAId, name: `Bad ${Date.now()}`, inviteCode: "nope" })
    ).rejects.toThrow();

    // A saved-but-unusable connection would report a credential it cannot authenticate.
    expect(await prisma.channelConnection.count({ where: { enterpriseId: enterpriseAId } })).toBe(before);
  });

  it("a failed health check records the reason and marks the connection ERROR", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const created = await createConnection({
      enterpriseId: enterpriseAId,
      name: `Health ${Date.now()}`,
      inviteCode: "invite-789",
    });
    expect(created.status).toBe("CONNECTED");

    stubBeds24({ error: "Refresh token expired" }, false, 401);
    const checked = await testConnection(created.id);

    expect(checked.status).toBe("ERROR");
    expect(checked.lastError).toContain("Refresh token expired");
    expect(checked.lastHealthCheckAt).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  it("GET /api/hub/connections refuses a PROPERTY-scoped user even with Admin rights", async () => {
    cookieJar.clear();
    await createSession(propertyScopedUserId);
    const res = await connectionsRoute.GET();
    expect(res.status).toBe(403);
    await destroySession();
  });

  it("connections are scoped to the caller's own enterprise", async () => {
    stubBeds24({ refreshToken: "r-a", token: "a-a", expiresIn: 86400 });
    await createConnection({ enterpriseId: enterpriseAId, name: `Scoped ${Date.now()}`, inviteCode: "x" });

    const aList = await listConnections(enterpriseAId);
    const bList = await listConnections(enterpriseBId);
    expect(aList.length).toBeGreaterThan(0);
    expect(bList.length).toBe(0);

    cookieJar.clear();
    await createSession(adminBId);
    const res = await connectionsRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toEqual([]);
    await destroySession();
  });

  it("the Hub cannot delete a connection at all — setup is Osta-level", async () => {
    stubBeds24({ refreshToken: "r-victim", token: "a-victim", expiresIn: 86400 });
    const existing = await createConnection({
      enterpriseId: enterpriseAId,
      name: `Victim ${Date.now()}`,
      inviteCode: "y",
    });

    cookieJar.clear();
    // Even the connection's OWN enterprise admin is refused: since 2026-08-03 the Beds24
    // link is established and removed from the Osta console only, because the invite code
    // belongs to the app owner's master account (see .agents/docs/DECISIONS.md).
    await createSession(adminAId);
    const res = await connectionByIdRoute.DELETE();
    expect(res.status).toBe(403);
    await destroySession();

    // And it really is still there.
    expect(await prisma.channelConnection.findUnique({ where: { id: existing.id } })).not.toBeNull();
  });

  it("the Hub cannot create or re-authorize a connection — 403 without touching Beds24", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    cookieJar.clear();
    await createSession(adminAId);

    expect((await connectionsRoute.POST()).status).toBe(403);
    expect((await connectionByIdRoute.PATCH()).status).toBe(403);

    // Refused before any outbound call — the tenant has no invite code to spend anyway.
    expect(fetchSpy).not.toHaveBeenCalled();
    await destroySession();
  });
});
