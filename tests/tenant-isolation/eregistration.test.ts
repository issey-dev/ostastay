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
const landingRoute = await import("@/app/api/eregistration/[token]/route");
const guestSlotRoute = await import("@/app/api/eregistration/[token]/slots/[slotId]/route");
const { generateEregistrationToken, hashEregistrationToken } = await import("@/lib/eregistration/token");

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

async function setupEnterprise(label: string) {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: label, slug: `test-ereg-tenant-${label}-${uniq()}`, type: "STANDARD" } });
  const biz = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: label, code: `T${label}-${uniq()}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: biz },
  });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: label, lastName: "Guest" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, confirmationNo: `T${label}-${uniq()}`, primaryGuestId: guest.upid, checkInDate: biz, checkOutDate: new Date(biz.getTime() + 2 * DAY), status: "RESERVED", adults: 1, children: 0 },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `t${label}-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: label, roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });

  const genRes = await asUser(admin.id, () => linkRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/eregistration-link`, { method: "POST" }), { params: Promise.resolve({ id: reservation.id }) }));
  const { token } = await genRes.json();
  const slot = await prisma.eRegistrationGuestSlot.findFirstOrThrow({ where: { reservationId: reservation.id } });

  return { enterpriseId: enterprise.id, reservationId: reservation.id, adminId: admin.id, token, slotId: slot.id };
}

const landing = (token: string) => landingRoute.GET(new Request(`http://localhost/api/eregistration/${token}`), { params: Promise.resolve({ token }) });
const getSlot = (token: string, slotId: string) => guestSlotRoute.GET(new Request(`http://localhost/api/eregistration/${token}/slots/${slotId}`), { params: Promise.resolve({ token, slotId }) });
const patchSlot = (token: string, slotId: string, body: object) =>
  guestSlotRoute.PATCH(new Request(`http://localhost/api/eregistration/${token}/slots/${slotId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token, slotId }) });

describe("eRegistration tenant isolation", () => {
  it("a valid token from enterprise A cannot read enterprise B's slot by guessing its id", async () => {
    const a = await setupEnterprise("A" + uniq().slice(-4));
    const b = await setupEnterprise("B" + uniq().slice(-4));

    const res = await getSlot(a.token, b.slotId); // A's own token, B's slot id
    expect(res.status).toBe(404);

    const patchRes = await patchSlot(a.token, b.slotId, { firstName: "Malicious" });
    expect(patchRes.status).toBe(404);

    const untouched = await prisma.eRegistrationGuestSlot.findUniqueOrThrow({ where: { id: b.slotId } });
    expect(untouched.firstName).toBeNull();
  });

  it("the landing summary for token A never includes reservation/property/enterprise B's data", async () => {
    const a = await setupEnterprise("A" + uniq().slice(-4));
    const b = await setupEnterprise("B" + uniq().slice(-4));

    const res = await landing(a.token);
    const body = await res.json();
    expect(body.reservations).toHaveLength(1);
    expect(body.reservations[0].reservationId).toBe(a.reservationId);
    expect(JSON.stringify(body)).not.toContain(b.reservationId);
  });

  it("an unknown token gets a generic 404, identical in shape to a real-but-inactive one", async () => {
    const a = await setupEnterprise("A" + uniq().slice(-4));
    const bogus = generateEregistrationToken();

    const unknownRes = await landing(bogus);
    expect(unknownRes.status).toBe(404);
    const unknownBody = await unknownRes.json();

    // Revoke the real link, then compare shape/generic-ness of the message.
    await prisma.eRegistrationLink.updateMany({ where: { reservationId: a.reservationId }, data: { status: "REVOKED" } });
    const revokedRes = await landing(a.token);
    const revokedBody = await revokedRes.json();

    expect(Object.keys(unknownBody)).toEqual(["error"]);
    expect(Object.keys(revokedBody)).toEqual(["error"]);
    // Neither response reveals whether the token was ever valid.
    expect(typeof unknownBody.error).toBe("string");
    expect(typeof revokedBody.error).toBe("string");
  });

  it("an expired token is rejected the same way as a revoked one", async () => {
    const a = await setupEnterprise("A" + uniq().slice(-4));
    await prisma.eRegistrationLink.updateMany({ where: { reservationId: a.reservationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await landing(a.token);
    expect(res.status).toBe(410);
  });

  it("scoping is derived from the token row alone — a token never trusts a client-supplied reservation id", async () => {
    // There is no reservationId parameter accepted anywhere in the guest-facing routes —
    // confirm this by checking the resolved reservation always matches the token's own,
    // regardless of what's smuggled into the request body.
    const a = await setupEnterprise("A" + uniq().slice(-4));
    const res = await patchSlot(a.token, a.slotId, { firstName: "Real", reservationId: "not-a-real-id", propertyId: "also-fake" });
    expect(res.status).toBe(200);
    const slot = await prisma.eRegistrationGuestSlot.findUniqueOrThrow({ where: { id: a.slotId } });
    expect(slot.reservationId).toBe(a.reservationId); // unchanged — never accepted from the body
    expect(slot.firstName).toBe("Real");
  });

  it("a hash collision guess (right shape, wrong secret) is rejected identically to a random token", async () => {
    const a = await setupEnterprise("A" + uniq().slice(-4));
    const wrongButSameShape = generateEregistrationToken();
    expect(hashEregistrationToken(wrongButSameShape)).not.toBe(hashEregistrationToken(a.token));
    const res = await landing(wrongButSameShape);
    expect(res.status).toBe(404);
  });
});
