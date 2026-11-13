import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 5 (9.5.0): portal logins, sign-in through the Agent API, the two
// authentication layers, isolation, and the read side (me, property, availability, quote) —
// with the owner's rule that an agent sees ONLY their Source's negotiated rates.

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
const { createSession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { invitePortalLogin, setPortalLoginStatus } = await import("@/lib/agent-api/auth");
const { serverToday } = await import("@/lib/business-date");
const { setPropertySettings } = await import("../helpers/property-settings");
const { ensureChart } = await import("../helpers/charge-codes");

const loginRoute = await import("@/app/api/agent/v1/auth/login/route");
const acceptRoute = await import("@/app/api/agent/v1/auth/accept-invite/route");
const logoutRoute = await import("@/app/api/agent/v1/auth/logout/route");
const meRoute = await import("@/app/api/agent/v1/me/route");
const propertyRoute = await import("@/app/api/agent/v1/properties/[propertyId]/route");
const availabilityRoute = await import("@/app/api/agent/v1/properties/[propertyId]/availability/route");
const quoteRoute = await import("@/app/api/agent/v1/properties/[propertyId]/quote/route");

const DAY = 86_400_000;
const day = (o: number) => new Date(serverToday().getTime() + o * DAY).toISOString().slice(0, 10);
const noParams = { params: Promise.resolve({}) } as { params: Promise<Record<string, never>> };
const prop = (propertyId: string) => ({ params: Promise.resolve({ propertyId }) });

function req(url: string, key: string, opts: { method?: string; body?: unknown; token?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (opts.token) headers["x-agent-token"] = opts.token;
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`http://localhost${url}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("Agent API: sign-in and read side", () => {
  const stamp = Date.now();
  let enterpriseId: string;
  let propertyId: string;
  let offPropertyId: string;
  let roomTypeId: string;
  let sourceA: string;
  let sourceB: string;
  let agentKey: string;
  let roomsKey: string;
  let otherAgentKey: string;
  let adminId: string;
  const PASSWORD = "correct-horse-battery";

  beforeAll(async () => {
    await _resetWebsiteRateLimiter();
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `Agt ${stamp}`, slug: `test-agt-${stamp}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 5 } });
    const mk = (code: string) =>
      prisma.property.create({
        data: {
          enterpriseId, name: `Agt ${code}`, code: `${code}-${stamp}`, legalName: "L", defaultCurrency: "USD",
          timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday(),
        },
      });
    propertyId = (await mk("AGP")).id;
    offPropertyId = (await mk("OFF")).id;
    await ensureChart({ propertyId });
    await setPropertySettings(propertyId, { agentPortalEnabled: true, agentAvailabilityCap: 2, tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false });
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 3 } })).id;
    await prisma.room.createMany({ data: [1, 2, 3, 4, 5].map((n) => ({ propertyId, roomTypeId, roomNumber: `30${n}`, status: "AVAILABLE" })) });
    const base = await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } });
    const bar = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Published BAR", priority: 1 } });
    const neg = await prisma.ratePlan.create({ data: { propertyId, code: "TIERA", name: "Tier A contract", isNegotiated: true, priority: 5 } });
    for (let i = 0; i < 70; i++) {
      const date = new Date(serverToday().getTime() + i * DAY);
      await prisma.priceCalendar.createMany({
        data: [
          { ratePlanId: base.id, roomTypeId, date, price: 300 },
          { ratePlanId: bar.id, roomTypeId, date, price: 250 },
          { ratePlanId: neg.id, roomTypeId, date, price: 180 },
        ],
      });
    }
    sourceA = (await prisma.profile.create({ data: { enterpriseId, firstName: "A", companyName: "Atoll Tours", profileType: "SOURCE", commissionRate: 10 } })).upid;
    sourceB = (await prisma.profile.create({ data: { enterpriseId, firstName: "B", companyName: "Beach DMC", profileType: "SOURCE" } })).upid;
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: neg.id, upid: sourceA } });

    adminId = (
      await prisma.user.create({
        data: { enterpriseId, email: `agt-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
    agentKey = (await createWebsiteApiKey({ enterpriseId, userId: adminId, name: "Portal", propertyId: null, allowedOrigins: [], scopes: ["AGENT"], expiresAt: null })).key;
    otherAgentKey = (await createWebsiteApiKey({ enterpriseId, userId: adminId, name: "Portal 2", propertyId: null, allowedOrigins: [], scopes: ["AGENT"], expiresAt: null })).key;
    roomsKey = (await createWebsiteApiKey({ enterpriseId, userId: adminId, name: "Site", propertyId: null, allowedOrigins: [], scopes: ["ROOMS"], expiresAt: null })).key;
  });

  const staff = async () => {
    cookieJar.clear();
    await createSession(adminId);
    return requireSession();
  };

  async function signUp(source: string, email: string) {
    const ctx = await staff();
    const inv = await invitePortalLogin(ctx, source, { email, name: email });
    const res = await acceptRoute.POST(req("/api/agent/v1/auth/accept-invite", agentKey, { method: "POST", body: { token: inv.token, password: PASSWORD } }), noParams);
    expect(res.status).toBe(201);
    return (await res.json()).token as string;
  }

  it("an AGENT key may never carry browser origins", async () => {
    await expect(
      createWebsiteApiKey({ enterpriseId, userId: adminId, name: "Bad", propertyId: null, allowedOrigins: ["https://agents.example.com"], scopes: ["AGENT"], expiresAt: null })
    ).rejects.toThrow(/server-to-server/);
  });

  it("invite → accept → sign in → me; the invite works once; wrong passwords answer the same", async () => {
    const ctx = await staff();
    const inv = await invitePortalLogin(ctx, sourceA, { email: `Ann-${stamp}@Example.com`, name: "Ann" });
    const accepted = await acceptRoute.POST(req("/x", agentKey, { method: "POST", body: { token: inv.token, password: PASSWORD } }), noParams);
    expect(accepted.status).toBe(201);
    const again = await acceptRoute.POST(req("/x", agentKey, { method: "POST", body: { token: inv.token, password: PASSWORD } }), noParams);
    expect(again.status).toBe(400);

    const wrong = await loginRoute.POST(req("/x", agentKey, { method: "POST", body: { email: `ann-${stamp}@example.com`, password: "nope-nope-nope" } }), noParams);
    const unknown = await loginRoute.POST(req("/x", agentKey, { method: "POST", body: { email: `nobody-${stamp}@example.com`, password: "nope-nope-nope" } }), noParams);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).code).toBe((await unknown.json()).code);

    const ok = await loginRoute.POST(req("/x", agentKey, { method: "POST", body: { email: `ann-${stamp}@example.com`, password: PASSWORD } }), noParams);
    expect(ok.status).toBe(200);
    const { token } = await ok.json();
    const me = await (await meRoute.GET(req("/api/agent/v1/me", agentKey, { token }), noParams)).json();
    expect(me.source.name).toBe("Atoll Tours");
    expect(me.properties.map((p: { id: string }) => p.id)).toEqual([propertyId]); // OFF has the portal switched off
    expect(me.properties[0].rates.map((r: { code: string }) => r.code)).toEqual(["TIERA"]);

    await logoutRoute.POST(req("/x", agentKey, { method: "POST", token }), noParams);
    expect((await meRoute.GET(req("/x", agentKey, { token }), noParams)).status).toBe(401);
  });

  it("two layers: no key, wrong scope, no token, token from another key, a browser origin", async () => {
    const token = await signUp(sourceA, `two-${stamp}@example.com`);
    expect((await meRoute.GET(new Request("http://localhost/x", { headers: { "x-agent-token": token } }), noParams)).status).toBe(401);
    expect((await meRoute.GET(req("/x", roomsKey, { token }), noParams)).status).toBe(403);
    expect((await meRoute.GET(req("/x", agentKey), noParams)).status).toBe(401);
    expect((await meRoute.GET(req("/x", otherAgentKey, { token }), noParams)).status).toBe(401);
    expect((await meRoute.GET(req("/x", agentKey, { token, origin: "https://evil.example" }), noParams)).status).toBe(403);
    // A staff session never opens an agent route: signed in as staff, no agent token → 401.
    await staff();
    expect((await meRoute.GET(req("/x", agentKey), noParams)).status).toBe(401);
  });

  it("suspending a login signs it out", async () => {
    const ctx = await staff();
    const token = await signUp(sourceA, `sus-${stamp}@example.com`);
    const u = await prisma.agentUser.findFirstOrThrow({ where: { email: `sus-${stamp}@example.com` } });
    await setPortalLoginStatus(ctx, sourceA, u.id, "SUSPENDED");
    expect((await meRoute.GET(req("/x", agentKey, { token }), noParams)).status).toBe(401);
  });

  it("a property with the portal off answers 404", async () => {
    const token = await signUp(sourceA, `off-${stamp}@example.com`);
    expect((await propertyRoute.GET(req("/x", agentKey, { token }), prop(offPropertyId))).status).toBe(404);
  });

  it("availability: negotiated rate only, house capped, own slots exact; a Source with no rate sees on request", async () => {
    const tokenA = await signUp(sourceA, `cal-a-${stamp}@example.com`);
    const res = await availabilityRoute.GET(req(`/x?from=${day(10)}&to=${day(13)}`, agentKey, { token: tokenA }), prop(propertyId));
    expect(res.status).toBe(200);
    const a = await res.json();
    expect(a.ratePlan.code).toBe("TIERA");
    const night = a.roomTypes[0].nights[0];
    expect(night.rate).toBe(180); // never the published 250
    expect(night.available).toBeNull(); // 5 free > cap 2
    expect(night.availableLabel).toBe("2+");
    expect(night.status).toBe("AVAILABLE");
    expect(JSON.stringify(a)).not.toMatch(/Published BAR|"250"|:250/);

    const tokenB = await signUp(sourceB, `cal-b-${stamp}@example.com`);
    const b = await (await availabilityRoute.GET(req(`/x?from=${day(10)}&to=${day(11)}`, agentKey, { token: tokenB }), prop(propertyId))).json();
    expect(b.ratePlan).toBeNull();
    expect(b.roomTypes[0].nights[0].status).toBe("ON_REQUEST");
    expect(b.roomTypes[0].nights[0].rate).toBeNull();
  });

  it("quote: on the negotiated plan with the commission estimate; a published plan is refused", async () => {
    const token = await signUp(sourceA, `q-${stamp}@example.com`);
    const ok = await quoteRoute.POST(req("/x", agentKey, { method: "POST", token, body: { roomTypeId, checkIn: day(20), checkOut: day(22), adults: 2 } }), prop(propertyId));
    const q = await ok.json();
    expect(ok.status, JSON.stringify(q)).toBe(200);
    expect(q.ratePlan.code).toBe("TIERA");
    expect(q.totals.roomBase).toBe(360);
    expect(q.commission).toEqual({ rate: 10, base: 360, amount: 36 });
    const bar = await prisma.ratePlan.findFirstOrThrow({ where: { propertyId, code: "BAR" } });
    const refused = await quoteRoute.POST(req("/x", agentKey, { method: "POST", token, body: { roomTypeId, ratePlanId: bar.id, checkIn: day(20), checkOut: day(22) } }), prop(propertyId));
    expect(refused.status).toBe(400);
  });

  it("ten wrong passwords lock the account", async () => {
    await signUp(sourceA, `lock-${stamp}@example.com`);
    await _resetWebsiteRateLimiter();
    for (let i = 0; i < 10; i++) {
      await loginRoute.POST(req("/x", agentKey, { method: "POST", body: { email: `lock-${stamp}@example.com`, password: `wrong-${i}-xxxxxx` } }), noParams);
    }
    await _resetWebsiteRateLimiter();
    const right = await loginRoute.POST(req("/x", agentKey, { method: "POST", body: { email: `lock-${stamp}@example.com`, password: PASSWORD } }), noParams);
    expect(right.status).toBe(401);
  });
});
