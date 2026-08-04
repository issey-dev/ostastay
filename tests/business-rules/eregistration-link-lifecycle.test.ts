import { describe, it, expect, vi } from "vitest";
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

const linkRoute = await import("@/app/api/reservations/[id]/eregistration-link/route");
const revokeRoute = await import("@/app/api/reservations/[id]/eregistration-link/revoke/route");
const statusRoute = await import("@/app/api/reservations/[id]/status/route");
const eodStatusHelper = await import("@/lib/eregistration/token");

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

async function setup(adults = 2) {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: "EReg", slug: `test-ereg-${uniq()}`, type: "STANDARD" } });
  const biz = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: "P", code: `EREG-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: biz },
  });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Lead", lastName: "Guest" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id, confirmationNo: `EREG-${uniq()}`, primaryGuestId: guest.upid,
      checkInDate: biz, checkOutDate: new Date(biz.getTime() + 2 * DAY), status: "RESERVED", adults, children: 0,
    },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `ereg-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "E", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });
  return { enterpriseId: enterprise.id, propertyId: property.id, reservationId: reservation.id, primaryGuestId: guest.upid, adminId: admin.id };
}

const generate = (adminId: string, reservationId: string) =>
  asUser(adminId, () => linkRoute.POST(new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link`, { method: "POST" }), { params: Promise.resolve({ id: reservationId }) }));

const getStatus = (adminId: string, reservationId: string) =>
  asUser(adminId, () => linkRoute.GET(new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link`), { params: Promise.resolve({ id: reservationId }) }));

const revoke = (adminId: string, reservationId: string) =>
  asUser(adminId, () => revokeRoute.POST(new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/revoke`, { method: "POST" }), { params: Promise.resolve({ id: reservationId }) }));

describe("eRegistration link generation", () => {
  it("creates one slot for the primary guest plus one blank slot per remaining adult", async () => {
    const { reservationId, adminId, primaryGuestId } = await setup(2);
    const res = await generate(adminId, reservationId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toContain(body.token);

    const slots = await prisma.eRegistrationGuestSlot.findMany({ where: { reservationId }, orderBy: { slotIndex: "asc" } });
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ slotIndex: 0, isPrimary: true, existingProfileId: primaryGuestId, status: "PENDING" });
    expect(slots[1]).toMatchObject({ slotIndex: 1, isPrimary: false, existingProfileId: null, status: "PENDING" });
  });

  it("never persists the plaintext token — only its hash", async () => {
    const { reservationId, adminId } = await setup(1);
    const res = await generate(adminId, reservationId);
    const { token } = await res.json();
    const link = await prisma.eRegistrationLink.findFirst({ where: { reservationId } });
    expect(link!.tokenHash).toBe(eodStatusHelper.hashEregistrationToken(token));
    // @ts-expect-error tokenHash is the only persisted form
    expect(link!.token).toBeUndefined();
  });

  it("regenerating revokes the previous link — only one ACTIVE link per reservation", async () => {
    const { reservationId, adminId } = await setup(1);
    await generate(adminId, reservationId);
    await generate(adminId, reservationId);
    const links = await prisma.eRegistrationLink.findMany({ where: { reservationId } });
    const active = links.filter((l) => l.status === "ACTIVE");
    const revoked = links.filter((l) => l.status === "REVOKED");
    expect(active).toHaveLength(1);
    expect(revoked).toHaveLength(1);
  });

  it("regenerate reconciles slots — a SUBMITTED slot survives a headcount-driven regenerate untouched", async () => {
    const { reservationId, adminId } = await setup(2);
    await generate(adminId, reservationId);
    const slot1 = await prisma.eRegistrationGuestSlot.findFirstOrThrow({ where: { reservationId, slotIndex: 1 } });
    await prisma.eRegistrationGuestSlot.update({
      where: { id: slot1.id },
      data: { status: "SUBMITTED", firstName: "Jane", lastName: "Doe", submittedAt: new Date() },
    });

    await generate(adminId, reservationId); // regenerate — must not wipe slot 1

    const stillThere = await prisma.eRegistrationGuestSlot.findUniqueOrThrow({ where: { id: slot1.id } });
    expect(stillThere.status).toBe("SUBMITTED");
    expect(stillThere.firstName).toBe("Jane");
  });

  it("GET reports EXPIRED computed at read time, without a background job flipping the DB row", async () => {
    const { reservationId, adminId } = await setup(1);
    await generate(adminId, reservationId);
    const link = await prisma.eRegistrationLink.findFirstOrThrow({ where: { reservationId } });
    await prisma.eRegistrationLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await getStatus(adminId, reservationId);
    const body = await res.json();
    expect(body.link.status).toBe("EXPIRED");
    // The underlying DB column is untouched — still ACTIVE — confirming this is computed
    // at read time rather than requiring a cron sweep.
    const raw = await prisma.eRegistrationLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(raw.status).toBe("ACTIVE");
  });

  it("revoke fails cleanly when there is no active link", async () => {
    const { reservationId, adminId } = await setup(1);
    const res = await revoke(adminId, reservationId);
    expect(res.status).toBe(400);
  });

  it("revoke flips status and stamps who/when", async () => {
    const { reservationId, adminId } = await setup(1);
    await generate(adminId, reservationId);
    const res = await revoke(adminId, reservationId);
    expect(res.status).toBe(200);
    const link = await prisma.eRegistrationLink.findFirstOrThrow({ where: { reservationId } });
    expect(link.status).toBe("REVOKED");
    expect(link.revokedByUserId).toBe(adminId);
    expect(link.revokedAt).not.toBeNull();
  });

  it("cancelling the reservation auto-revokes its active eRegistration link", async () => {
    const { reservationId, adminId } = await setup(1);
    await generate(adminId, reservationId);

    const res = await asUser(adminId, () => statusRoute.PATCH(
      new Request(`http://localhost/api/reservations/${reservationId}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }) }),
      { params: Promise.resolve({ id: reservationId }) }
    ));
    expect(res.status).toBe(200);

    const link = await prisma.eRegistrationLink.findFirstOrThrow({ where: { reservationId } });
    expect(link.status).toBe("REVOKED");
  });

  it("marking a reservation NO_SHOW also auto-revokes its active link", async () => {
    const { reservationId, adminId } = await setup(1);
    await generate(adminId, reservationId);

    await asUser(adminId, () => statusRoute.PATCH(
      new Request(`http://localhost/api/reservations/${reservationId}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "NO_SHOW" }) }),
      { params: Promise.resolve({ id: reservationId }) }
    ));

    const link = await prisma.eRegistrationLink.findFirstOrThrow({ where: { reservationId } });
    expect(link.status).toBe("REVOKED");
  });

  it("refuses to generate a link when eRegistration is disabled for the enterprise", async () => {
    const { reservationId, adminId, enterpriseId } = await setup(1);
    await prisma.enterpriseSettings.create({ data: { enterpriseId, eRegistrationEnabled: false } });
    const res = await generate(adminId, reservationId);
    expect(res.status).toBe(400);
  });
});
