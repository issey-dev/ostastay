import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts.
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
const { primaryEmail, primaryMobile, validateCommunicationValue } = await import("@/lib/profile-communications");

const profilesRoute = await import("@/app/api/profiles/route");
const communicationsRoute = await import("@/app/api/profiles/[upid]/communications/route");
const communicationIdRoute = await import("@/app/api/profiles/[upid]/communications/[id]/route");
const addressesRoute = await import("@/app/api/profiles/[upid]/addresses/route");
const documentsRoute = await import("@/app/api/profiles/[upid]/documents/route");
const preferencesRoute = await import("@/app/api/profiles/[upid]/preferences/route");
const stayHistoryRoute = await import("@/app/api/profiles/[upid]/stay-history/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const DAY = 86400000;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

async function setup(slug: string) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: slug, slug: `${slug}-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `PC-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `pc-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "PC", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  return { enterpriseId: enterprise.id, propertyId: property.id, adminId: admin.id };
}

describe("Profile communications: pure validation", () => {
  it("validates email format for EMAIL type", () => {
    expect(validateCommunicationValue("EMAIL", "guest@example.com")).toBeNull();
    expect(validateCommunicationValue("EMAIL", "not-an-email")).toMatch(/valid email/);
  });

  it("validates loose phone format for MOBILE type", () => {
    expect(validateCommunicationValue("MOBILE", "+960 555 0100")).toBeNull();
    expect(validateCommunicationValue("MOBILE", "abc")).toMatch(/valid phone/);
  });

  it("SOCIAL type only requires non-empty", () => {
    expect(validateCommunicationValue("SOCIAL", "@myhandle")).toBeNull();
    expect(validateCommunicationValue("SOCIAL", "")).toMatch(/required/);
  });

  it("primaryEmail/primaryMobile prefer the isPrimary row, fall back to first of type", () => {
    const rows = [
      { type: "EMAIL", value: "second@example.com", isPrimary: false },
      { type: "EMAIL", value: "primary@example.com", isPrimary: true },
      { type: "MOBILE", value: "+1 555 0100", isPrimary: false },
    ];
    expect(primaryEmail(rows)).toBe("primary@example.com");
    expect(primaryMobile(rows)).toBe("+1 555 0100");
    expect(primaryEmail([])).toBeUndefined();
  });
});

describe("Profile child resources: API-level behavior", () => {
  it("rejects an invalid email/mobile at the API layer", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-invalid");
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G" } });

    const badEmail = await asUser(adminId, () =>
      communicationsRoute.POST(
        new Request("http://localhost/api/profiles/x/communications", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "EMAIL", value: "nope" }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    expect(badEmail.status).toBe(400);
  });

  it("promoting a new primary communication demotes the previous one", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-primary");
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G" } });

    const first = await asUser(adminId, () =>
      communicationsRoute.POST(
        new Request("http://localhost/api/profiles/x/communications", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "EMAIL", value: "one@example.com", isPrimary: true }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    const firstBody = await first.json();

    await asUser(adminId, () =>
      communicationsRoute.POST(
        new Request("http://localhost/api/profiles/x/communications", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "EMAIL", value: "two@example.com", isPrimary: true }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );

    const rows = await prisma.profileCommunication.findMany({ where: { upid: guest.upid } });
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r) => r.value === "two@example.com")?.isPrimary).toBe(true);
    expect(rows.find((r) => r.id === firstBody.id)?.isPrimary).toBe(false);
  });

  it("cross-profile access is blocked (communication row must belong to the requested profile)", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-cross");
    const guestA = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "A" } });
    const guestB = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "B" } });
    const comm = await prisma.profileCommunication.create({ data: { upid: guestA.upid, type: "EMAIL", value: "a@example.com" } });

    const res = await asUser(adminId, () =>
      communicationIdRoute.DELETE(
        new Request("http://localhost/api/profiles/x/communications/y", { method: "DELETE" }),
        { params: Promise.resolve({ upid: guestB.upid, id: comm.id }) }
      )
    );
    expect(res.status).toBe(404);
    expect(await prisma.profileCommunication.findUnique({ where: { id: comm.id } })).not.toBeNull();
  });

  it("addresses require a full address and support multiple with one primary", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-address");
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G" } });

    const missing = await asUser(adminId, () =>
      addressesRoute.POST(
        new Request("http://localhost/api/profiles/x/addresses", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "HOME" }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    expect(missing.status).toBe(400);

    await asUser(adminId, () =>
      addressesRoute.POST(
        new Request("http://localhost/api/profiles/x/addresses", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "HOME", fullAddress: "123 Main St", country: "US", isPrimary: true }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    const rows = await prisma.profileAddress.findMany({ where: { upid: guest.upid } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isPrimary).toBe(true);
  });

  it("documents (Identification) support multiple with one primary via real per-row CRUD", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-docs");
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G" } });

    await asUser(adminId, () =>
      documentsRoute.POST(
        new Request("http://localhost/api/profiles/x/documents", {
          method: "POST", headers: { "content-type": "application/json" },
          // isPrimary defaults to false when unspecified (consistent with Communications/
          // Address) — the UI managers compute `rows.length === 0` themselves; mirror
          // that here for the first row.
          body: JSON.stringify({ documentType: "PASSPORT", documentNumber: "P1234567", isPrimary: true }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    await asUser(adminId, () =>
      documentsRoute.POST(
        new Request("http://localhost/api/profiles/x/documents", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ documentType: "NATIONAL_ID", documentNumber: "N7654321" }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    const rows = await prisma.profileDocument.findMany({ where: { upid: guest.upid } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r) => r.documentType === "PASSPORT")?.isPrimary).toBe(true);
  });

  it("preferences PUT replaces the whole category (multi-select semantics)", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-prefs");
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G" } });

    await asUser(adminId, () =>
      preferencesRoute.PUT(
        new Request("http://localhost/api/profiles/x/preferences", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: "DIETARY", values: ["VEGAN", "GLUTEN_FREE"] }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    let rows = await prisma.profilePreference.findMany({ where: { upid: guest.upid, category: "DIETARY" } });
    expect(rows.map((r) => r.value).sort()).toEqual(["GLUTEN_FREE", "VEGAN"]);

    // Replacing with a smaller set drops the removed one.
    await asUser(adminId, () =>
      preferencesRoute.PUT(
        new Request("http://localhost/api/profiles/x/preferences", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: "DIETARY", values: ["VEGAN"] }),
        }),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    rows = await prisma.profilePreference.findMany({ where: { upid: guest.upid, category: "DIETARY" } });
    expect(rows.map((r) => r.value)).toEqual(["VEGAN"]);
  });
});

describe("Profile: STAFF type", () => {
  it("creates and filters STAFF profiles distinctly from GUEST", async () => {
    const { enterpriseId, adminId } = await setup("test-pc-staff");

    const res = await asUser(adminId, () =>
      profilesRoute.POST(
        new Request("http://localhost/api/profiles", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ profileType: "STAFF", firstName: "Ravi", lastName: "Perera" }),
        })
      )
    );
    expect(res.status).toBe(201);
    const staff = await res.json();
    expect(staff.profileType).toBe("STAFF");

    const listRes = await asUser(adminId, () =>
      profilesRoute.GET(new Request(`http://localhost/api/profiles?profileType=STAFF`))
    );
    const list = await listRes.json();
    expect(list.some((p: { upid: string }) => p.upid === staff.upid)).toBe(true);
    expect(list.every((p: { profileType: string }) => p.profileType === "STAFF")).toBe(true);
    void enterpriseId;
  });
});

describe("Profile: origin property + stay history", () => {
  it("sets originPropertyId once at creation from the client's active property context", async () => {
    const { enterpriseId, propertyId, adminId } = await setup("test-pc-origin");

    const res = await asUser(adminId, () =>
      profilesRoute.POST(
        new Request("http://localhost/api/profiles", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ profileType: "GUEST", firstName: "Origin", originPropertyId: propertyId }),
        })
      )
    );
    const created = await res.json();
    expect(created.originPropertyId).toBe(propertyId);
    void enterpriseId;
  });

  it("splits reservations into future vs history and computes a per-charge-code revenue breakdown", async () => {
    const { enterpriseId, propertyId, adminId } = await setup("test-pc-stayhistory");

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: roomType.id, roomNumber: "101" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Best Available" } });
    const roomCode = await customChargeCode(enterpriseId, { code: "1000", description: "Room" });
    const fbCode = await customChargeCode(enterpriseId, { code: "FB", description: "F&B" });
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Stay" } });

    const today = new Date();
    // Past, checked-out stay with two charge codes.
    const pastRes = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `SH-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(today.getTime() - 10 * DAY), checkOutDate: new Date(today.getTime() - 8 * DAY),
        status: "CHECKED_OUT",
        assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, startDate: new Date(today.getTime() - 10 * DAY), endDate: new Date(today.getTime() - 8 * DAY) } },
        folios: { create: { folioNumber: 1, propertyId, lineItems: { create: [
          { chargeCodeId: roomCode.id, date: today, description: "Room", amount: 200, taxAmount: 20 },
          { chargeCodeId: fbCode.id, date: today, description: "Dinner", amount: 50, taxAmount: 5 },
        ] } } },
      },
    });

    // Future, reserved stay.
    await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `SH-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(today.getTime() + 10 * DAY), checkOutDate: new Date(today.getTime() + 12 * DAY),
        status: "RESERVED",
        assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, startDate: new Date(today.getTime() + 10 * DAY), endDate: new Date(today.getTime() + 12 * DAY) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
    });

    const res = await asUser(adminId, () =>
      stayHistoryRoute.GET(
        new Request(`http://localhost/api/profiles/x/stay-history?propertyId=${propertyId}`),
        { params: Promise.resolve({ upid: guest.upid }) }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.future).toHaveLength(1);
    expect(body.history).toHaveLength(1);
    expect(body.visitsToProperty).toBe(1);

    const past = body.history[0];
    expect(past.id).toBe(pastRes.id);
    expect(past.revenueTotal).toBe(275); // 200+20+50+5
    const byCode = Object.fromEntries(past.revenueBreakdown.map((b: { code: string; amount: number }) => [b.code, b.amount]));
    expect(byCode["1000"]).toBe(220);
    expect(byCode.FB).toBe(55);
  });
});
