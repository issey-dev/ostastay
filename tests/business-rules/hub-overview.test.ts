import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// The Hub Overview (Hub Setup Phase 6 — src/lib/hub-overview.ts): banners only for what
// needs attention, each linking to the fix, scoped to the properties and modules the user
// may set up; channel-manager status per property; failed background jobs only.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { loadHubOverview } = await import("@/lib/hub-overview");
const { connectProperty } = await import("../helpers/channel");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function overviewFor(userId: string) {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await loadHubOverview(await requireSession(), "veyo");
  } finally {
    await destroySession();
  }
}

describe("Hub Overview", () => {
  let enterpriseId: string;
  let beachId: string;
  let lagoonId: string;
  let adminId: string;
  let lagoonAdminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "OV", slug: `test-ov-${uniq()}`, type: "STANDARD" } })).id;
    const make = (name: string) =>
      prisma.property.create({
        data: { enterpriseId, name, code: `OV-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      });
    beachId = (await make("Beach")).id;
    lagoonId = (await make("Lagoon")).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `ov-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    lagoonAdminId = (await prisma.user.create({
      data: { enterpriseId, email: `ov-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: lagoonId },
    })).id;
  });

  it("flags missing setup on a bare property, each banner linking to the section that fixes it", async () => {
    const { banners } = await overviewFor(adminId);
    const beach = banners.filter((b) => b.id.startsWith(`${beachId}:`));
    const ids = beach.map((b) => b.id.split(":")[1]);
    expect(ids).toEqual(expect.arrayContaining(["room-types", "accommodation-code", "payment-methods"]));
    const roomTypes = beach.find((b) => b.id.endsWith(":room-types"))!;
    expect(roomTypes.severity).toBe("critical");
    expect(roomTypes.href).toBe(`/e/veyo/hub/p/${beachId}/inventory`);
    // Critical banners come first.
    const firstWarning = banners.findIndex((b) => b.severity === "warning");
    if (firstWarning >= 0) expect(banners.slice(firstWarning).every((b) => b.severity === "warning")).toBe(true);
  });

  it("clears a banner once the setup exists", async () => {
    const rt = await prisma.roomType.create({ data: { propertyId: beachId, code: "STD", name: "Standard", maxOccupancy: 2 } });
    await prisma.room.create({ data: { propertyId: beachId, roomTypeId: rt.id, roomNumber: "101", status: "AVAILABLE" } });
    const { banners } = await overviewFor(adminId);
    expect(banners.some((b) => b.id === `${beachId}:room-types` || b.id === `${beachId}:rooms`)).toBe(false);
  });

  it("shows each property's channel-manager status, and a banner only when the connection fails", async () => {
    const { connection } = await connectProperty(beachId, { syncEnabled: true });
    let overview = await overviewFor(adminId);
    expect(overview.channels?.find((c) => c.propertyId === beachId)?.status).toBe("ACTIVE");
    expect(overview.channels?.find((c) => c.propertyId === lagoonId)?.status).toBe("NOT_CONNECTED");
    expect(overview.banners.some((b) => b.id === `${beachId}:channel-error`)).toBe(false);

    await prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: "Refresh token expired" } });
    overview = await overviewFor(adminId);
    const error = overview.banners.find((b) => b.id === `${beachId}:channel-error`);
    expect(error?.detail).toBe("Refresh token expired");
  });

  it("warns a week before a channel credential lapses from lack of refreshing", async () => {
    const { connection } = await connectProperty(lagoonId, { connection: { status: "CONNECTED", lastTokenRefreshAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000) } });
    const banner = (await overviewFor(adminId)).banners.find((b) => b.id === `${lagoonId}:channel-token`);
    expect(banner?.severity).toBe("warning");
    expect(banner?.title).toContain("5 days");
    await prisma.channelConnection.delete({ where: { id: connection.id } });
  });

  it("shows a background job only when its latest run failed", async () => {
    await prisma.jobRun.create({ data: { enterpriseId, jobName: "channel-keepalive", status: "SUCCEEDED", finishedAt: new Date() } });
    expect((await overviewFor(adminId)).banners.some((b) => b.id.startsWith("enterprise:job:"))).toBe(false);
    await prisma.jobRun.create({ data: { enterpriseId, jobName: "channel-keepalive", status: "FAILED", error: "Beds24 unreachable", finishedAt: new Date() } });
    const job = (await overviewFor(adminId)).banners.find((b) => b.id === "enterprise:job:channel-keepalive");
    expect(job?.severity).toBe("critical");
    expect(job?.href).toBeUndefined();
  });

  it("shows a single-property admin their own property only, and nothing enterprise-level", async () => {
    const { banners, channels } = await overviewFor(lagoonAdminId);
    expect(banners.length).toBeGreaterThan(0);
    expect(banners.every((b) => b.id.startsWith(`${lagoonId}:`))).toBe(true);
    expect(channels?.map((c) => c.propertyId)).toEqual([lagoonId]);
  });

  it("says email is not set up only when neither own SMTP nor the Uppsolut Mail Service can send", async () => {
    // No SMTP of its own and no service: guest mail is blocked — the banner is right.
    expect((await overviewFor(adminId)).banners.some((b) => b.id === "enterprise:smtp")).toBe(true);
    // Granted the Uppsolut Mail Service (PLATFORM_EMAIL): mail goes through it, so there is
    // nothing for the enterprise to set up (resolveEnterpriseSender, src/lib/mail-sender.ts).
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "PLATFORM_EMAIL", enabled: true } });
    expect((await overviewFor(adminId)).banners.some((b) => b.id === "enterprise:smtp")).toBe(false);
    await prisma.enterpriseAddonAccess.deleteMany({ where: { enterpriseId, module: "PLATFORM_EMAIL" } });
  });
});
