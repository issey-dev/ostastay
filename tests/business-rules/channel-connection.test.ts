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
const { channelTarget } = await import("../helpers/channel");
const { createSession, destroySession } = await import("@/lib/auth");
const { isEncryptedSecret, decryptSecret } = await import("@/lib/secret-crypto");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createConnection, toPublicConnection, testConnection, getPropertyConnection } = await import(
  "@/lib/channels/connection"
);
const { daysUntilRefreshTokenExpiry, needsKeepAlive, isAccessTokenStale, REFRESH_TOKEN_IDLE_DAYS } = await import(
  "@/lib/channels/beds24"
);
const connectionsRoute = await import("@/app/api/hub/connections/route");
const connectionByIdRoute = await import("@/app/api/hub/connections/[id]/route");
const webhookRoute = await import("@/app/api/hub/connections/[id]/webhook/route");
const { hashWebhookToken } = await import("@/lib/channels/webhook-token");

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
  let scopedPropertyId: string;

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
          roles: { create: { roleId: roleIds["Admin"] } },
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

    // A property-scoped user WITH full Admin rights — the Hub serves them their own
    // property's channel manager only (one connection per property, 2026-09-23).
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
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "PROPERTY",
        propertyId: property.id,
      },
    });
    propertyScopedUserId = propUser.id;
    scopedPropertyId = property.id;
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
      ...(await channelTarget(enterpriseAId)),
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
      ...(await channelTarget(enterpriseAId)),
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
      createConnection({ ...(await channelTarget(enterpriseAId)), name: `Bad ${Date.now()}`, inviteCode: "nope" })
    ).rejects.toThrow();

    // A saved-but-unusable connection would report a credential it cannot authenticate.
    expect(await prisma.channelConnection.count({ where: { enterpriseId: enterpriseAId } })).toBe(before);
  });

  it("a failed health check records the reason and marks the connection ERROR", async () => {
    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    const created = await createConnection({
      ...(await channelTarget(enterpriseAId)),
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

  it("a PROPERTY-scoped admin reads their own property's connection, never another property's", async () => {
    stubBeds24({ refreshToken: "r-own", token: "a-own", expiresIn: 86400 });
    const own = await createConnection({
      propertyId: scopedPropertyId,
      externalPropertyId: `ext-own-${Date.now()}`,
      name: `Own ${Date.now()}`,
      inviteCode: "own",
    });
    const sibling = await channelTarget(enterpriseAId);
    await createConnection({ ...sibling, name: `Sibling ${Date.now()}`, inviteCode: "sib" });

    const get = (propertyId: string) =>
      connectionsRoute.GET(new Request(`http://localhost/api/hub/connections?propertyId=${propertyId}`));
    cookieJar.clear();
    await createSession(propertyScopedUserId);
    const mine = await get(scopedPropertyId);
    expect(mine.status).toBe(200);
    expect((await mine.json()).connection.id).toBe(own.id);
    expect((await get(sibling.propertyId)).status).toBe(403);
    await destroySession();
  });

  it("one connection per property — a second one for the same property is refused before the invite code is spent", async () => {
    const target = await channelTarget(enterpriseAId);
    stubBeds24({ refreshToken: "r-1", token: "a-1", expiresIn: 86400 });
    const first = await createConnection({ ...target, name: `First ${Date.now()}`, inviteCode: "one" });
    expect(await prisma.channelPropertyLink.count({ where: { connectionId: first.id, propertyId: target.propertyId } })).toBe(1);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(createConnection({ ...target, name: `Second ${Date.now()}`, inviteCode: "two" })).rejects.toThrow(/already has/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connections are scoped to the caller's own enterprise", async () => {
    stubBeds24({ refreshToken: "r-a", token: "a-a", expiresIn: 86400 });
    const target = await channelTarget(enterpriseAId);
    await createConnection({ ...target, name: `Scoped ${Date.now()}`, inviteCode: "x" });
    expect(await getPropertyConnection(target.propertyId)).not.toBeNull();

    // Enterprise B's admin cannot read enterprise A's property at all.
    cookieJar.clear();
    await createSession(adminBId);
    const res = await connectionsRoute.GET(new Request(`http://localhost/api/hub/connections?propertyId=${target.propertyId}`));
    expect(res.status).toBe(403);
    await destroySession();
  });

  // ---------------------------------------------------------------------------
  // Self-service (2026-10-14): each enterprise connects to its OWN Beds24 account.
  // ---------------------------------------------------------------------------

  const post = (body: unknown) =>
    connectionsRoute.POST(
      new Request("http://localhost/api/hub/connections", { method: "POST", body: JSON.stringify(body) })
    );
  const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

  it("an enterprise admin connects its own property with its own invite code", async () => {
    stubBeds24({ refreshToken: "r-self", token: "a-self", expiresIn: 86400 });
    const target = await channelTarget(enterpriseAId);

    cookieJar.clear();
    await createSession(adminAId);
    const res = await post({ ...target, name: "Self connect", inviteCode: "mine" });
    expect(res.status).toBe(201);
    const { connection } = await res.json();
    expect(connection.status).toBe("CONNECTED");
    expect("refreshToken" in connection).toBe(false);
    expect(await prisma.channelPropertyLink.count({ where: { propertyId: target.propertyId } })).toBe(1);
    // The action lands in the enterprise's own activity trail.
    expect(
      await prisma.userActivityLog.count({ where: { enterpriseId: enterpriseAId, entityId: connection.id, action: "CREATE" } })
    ).toBe(1);
    await destroySession();
  });

  it("a PROPERTY-scoped admin can connect only their own property", async () => {
    const sibling = await channelTarget(enterpriseAId);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    cookieJar.clear();
    await createSession(propertyScopedUserId);
    const res = await post({ ...sibling, name: "Not mine", inviteCode: "x" });
    expect(res.status).toBe(403);
    // Refused before the single-use invite code is spent.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.channelConnection.findUnique({ where: { propertyId: sibling.propertyId } })).toBeNull();
    await destroySession();
  });

  it("another enterprise's admin cannot connect, re-authorize or remove this enterprise's property", async () => {
    stubBeds24({ refreshToken: "r-x", token: "a-x", expiresIn: 86400 });
    const existing = await createConnection({ ...(await channelTarget(enterpriseAId)), name: `Guarded ${Date.now()}`, inviteCode: "g" });
    const foreign = await channelTarget(enterpriseAId);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    cookieJar.clear();
    await createSession(adminBId);
    expect((await post({ ...foreign, name: "Intruder", inviteCode: "i" })).status).toBe(403);
    const patch = await connectionByIdRoute.PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ inviteCode: "i" }) }),
      ctxFor(existing.id)
    );
    expect(patch.status).toBe(403);
    expect((await connectionByIdRoute.DELETE(new Request("http://localhost/x"), ctxFor(existing.id))).status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.channelConnection.findUnique({ where: { id: existing.id } })).not.toBeNull();
    await destroySession();
  });

  it("an enterprise admin re-authorizes, corrects the Beds24 id, mints a webhook and disconnects", async () => {
    stubBeds24({ refreshToken: "r-1", token: "a-1", expiresIn: 86400 });
    const existing = await createConnection({ ...(await channelTarget(enterpriseAId)), name: `Manage ${Date.now()}`, inviteCode: "m" });

    cookieJar.clear();
    await createSession(adminAId);

    stubBeds24({ refreshToken: "r-2-new", token: "a-2", expiresIn: 86400 });
    const reauth = await connectionByIdRoute.PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ inviteCode: "fresh" }) }),
      ctxFor(existing.id)
    );
    expect(reauth.status).toBe(200);
    const row = await prisma.channelConnection.findUnique({ where: { id: existing.id } });
    expect(decryptSecret(row!.refreshToken)).toBe("r-2-new");

    const fix = await connectionByIdRoute.PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ externalPropertyId: "999111" }) }),
      ctxFor(existing.id)
    );
    expect(fix.status).toBe(200);
    expect((await prisma.channelPropertyLink.findUnique({ where: { propertyId: existing.propertyId } }))?.externalPropertyId).toBe("999111");

    const hook = await webhookRoute.POST(new Request("http://localhost/x", { method: "POST" }), ctxFor(existing.id));
    expect(hook.status).toBe(200);
    const { path } = await hook.json();
    const stored = await prisma.channelConnection.findUnique({ where: { id: existing.id }, select: { webhookTokenHash: true } });
    expect(stored!.webhookTokenHash).toBe(hashWebhookToken(path.split("/").pop()!));

    expect((await connectionByIdRoute.DELETE(new Request("http://localhost/x"), ctxFor(existing.id))).status).toBe(200);
    expect(await prisma.channelConnection.findUnique({ where: { id: existing.id } })).toBeNull();
    await destroySession();
  });
});
