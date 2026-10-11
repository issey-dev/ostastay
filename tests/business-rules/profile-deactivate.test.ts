import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

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
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const profileRoute = await import("@/app/api/profiles/[upid]/route");
const activeRoute = await import("@/app/api/profiles/[upid]/active/route");
const listRoute = await import("@/app/api/profiles/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Profiles: delete only when fresh, otherwise deactivate", () => {
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "PD", slug: `test-pd-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({
      data: { enterpriseId, name: "P", code: `PD-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    propertyId = property.id;
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `pd-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "PD", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  const guest = (extra: Record<string, unknown> = {}) =>
    prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Pat", lastName: `Guest-${uniq()}`, ...extra } });
  const del = (upid: string) =>
    asUser(adminId, () => profileRoute.DELETE(new Request(`http://localhost/api/profiles/${upid}`, { method: "DELETE" }), { params: Promise.resolve({ upid }) }));
  const setActive = (upid: string, isActive: boolean) =>
    asUser(adminId, () =>
      activeRoute.POST(new Request(`http://localhost/api/profiles/${upid}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) }), { params: Promise.resolve({ upid }) })
    );

  it("deletes a fresh profile", async () => {
    const p = await guest();
    expect((await del(p.upid)).status).toBe(204);
    expect(await prisma.profile.findUnique({ where: { upid: p.upid } })).toBeNull();
  });

  it("refuses to delete a profile that has a booking, and says to deactivate", async () => {
    const p = await guest();
    await prisma.reservation.create({
      data: { propertyId, confirmationNo: `PD-${uniq()}`, primaryGuestId: p.upid, checkInDate: new Date("2026-01-01"), checkOutDate: new Date("2026-01-03"), adults: 1, status: "CHECKED_OUT" },
    });
    const res = await del(p.upid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Deactivate it instead/);
    expect(await prisma.profile.findUnique({ where: { upid: p.upid } })).not.toBeNull();
  });

  it("also treats other links as links: an accompanying guest, a group block's payee", async () => {
    const accompanying = await guest();
    const owner = await guest();
    const res = await prisma.reservation.create({
      data: { propertyId, confirmationNo: `PD-${uniq()}`, primaryGuestId: owner.upid, checkInDate: new Date("2026-01-01"), checkOutDate: new Date("2026-01-03"), adults: 2, status: "CHECKED_OUT" },
    });
    await prisma.accompanyingGuest.create({ data: { reservationId: res.id, profileId: accompanying.upid } });
    expect((await del(accompanying.upid)).status).toBe(409);

    const payee = await guest({ profileType: "COMPANY", companyName: "Payee Co", isCreditAccount: true });
    await prisma.groupBlock.create({ data: { propertyId, code: `G-${uniq()}`, name: "G", startDate: new Date("2026-02-01"), endDate: new Date("2026-02-05"), payeeProfileId: payee.upid } });
    expect((await del(payee.upid)).status).toBe(409);
  });

  it("deactivates and reactivates; a deactivated profile drops out of the pickers' list but not Client Relations'", async () => {
    const p = await guest();
    await prisma.reservation.create({
      data: { propertyId, confirmationNo: `PD-${uniq()}`, primaryGuestId: p.upid, checkInDate: new Date("2026-01-01"), checkOutDate: new Date("2026-01-03"), adults: 1, status: "CHECKED_OUT" },
    });
    expect((await setActive(p.upid, false)).status).toBe(200);
    const row = await prisma.profile.findUniqueOrThrow({ where: { upid: p.upid } });
    expect(row.isActive).toBe(false);
    expect(row.deactivatedAt).toBeTruthy();

    const list = async (qs: string) =>
      asUser(adminId, async () => (await listRoute.GET(new Request(`http://localhost/api/profiles?${qs}`))).json()) as Promise<{ upid: string; linkCount: number }[]>;
    expect((await list("")).some((x) => x.upid === p.upid)).toBe(false);
    const withInactive = await list("includeInactive=1");
    const found = withInactive.find((x) => x.upid === p.upid);
    expect(found?.linkCount).toBe(1);

    expect((await setActive(p.upid, true)).status).toBe(200);
    expect((await prisma.profile.findUniqueOrThrow({ where: { upid: p.upid } })).isActive).toBe(true);
  });

  it("won't deactivate a guest who has a booking still to come", async () => {
    const p = await guest();
    await prisma.reservation.create({
      data: { propertyId, confirmationNo: `PD-${uniq()}`, primaryGuestId: p.upid, checkInDate: new Date("2027-01-01"), checkOutDate: new Date("2027-01-03"), adults: 1, status: "RESERVED" },
    });
    const res = await setActive(p.upid, false);
    expect(res.status).toBe(400);
    expect((await prisma.profile.findUniqueOrThrow({ where: { upid: p.upid } })).isActive).toBe(true);
  });
});
