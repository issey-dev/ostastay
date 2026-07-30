import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

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

process.env.SECRETS_ENCRYPTION_KEY = "test-rate-limit-key";

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createConnection, setRateLimitPauseThreshold, isRateLimitPaused } = await import(
  "@/lib/channels/connection"
);
const { pushAvailabilityForLink } = await import("@/lib/channels/push");
const { pollConnection } = await import("@/lib/channels/inbound/poll");
const connectionByIdRoute = await import("@/app/api/hub/connections/[id]/route");

const DAY_MS = 24 * 60 * 60 * 1000;

/** A response whose headers actually work, unlike the plain object stubs used elsewhere —
 *  extractRateLimit() needs a real `.get()`. */
function stubBeds24WithHeaders(
  response: unknown,
  rateLimitHeaders: Record<string, string> | null,
  ok = true,
  status = 200
) {
  const spy = vi.fn(
    async () =>
      ({
        ok,
        status,
        json: async () => response,
        headers: new Headers(rateLimitHeaders ?? {}),
      }) as unknown as Response
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("Beds24 rate-limit handling", () => {
  let enterpriseId: string;
  let adminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const bcrypt = (await import("bcryptjs")).default;
    const passwordHash = await bcrypt.hash("password123", 10);

    const ent = await prisma.enterprise.create({
      data: { name: `RateLimit Ent ${Date.now()}`, slug: `test-ratelimit-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });
    adminId = (
      await prisma.user.create({
        data: {
          enterpriseId,
          email: `ratelimit-admin-${Date.now()}@test.local`,
          passwordHash,
          firstName: "Rate",
          lastName: "Admin",
          roleId: roleIds["Admin"],
          scope: "ENTERPRISE",
        },
      })
    ).id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the rate-limit headers off a real exchange onto the connection", async () => {
    stubBeds24WithHeaders(
      { refreshToken: "r", token: "a", expiresIn: 86400 },
      { "X-FiveMinCreditLimit": "300", "X-FiveMinCreditLimit-Remaining": "287", "X-FiveMinCreditLimit-ResetsIn": "120" }
    );

    const created = await createConnection({ enterpriseId, name: `RL Capture ${Date.now()}`, inviteCode: "x" });

    const row = await prisma.channelConnection.findUnique({ where: { id: created.id } });
    expect(row?.rateLimitTotal).toBe(300);
    expect(row?.rateLimitRemaining).toBe(287);
    expect(row?.rateLimitObservedAt).toBeTruthy();
    // resetsAt is derived from "seconds from now" at capture time — allow slack for test runtime.
    expect(row!.rateLimitResetsAt!.getTime()).toBeGreaterThan(Date.now());
    expect(row!.rateLimitResetsAt!.getTime()).toBeLessThanOrEqual(Date.now() + 130 * 1000);
  });

  it("leaves the rate-limit fields untouched when the response carries no such headers", async () => {
    stubBeds24WithHeaders({ refreshToken: "r2", token: "a2", expiresIn: 86400 }, null);

    const created = await createConnection({ enterpriseId, name: `RL Absent ${Date.now()}`, inviteCode: "y" });

    const row = await prisma.channelConnection.findUnique({ where: { id: created.id } });
    expect(row?.rateLimitTotal).toBeNull();
    expect(row?.rateLimitRemaining).toBeNull();
  });

  describe("isRateLimitPaused", () => {
    it("is false with no threshold configured", () => {
      expect(isRateLimitPaused({ rateLimitPauseThreshold: null, rateLimitRemaining: 0, rateLimitResetsAt: new Date(Date.now() + DAY_MS) })).toBe(false);
    });

    it("is false once the reset window has already passed, however low remaining was", () => {
      expect(
        isRateLimitPaused({ rateLimitPauseThreshold: 50, rateLimitRemaining: 0, rateLimitResetsAt: new Date(Date.now() - 1000) })
      ).toBe(false);
    });

    it("is true once remaining drops to or below the threshold within the reset window", () => {
      const resetsAt = new Date(Date.now() + DAY_MS);
      expect(isRateLimitPaused({ rateLimitPauseThreshold: 50, rateLimitRemaining: 50, rateLimitResetsAt: resetsAt })).toBe(true);
      expect(isRateLimitPaused({ rateLimitPauseThreshold: 50, rateLimitRemaining: 10, rateLimitResetsAt: resetsAt })).toBe(true);
      expect(isRateLimitPaused({ rateLimitPauseThreshold: 50, rateLimitRemaining: 51, rateLimitResetsAt: resetsAt })).toBe(false);
    });
  });

  describe("setRateLimitPauseThreshold", () => {
    it("rejects a negative or non-integer threshold", async () => {
      stubBeds24WithHeaders({ refreshToken: "r3", token: "a3", expiresIn: 86400 }, null);
      const created = await createConnection({ enterpriseId, name: `RL Validate ${Date.now()}`, inviteCode: "z" });

      await expect(setRateLimitPauseThreshold(created.id, -1)).rejects.toThrow();
      await expect(setRateLimitPauseThreshold(created.id, 2.5)).rejects.toThrow();
    });

    it("saves a valid threshold and clears it back to null", async () => {
      stubBeds24WithHeaders({ refreshToken: "r4", token: "a4", expiresIn: 86400 }, null);
      const created = await createConnection({ enterpriseId, name: `RL Save ${Date.now()}`, inviteCode: "w" });

      const saved = await setRateLimitPauseThreshold(created.id, 25);
      expect(saved.rateLimitPauseThreshold).toBe(25);

      const cleared = await setRateLimitPauseThreshold(created.id, null);
      expect(cleared.rateLimitPauseThreshold).toBeNull();
    });
  });

  it("PATCH /api/hub/connections/[id] accepts a rateLimitPauseThreshold body", async () => {
    stubBeds24WithHeaders({ refreshToken: "r5", token: "a5", expiresIn: 86400 }, null);
    const created = await createConnection({ enterpriseId, name: `RL Route ${Date.now()}`, inviteCode: "v" });

    cookieJar.clear();
    await createSession(adminId);
    const res = await connectionByIdRoute.PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ rateLimitPauseThreshold: 15 }) }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connection.rateLimitPauseThreshold).toBe(15);
    await destroySession();
  });

  it("PATCH rejects a non-numeric rateLimitPauseThreshold", async () => {
    stubBeds24WithHeaders({ refreshToken: "r6", token: "a6", expiresIn: 86400 }, null);
    const created = await createConnection({ enterpriseId, name: `RL BadRoute ${Date.now()}`, inviteCode: "u" });

    cookieJar.clear();
    await createSession(adminId);
    const res = await connectionByIdRoute.PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ rateLimitPauseThreshold: "not-a-number" }) }),
      { params: Promise.resolve({ id: created.id }) }
    );
    expect(res.status).toBe(400);
    await destroySession();
  });

  // ---------------------------------------------------------------------------
  // Self-throttling — push and poll must both refuse to call Beds24 while paused,
  // and must not make the outbound call at all (not just report a skip after the fact).
  // ---------------------------------------------------------------------------

  describe("self-throttle gates push and poll", () => {
    async function makePausedConnectionAndLink() {
      const connection = await prisma.channelConnection.create({
        data: {
          enterpriseId,
          provider: "BEDS24",
          name: `RL Paused ${Date.now()}`,
          refreshToken: "stored",
          rateLimitPauseThreshold: 10,
          rateLimitRemaining: 5,
          rateLimitResetsAt: new Date(Date.now() + DAY_MS),
        },
      });
      const property = await prisma.property.create({
        data: {
          enterpriseId,
          name: "RL Property",
          code: `RL-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          legalName: "RL LLC",
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });
      const link = await prisma.channelPropertyLink.create({
        data: { connectionId: connection.id, propertyId: property.id, externalPropertyId: "ext-rl", syncEnabled: true },
      });
      const rt = await prisma.roomType.create({
        data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 },
      });
      await prisma.room.create({ data: { propertyId: property.id, roomTypeId: rt.id, roomNumber: "1", status: "AVAILABLE" } });
      await prisma.channelRoomTypeMap.create({ data: { linkId: link.id, roomTypeId: rt.id, externalRoomId: "9", shared: true } });
      return { connection, link };
    }

    it("pushAvailabilityForLink skips with no outbound call while paused", async () => {
      const { link } = await makePausedConnectionAndLink();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await pushAvailabilityForLink({ enterpriseId, linkId: link.id });
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("Paused");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a dry run is exempt from the pause, since it never calls Beds24", async () => {
      const { link } = await makePausedConnectionAndLink();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await pushAvailabilityForLink({ enterpriseId, linkId: link.id, dryRun: true });
      expect(result.status).toBe("DRY_RUN");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("pollConnection skips with no outbound call while paused", async () => {
      const { connection } = await makePausedConnectionAndLink();
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await pollConnection(connection.id);
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("Paused");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
