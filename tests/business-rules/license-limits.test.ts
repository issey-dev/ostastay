import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// SaaS licensing rules (owner decisions 2026-07-31): manual price + lifecycle on the
// enterprise license, per-property attribute caps, pseudo (PM) exclusions, and the
// grace-then-lockout behaviour. See src/lib/license.ts.

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
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const {
  computeLicenseState,
  isLicenseUsable,
  assertRoomTypeCapacity,
  assertRoomCapacity,
  assertChannelCapacity,
  getPropertyLicenseUsage,
} = await import("@/lib/license");
const { setRoomTypeMapping } = await import("@/lib/channels/sharing");
const { requireSession } = await import("@/lib/scope");

const DAY = 24 * 60 * 60 * 1000;

async function makeProperty(enterpriseId: string, name: string) {
  return prisma.property.create({
    data: {
      enterpriseId,
      name,
      code: `LI-${Date.now()}-${Math.floor(performance.now() * 1000) % 100000}`,
      legalName: `${name} LLC`,
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    },
  });
}

async function makeRoomType(propertyId: string, code: string, isPseudo = false) {
  return prisma.roomType.create({
    data: { propertyId, name: code, code: `${code}-${Date.now() % 100000}`, maxOccupancy: 2, isPseudo },
  });
}

describe("License lifecycle state", () => {
  it("treats a missing license row as usable (fail-open) but flags it", () => {
    const s = computeLicenseState(null);
    expect(s.state).toBe("UNLICENSED");
    expect(isLicenseUsable(s.state)).toBe(true);
  });

  it("is ACTIVE with no expiry, and ACTIVE before expiry", () => {
    expect(computeLicenseState({ status: "ACTIVE", expiresAt: null, graceDays: 7 }).state).toBe("ACTIVE");
    expect(
      computeLicenseState({ status: "ACTIVE", expiresAt: new Date(Date.now() + DAY), graceDays: 7 }).state
    ).toBe("ACTIVE");
  });

  it("enters GRACE after expiry, then EXPIRED after the grace window", () => {
    const expiredYesterday = { status: "ACTIVE", expiresAt: new Date(Date.now() - DAY), graceDays: 7 };
    const inGrace = computeLicenseState(expiredYesterday);
    expect(inGrace.state).toBe("GRACE");
    expect(isLicenseUsable("GRACE")).toBe(true);
    expect(inGrace.graceEndsAt!.getTime()).toBe(expiredYesterday.expiresAt.getTime() + 7 * DAY);

    const wellPast = computeLicenseState({ status: "ACTIVE", expiresAt: new Date(Date.now() - 10 * DAY), graceDays: 7 });
    expect(wellPast.state).toBe("EXPIRED");
    expect(isLicenseUsable("EXPIRED")).toBe(false);
  });

  it("zero grace days means expiry locks out immediately", () => {
    const s = computeLicenseState({ status: "ACTIVE", expiresAt: new Date(Date.now() - 1000), graceDays: 0 });
    expect(s.state).toBe("EXPIRED");
  });

  it("REVOKED wins over everything, including an unexpired license", () => {
    const s = computeLicenseState({ status: "REVOKED", expiresAt: new Date(Date.now() + 30 * DAY), graceDays: 7 });
    expect(s.state).toBe("REVOKED");
    expect(isLicenseUsable("REVOKED")).toBe(false);
  });
});

describe("Per-property attribute caps", () => {
  let enterpriseId: string;
  let propertyId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Lic Ent ${Date.now()}`, slug: `test-lic-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 10 } });
    propertyId = (await makeProperty(enterpriseId, "Capped")).id;
  });

  it("no allowance row means unlimited", async () => {
    await expect(assertRoomTypeCapacity(propertyId)).resolves.toBeUndefined();
    await expect(assertRoomCapacity(propertyId)).resolves.toBeUndefined();
    await expect(assertChannelCapacity(propertyId)).resolves.toBeUndefined();
  });

  it("enforces the room-type cap, but pseudo room types never count", async () => {
    await prisma.propertyLicenseAllowance.create({
      data: { propertyId, maxRoomTypes: 2, maxRooms: 3, maxChannels: 0 },
    });

    await makeRoomType(propertyId, "RT1");
    // A pseudo room type is invisible to the cap: 1 real + 1 pseudo is still under a cap of 2.
    await makeRoomType(propertyId, "PM", true);
    await expect(assertRoomTypeCapacity(propertyId)).resolves.toBeUndefined();

    await makeRoomType(propertyId, "RT2");
    await expect(assertRoomTypeCapacity(propertyId)).rejects.toThrow(/2 room types/);
  });

  it("enforces the room cap, excluding rooms of pseudo room types", async () => {
    const [real, pseudo] = await Promise.all([
      prisma.roomType.findFirst({ where: { propertyId, isPseudo: false } }),
      prisma.roomType.findFirst({ where: { propertyId, isPseudo: true } }),
    ]);
    await prisma.room.createMany({
      data: [
        { propertyId, roomTypeId: real!.id, roomNumber: "101" },
        { propertyId, roomTypeId: real!.id, roomNumber: "102" },
        // PM rooms — outside the licensed count entirely.
        { propertyId, roomTypeId: pseudo!.id, roomNumber: "PM1" },
        { propertyId, roomTypeId: pseudo!.id, roomNumber: "PM2" },
      ],
    });
    // 2 real rooms against a cap of 3 — fine, even though 4 rooms exist in total.
    await expect(assertRoomCapacity(propertyId)).resolves.toBeUndefined();

    await prisma.room.create({ data: { propertyId, roomTypeId: real!.id, roomNumber: "103" } });
    await expect(assertRoomCapacity(propertyId)).rejects.toThrow(/3 rooms/);

    const usage = await getPropertyLicenseUsage(propertyId);
    expect(usage.roomTypes).toBe(2);
    expect(usage.rooms).toBe(3);
  });

  it("maxChannels 0 refuses channel linking outright", async () => {
    await expect(assertChannelCapacity(propertyId)).rejects.toThrow(/does not include channel connections/);
  });
});

describe("PM room types on channels", () => {
  it("refuses to map a pseudo room type to a channel", async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Lic Map ${Date.now()}`, slug: `test-licmap-${Date.now()}`, type: "STANDARD" },
    });
    const property = await makeProperty(ent.id, "Mapped");
    const pseudo = await makeRoomType(property.id, "PMX", true);

    const connection = await prisma.channelConnection.create({
      data: { enterpriseId: ent.id, provider: "BEDS24", name: "Test conn" },
    });
    const link = await prisma.channelPropertyLink.create({
      data: { connectionId: connection.id, propertyId: property.id, externalPropertyId: "ext-1" },
    });

    await expect(
      setRoomTypeMapping({
        enterpriseId: ent.id,
        linkId: link.id,
        roomTypeId: pseudo.id,
        externalRoomId: "ext-room-9",
      })
    ).rejects.toThrow(/PM \(pseudo\) room types are not supported/);
  });
});

describe("License lockout at requireSession", () => {
  let enterpriseId: string;
  let userId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const ent = await prisma.enterprise.create({
      data: { name: `Lic Lock ${Date.now()}`, slug: `test-liclock-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await makeProperty(enterpriseId, "Lockout");
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const entRoleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    userId = (
      await prisma.user.create({
        data: {
          enterpriseId,
          email: `lic-lock-${Date.now()}@test.local`,
          passwordHash: await bcrypt.hash("password123", 10),
          firstName: "Lock",
          lastName: "Out",
          roles: { create: { roleId: entRoleIds["Admin"] ?? roleIds["Admin"] } },
          scope: "ENTERPRISE",
        },
      })
    ).id;
  });

  it("lets a GRACE-state session through, kills an EXPIRED one", async () => {
    await prisma.enterpriseLicense.create({
      data: { enterpriseId, tier: "STANDARD", maxProperties: 5, expiresAt: new Date(Date.now() - DAY), graceDays: 7 },
    });
    await createSession(userId);
    // Expired yesterday with 7 grace days → still usable.
    await expect(requireSession()).resolves.toMatchObject({ userId });

    // Push the expiry past the grace window → the same live session dies on next call.
    await prisma.enterpriseLicense.update({
      where: { enterpriseId },
      data: { expiresAt: new Date(Date.now() - 10 * DAY) },
    });
    await expect(requireSession()).rejects.toThrow(/license has expired/);

    // Revocation reads the same way.
    await prisma.enterpriseLicense.update({
      where: { enterpriseId },
      data: { expiresAt: null, status: "REVOKED" },
    });
    await expect(requireSession()).rejects.toThrow(/revoked/);
  });
});
