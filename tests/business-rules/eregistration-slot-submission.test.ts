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
const applyRoute = await import("@/app/api/reservations/[id]/eregistration-link/slots/[slotId]/apply/route");
const reopenRoute = await import("@/app/api/reservations/[id]/eregistration-link/slots/[slotId]/reopen/route");
const guestSlotRoute = await import("@/app/api/eregistration/[token]/slots/[slotId]/route");
const finalizeRoute = await import("@/app/api/eregistration/[token]/slots/[slotId]/finalize/route");

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SIG = "data:image/png;base64," + "A".repeat(200);

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

async function setup(adults = 2) {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: "EReg", slug: `test-ereg2-${uniq()}`, type: "STANDARD" } });
  const biz = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: "P", code: `EREG2-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: biz },
  });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Lead", lastName: "Guest" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id, confirmationNo: `EREG2-${uniq()}`, primaryGuestId: guest.upid,
      checkInDate: biz, checkOutDate: new Date(biz.getTime() + 2 * DAY), status: "RESERVED", adults, children: 0,
    },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `ereg2-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "E", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });

  const genRes = await asUser(admin.id, () => linkRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/eregistration-link`, { method: "POST" }), { params: Promise.resolve({ id: reservation.id }) }));
  const { token } = await genRes.json();
  const slots = await prisma.eRegistrationGuestSlot.findMany({ where: { reservationId: reservation.id }, orderBy: { slotIndex: "asc" } });

  return { enterpriseId: enterprise.id, propertyId: property.id, reservationId: reservation.id, primaryGuestId: guest.upid, adminId: admin.id, token, slots };
}

const patchSlot = (token: string, slotId: string, body: object) =>
  guestSlotRoute.PATCH(new Request(`http://localhost/api/eregistration/${token}/slots/${slotId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token, slotId }) });

const finalize = (token: string, slotId: string) =>
  finalizeRoute.POST(new Request(`http://localhost/api/eregistration/${token}/slots/${slotId}/finalize`, { method: "POST" }), { params: Promise.resolve({ token, slotId }) });

const VALID_SUBMISSION = {
  firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-01-01", nationality: "British",
  documentType: "PASSPORT", documentNumber: "P1000001", signatureDataUrl: SIG,
};

describe("eRegistration guest slot submission", () => {
  it("finalize rejects a slot missing required fields", async () => {
    const { token, slots } = await setup(1);
    const res = await finalize(token, slots[0].id);
    expect(res.status).toBe(400);
  });

  it("finalize rejects a slot with everything but a signature", async () => {
    const { token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, { ...VALID_SUBMISSION, signatureDataUrl: null });
    const res = await finalize(token, slots[0].id);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it("finalize succeeds once every required field plus signature is present, and locks the slot", async () => {
    const { token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    const res = await finalize(token, slots[0].id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("SUBMITTED");
    expect(body.submittedAt).not.toBeNull();
  });

  it("a SUBMITTED slot 409s on further PATCH — draft/finalize split makes the multi-tab race safe", async () => {
    const { token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);
    const res = await patchSlot(token, slots[0].id, { firstName: "Changed" });
    expect(res.status).toBe(409);
  });

  it("a SUBMITTED slot 409s on a second finalize call", async () => {
    const { token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);
    const res = await finalize(token, slots[0].id);
    expect(res.status).toBe(409);
  });

  it("childrenInfo can only be set on the primary slot", async () => {
    const { token, slots } = await setup(2);
    const nonPrimary = slots.find((s) => !s.isPrimary)!;
    const res = await patchSlot(token, nonPrimary.id, { childrenInfo: [{ name: "Kid", dateOfBirth: null }] });
    expect(res.status).toBe(400);
  });

  it("narrows to a status-only shape via GET once a slot is no longer PENDING", async () => {
    const { token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);
    const res = await guestSlotRoute.GET(new Request(`http://localhost/api/eregistration/${token}/slots/${slots[0].id}`), { params: Promise.resolve({ token, slotId: slots[0].id }) });
    const body = await res.json();
    expect(body.status).toBe("SUBMITTED");
    expect(body.documentNumber).toBeUndefined();
    expect(body.signatureDataUrl).toBeUndefined();
  });
});

describe("eRegistration staff review — reopen and apply", () => {
  it("staff reopen unlocks a SUBMITTED slot back to PENDING, clearing the submission stamp", async () => {
    const { reservationId, adminId, token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);

    const res = await asUser(adminId, () => reopenRoute.POST(new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/slots/${slots[0].id}/reopen`, { method: "POST" }), { params: Promise.resolve({ id: reservationId, slotId: slots[0].id }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("PENDING");
    expect(body.submittedAt).toBeNull();

    // Reopened means editable again.
    const patchAgain = await patchSlot(token, slots[0].id, { firstName: "Edited" });
    expect(patchAgain.status).toBe(200);
  });

  it("apply merges a SUBMITTED slot into an existing guest's Profile and creates a ProfileDocument", async () => {
    const { reservationId, adminId, primaryGuestId, token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);

    const res = await asUser(adminId, () => applyRoute.POST(
      new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/slots/${slots[0].id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: reservationId, slotId: slots[0].id }) }
    ));
    expect(res.status).toBe(200);

    const profile = await prisma.profile.findUniqueOrThrow({ where: { upid: primaryGuestId }, include: { documents: true } });
    expect(profile.nationality).toBe("British");
    expect(profile.documents.some((d) => d.documentNumber === "P1000001")).toBe(true);

    const slot = await prisma.eRegistrationGuestSlot.findUniqueOrThrow({ where: { id: slots[0].id } });
    expect(slot.status).toBe("APPLIED");
    expect(slot.appliedByUserId).toBe(adminId);
  });

  it("apply upserts rather than throwing when the guest already has that exact document (P2002 avoidance)", async () => {
    const { reservationId, adminId, primaryGuestId, token, slots } = await setup(1);
    await prisma.profileDocument.create({ data: { upid: primaryGuestId, documentType: "PASSPORT", documentNumber: "P1000001", issuingCountry: "Old Country" } });

    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);

    const res = await asUser(adminId, () => applyRoute.POST(
      new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/slots/${slots[0].id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: reservationId, slotId: slots[0].id }) }
    ));
    expect(res.status).toBe(200);

    const docs = await prisma.profileDocument.findMany({ where: { upid: primaryGuestId, documentType: "PASSPORT", documentNumber: "P1000001" } });
    expect(docs).toHaveLength(1); // updated in place, not duplicated
  });

  it("apply creates a new Profile and links it as an accompanying guest for a slot with no existingProfileId", async () => {
    const { reservationId, adminId, token, slots } = await setup(2);
    const newGuestSlot = slots.find((s) => !s.isPrimary)!;
    await patchSlot(token, newGuestSlot.id, VALID_SUBMISSION);
    await finalize(token, newGuestSlot.id);

    const res = await asUser(adminId, () => applyRoute.POST(
      new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/slots/${newGuestSlot.id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: reservationId, slotId: newGuestSlot.id }) }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profileUpid).toBeTruthy();

    const link = await prisma.accompanyingGuest.findFirst({ where: { reservationId, profileId: body.profileUpid } });
    expect(link).not.toBeNull();
    const newProfile = await prisma.profile.findUniqueOrThrow({ where: { upid: body.profileUpid } });
    expect(newProfile.firstName).toBe("Jane");
  });

  it("apply respects a selective fields list — omitting 'personal' leaves the existing name untouched", async () => {
    const { reservationId, adminId, primaryGuestId, token, slots } = await setup(1);
    await patchSlot(token, slots[0].id, VALID_SUBMISSION);
    await finalize(token, slots[0].id);

    await asUser(adminId, () => applyRoute.POST(
      new Request(`http://localhost/api/reservations/${reservationId}/eregistration-link/slots/${slots[0].id}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fields: ["document"] }) }),
      { params: Promise.resolve({ id: reservationId, slotId: slots[0].id }) }
    ));

    const profile = await prisma.profile.findUniqueOrThrow({ where: { upid: primaryGuestId } });
    expect(profile.firstName).toBe("Lead"); // untouched — "personal" was not in the selected fields
    expect(profile.lastName).toBe("Guest");
  });
});
