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

process.env.SECRETS_ENCRYPTION_KEY = "test-sharing-key";

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createConnection } = await import("@/lib/channels/connection");
const {
  createPropertyLink,
  setRoomTypeMapping,
  setRatePlanMapping,
  setSyncEnabled,
  listPropertyLinks,
  computeReadiness,
} = await import("@/lib/channels/sharing");
const { ForbiddenError } = await import("@/lib/scope");
const linksRoute = await import("@/app/api/hub/property-links/route");

function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response));
}

async function makeProperty(enterpriseId: string, name: string) {
  return prisma.property.create({
    data: {
      enterpriseId,
      name,
      code: `${name.slice(0, 2).toUpperCase()}-${Date.now()}-${Math.floor(performance.now() * 1000) % 10000}`,
      legalName: `${name} LLC`,
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    },
  });
}

describe("Channel sharing & mapping", () => {
  let enterpriseId: string;
  let otherEnterpriseId: string;
  let adminId: string;
  let propertyScopedUserId: string;
  let connectionId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ent = await prisma.enterprise.create({
      data: { name: `Share Ent ${Date.now()}`, slug: `test-share-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 5 } });

    const other = await prisma.enterprise.create({
      data: { name: `Share Other ${Date.now()}`, slug: `test-shareo-${Date.now()}`, type: "STANDARD" },
    });
    otherEnterpriseId = other.id;
    await prisma.enterpriseLicense.create({
      data: { enterpriseId: otherEnterpriseId, tier: "STANDARD", maxProperties: 5 },
    });

    adminId = (
      await prisma.user.create({
        data: {
          enterpriseId,
          email: `share-admin-${Date.now()}@test.local`,
          passwordHash,
          firstName: "Share",
          lastName: "Admin",
          roleId: roleIds["Admin"],
          scope: "ENTERPRISE",
        },
      })
    ).id;

    const scopedProp = await makeProperty(enterpriseId, "Scoped");
    propertyScopedUserId = (
      await prisma.user.create({
        data: {
          enterpriseId,
          email: `share-prop-${Date.now()}@test.local`,
          passwordHash,
          firstName: "Prop",
          lastName: "Scoped",
          roleId: roleIds["Admin"],
          scope: "PROPERTY",
          propertyId: scopedProp.id,
        },
      })
    ).id;

    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    connectionId = (
      await createConnection({ enterpriseId, name: `Share Conn ${Date.now()}`, inviteCode: "x" })
    ).id;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // The double-sell rule — the most consequential constraint here.
  // ---------------------------------------------------------------------------

  it("refuses to link one property through two channel-manager connections", async () => {
    const property = await makeProperty(enterpriseId, "Double");
    stubBeds24({ refreshToken: "r2", token: "a2", expiresIn: 86400 });
    const secondConnection = await createConnection({
      enterpriseId,
      name: `Second ${Date.now()}`,
      inviteCode: "y",
    });

    await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: "ext-1",
    });

    // Two connections both pushing availability for the same rooms and both accepting
    // bookings is a double-sell — it surfaces as an overbooked guest at the desk, never as
    // an error in software. Hence one property, one channel manager.
    await expect(
      createPropertyLink({
        enterpriseId,
        connectionId: secondConnection.id,
        propertyId: property.id,
        externalPropertyId: "ext-2",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await prisma.channelPropertyLink.count({ where: { propertyId: property.id } })).toBe(1);
  });

  it("refuses to link a property belonging to another enterprise", async () => {
    const foreign = await makeProperty(otherEnterpriseId, "Foreign");
    await expect(
      createPropertyLink({ enterpriseId, connectionId, propertyId: foreign.id, externalPropertyId: "ext-9" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // Readiness — sharing must not start half-mapped.
  // ---------------------------------------------------------------------------

  it("computeReadiness ignores inactive and unshared room types, and is never ready with nothing shared", () => {
    const base = { roomTypeName: "n", roomTypeCode: "c" };
    expect(
      computeReadiness([
        { ...base, roomTypeId: "1", isActive: true, shared: true, externalRoomId: "x" },
        // Inactive: not sellable, so it cannot hold up sharing.
        { ...base, roomTypeId: "2", isActive: false, shared: true, externalRoomId: null },
        // Deliberately held back (sold direct only) — also not a blocker.
        { ...base, roomTypeId: "3", isActive: true, shared: false, externalRoomId: null },
      ])
    ).toEqual({ unmapped: 0, ready: true });

    expect(
      computeReadiness([{ ...base, roomTypeId: "1", isActive: true, shared: true, externalRoomId: null }])
    ).toEqual({ unmapped: 1, ready: false });

    // Nothing to sell is not "ready" — enabling it would look like success while publishing
    // no inventory at all.
    expect(computeReadiness([])).toEqual({ unmapped: 0, ready: false });
  });

  it("refuses to enable sharing while an active room type is unmapped, and allows it once mapped", async () => {
    const property = await makeProperty(enterpriseId, "Ready");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-ready-${Date.now()}`,
    });
    const rtA = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    const rtB = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Suite", code: "STE", maxOccupancy: 4 },
    });

    // A half-mapped push is worse than no push: it looks like it worked.
    await expect(setSyncEnabled({ enterpriseId, linkId: link.id, enabled: true })).rejects.toBeInstanceOf(
      ForbiddenError
    );

    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rtA.id, externalRoomId: "beds-a" });
    // Still one to go.
    await expect(setSyncEnabled({ enterpriseId, linkId: link.id, enabled: true })).rejects.toBeInstanceOf(
      ForbiddenError
    );

    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rtB.id, externalRoomId: "beds-b" });
    await setSyncEnabled({ enterpriseId, linkId: link.id, enabled: true });

    const after = await prisma.channelPropertyLink.findUnique({ where: { id: link.id } });
    expect(after?.syncEnabled).toBe(true);
  });

  it("a new link never starts sharing on its own", async () => {
    const property = await makeProperty(enterpriseId, "Fresh");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-fresh-${Date.now()}`,
    });
    // Publishing inventory must be an explicit act, never a side effect of linking.
    expect(link.syncEnabled).toBe(false);
  });

  it("disabling sharing is always allowed, even when mapping is incomplete", async () => {
    const property = await makeProperty(enterpriseId, "Stopit");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-stop-${Date.now()}`,
    });
    const rt = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Std", code: "S1", maxOccupancy: 2 },
    });
    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rt.id, externalRoomId: "b1" });
    await setSyncEnabled({ enterpriseId, linkId: link.id, enabled: true });

    // Break the mapping, then stop sharing — stopping must never be blocked.
    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rt.id, externalRoomId: "" });
    await setSyncEnabled({ enterpriseId, linkId: link.id, enabled: false });

    const after = await prisma.channelPropertyLink.findUnique({ where: { id: link.id } });
    expect(after?.syncEnabled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Mapping integrity
  // ---------------------------------------------------------------------------

  it("refuses to map a room type that belongs to a different property", async () => {
    const linked = await makeProperty(enterpriseId, "Linked");
    const elsewhere = await makeProperty(enterpriseId, "Elsewhere");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: linked.id,
      externalPropertyId: `ext-x-${Date.now()}`,
    });
    const strayRoomType = await prisma.roomType.create({
      data: { propertyId: elsewhere.id, name: "Stray", code: "STR", maxOccupancy: 2 },
    });

    // Otherwise one property's inventory would be published under another property's roof.
    await expect(
      setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: strayRoomType.id, externalRoomId: "b" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("clearing a mapping removes it and makes the link not ready again", async () => {
    const property = await makeProperty(enterpriseId, "Clear");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-clear-${Date.now()}`,
    });
    const rt = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Std", code: "C1", maxOccupancy: 2 },
    });

    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rt.id, externalRoomId: "beds-c" });
    let links = await listPropertyLinks(enterpriseId);
    expect(links.find((l) => l.id === link.id)?.ready).toBe(true);

    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rt.id, externalRoomId: "  " });
    links = await listPropertyLinks(enterpriseId);
    expect(links.find((l) => l.id === link.id)?.ready).toBe(false);
    expect(await prisma.channelRoomTypeMap.count({ where: { roomTypeId: rt.id } })).toBe(0);
  });

  it("rate-plan mapping is optional and does not gate readiness", async () => {
    const property = await makeProperty(enterpriseId, "Rates");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-rate-${Date.now()}`,
    });
    const rt = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Std", code: "R1", maxOccupancy: 2 },
    });
    await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "Best Available" } });

    await setRoomTypeMapping({ enterpriseId, linkId: link.id, roomTypeId: rt.id, externalRoomId: "beds-r" });

    // Ready with room types mapped and no rate mapping at all — a property can push
    // availability on a default rate long before per-plan mapping exists.
    const links = await listPropertyLinks(enterpriseId);
    const found = links.find((l) => l.id === link.id);
    expect(found?.ready).toBe(true);
    expect(found?.ratePlans[0].externalRateId).toBeNull();
  });

  it("refuses to map a rate plan from another property", async () => {
    const a = await makeProperty(enterpriseId, "RPa");
    const b = await makeProperty(enterpriseId, "RPb");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: a.id,
      externalPropertyId: `ext-rp-${Date.now()}`,
    });
    const strayPlan = await prisma.ratePlan.create({ data: { propertyId: b.id, code: "X", name: "Stray" } });

    await expect(
      setRatePlanMapping({ enterpriseId, linkId: link.id, ratePlanId: strayPlan.id, externalRateId: "r" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  it("a PROPERTY-scoped user is refused, and enterprises cannot see each other's links", async () => {
    cookieJar.clear();
    await createSession(propertyScopedUserId);
    expect((await linksRoute.GET()).status).toBe(403);
    await destroySession();

    // The other enterprise has links of its own in the same DB; none must leak.
    expect(await listPropertyLinks(otherEnterpriseId)).toEqual([]);

    cookieJar.clear();
    await createSession(adminId);
    const res = await linksRoute.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.links.map((l: { propertyId: string }) => l.propertyId);
    const mine = await prisma.property.count({ where: { id: { in: ids }, enterpriseId } });
    expect(mine).toBe(ids.length);
    await destroySession();
  });

  it("availableProperties excludes already-linked properties", async () => {
    const free = await makeProperty(enterpriseId, "Free");

    cookieJar.clear();
    await createSession(adminId);
    const res = await linksRoute.GET();
    const body = await res.json();
    const availableIds = body.availableProperties.map((p: { id: string }) => p.id);
    const linkedIds = body.links.map((l: { propertyId: string }) => l.propertyId);

    expect(availableIds).toContain(free.id);
    // The UI must not offer a property that would immediately be refused.
    expect(linkedIds.some((id: string) => availableIds.includes(id))).toBe(false);
    await destroySession();
  });
});
