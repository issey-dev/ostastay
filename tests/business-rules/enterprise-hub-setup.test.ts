import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Hub › Enterprise fixes (2026-09-24):
//  - Properties: a tenant-created property gets the currency and time zone chosen on the
//    form (it used to fall through to USD/UTC), validated server-side; both are editable
//    while PENDING and refused once ACTIVE; a duplicate code is a readable 409.
//  - People: emails are stored trimmed + lower-case (sign-in lower-cases before lookup),
//    passwords are at least 12 characters, and the Active switch respects the onboarding
//    account and the actor's own account.
//  - Roles: "N users assigned" on a shared system role counts this enterprise only.

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
const propertiesRoute = await import("@/app/api/properties/route");
const propertyRoute = await import("@/app/api/properties/[id]/route");
const usersRoute = await import("@/app/api/settings/users/route");
const rolesRoute = await import("@/app/api/roles/route");
const { isValidTimeZone, isValidCurrency, normalizeCurrency, timeZoneOptions } = await import("@/lib/properties/property-input");
const { normalizeEmail, userIdentitySchema, MIN_PASSWORD_LENGTH } = await import("@/lib/user-account-rules");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Property codes are globally unique and the form holds them to 2–5 letters/digits.
const shortCode = () => Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, "X");
const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let roleIds: Record<string, string>;
let enterpriseId: string;
let adminId: string;

beforeAll(async () => {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" }, update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  enterpriseId = (await prisma.enterprise.create({ data: { name: "HubFix", slug: `test-hubfix-${uniq()}`, type: "STANDARD" } })).id;
  await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 10 } });
  adminId = (await prisma.user.create({
    data: {
      enterpriseId, email: `hubfix-admin-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
      firstName: "Admin", lastName: "HF", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
    },
  })).id;
});

describe("property currency / time zone rules (pure)", () => {
  it("accepts real IANA zones and rejects typos", () => {
    expect(isValidTimeZone("Indian/Maldives")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Indian/Maldivess")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("normalises and checks a 3-letter currency", () => {
    expect(normalizeCurrency(" mvr ")).toBe("MVR");
    expect(isValidCurrency("MVR")).toBe(true);
    expect(isValidCurrency("MV")).toBe(false);
    expect(isValidCurrency("US1")).toBe(false);
  });

  it("offers Indian/Maldives first, and UTC, in the picker", () => {
    const zones = timeZoneOptions();
    expect(zones[0]).toBe("Indian/Maldives");
    expect(zones).toContain("UTC");
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("tenant property create / edit", () => {
  const create = (body: Record<string, unknown>) =>
    asUser(adminId, () => propertiesRoute.POST(json("POST", "http://localhost/api/properties", body)));
  const update = (id: string, body: Record<string, unknown>) =>
    asUser(adminId, () => propertyRoute.PUT(json("PUT", `http://localhost/api/properties/${id}`, body), { params: Promise.resolve({ id }) }));
  const base = () => ({ name: "Reef House", code: shortCode(), legalName: "Reef House Pvt Ltd", checkInTime: "14:00", checkOutTime: "12:00" });

  it("stores the chosen currency and time zone instead of falling back to USD/UTC", async () => {
    const res = await create({ ...base(), defaultCurrency: "mvr", timeZone: "Indian/Maldives" });
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.defaultCurrency).toBe("MVR");
    expect(p.timeZone).toBe("Indian/Maldives");
    expect(p.status).toBe("PENDING");
  });

  it("refuses a missing or unknown time zone and a bad currency, naming the field", async () => {
    let res = await create({ ...base(), defaultCurrency: "USD" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.timeZone).toBeTruthy();

    res = await create({ ...base(), defaultCurrency: "USD", timeZone: "Mars/Olympus" });
    expect(res.status).toBe(400);

    res = await create({ ...base(), defaultCurrency: "DOLLARS", timeZone: "UTC" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.defaultCurrency).toBeTruthy();
  });

  it("answers a duplicate code with a 409 the form can show", async () => {
    const first = { ...base(), defaultCurrency: "USD", timeZone: "UTC" };
    expect((await create(first)).status).toBe(201);
    const res = await create({ ...first, name: "Another" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain(first.code);
    expect(body.fieldErrors.code).toBeTruthy();
  });

  it("lets a PENDING property change its currency and time zone", async () => {
    const p = await (await create({ ...base(), defaultCurrency: "USD", timeZone: "UTC" })).json();
    const res = await update(p.id, { defaultCurrency: "MVR", timeZone: "Indian/Maldives" });
    expect(res.status).toBe(200);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.defaultCurrency).toBe("MVR");
    expect(after.timeZone).toBe("Indian/Maldives");
  });

  it("refuses to change them once ACTIVE, but accepts the same values re-sent", async () => {
    const p = await (await create({ ...base(), defaultCurrency: "USD", timeZone: "Indian/Maldives" })).json();
    await prisma.property.update({ where: { id: p.id }, data: { status: "ACTIVE" } });

    expect((await update(p.id, { timeZone: "UTC" })).status).toBe(400);
    expect((await update(p.id, { defaultCurrency: "EUR" })).status).toBe(400);
    expect((await update(p.id, { name: "Reef House Renamed", defaultCurrency: "USD", timeZone: "Indian/Maldives" })).status).toBe(200);

    const after = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.timeZone).toBe("Indian/Maldives");
    expect(after.defaultCurrency).toBe("USD");
    expect(after.name).toBe("Reef House Renamed");
  });
});

describe("People: email normalisation, password floor, Active switch", () => {
  const post = (body: Record<string, unknown>) =>
    asUser(adminId, () => usersRoute.POST(json("POST", "http://localhost/api/settings/users", body)));
  const patch = (body: Record<string, unknown>) =>
    asUser(adminId, () => usersRoute.PATCH(json("PATCH", "http://localhost/api/settings/users", body)));
  const person = (email: string, password = "a-long-enough-pass") => ({
    email, password, firstName: "Mixed", lastName: "Case", roles: [roleIds["Admin"]], scope: "ENTERPRISE",
  });

  it("shares one rule set between form and API", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(normalizeEmail("  Jane.Doe@Hotel.MV ")).toBe("jane.doe@hotel.mv");
    const create = userIdentitySchema("create");
    expect(create.safeParse({ firstName: "a", lastName: "b", email: "a@b.mv", password: "short" }).success).toBe(false);
    expect(create.safeParse({ firstName: "a", lastName: "b", email: "a@b.mv", password: "x".repeat(12) }).success).toBe(true);
    // Editing: blank password means "unchanged".
    expect(userIdentitySchema("edit").safeParse({ firstName: "a", lastName: "b", email: "a@b.mv", password: "" }).success).toBe(true);
  });

  it("stores a new user's email trimmed and lower-case", async () => {
    const tag = uniq();
    const res = await post(person(`  New.Person-${tag}@Test.LOCAL `));
    expect(res.status).toBe(201);
    expect((await res.json()).email).toBe(`new.person-${tag}@test.local`);
  });

  it("treats an address differing only in case as already taken", async () => {
    const tag = uniq();
    expect((await post(person(`dup-${tag}@test.local`))).status).toBe(201);
    const res = await post(person(`DUP-${tag}@Test.Local`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already exists/i);
  });

  it("refuses a password under 12 characters on create and on reset", async () => {
    const tag = uniq();
    expect((await post(person(`shortpw-${tag}@test.local`, "elevenchars"))).status).toBe(400);
    const created = await (await post(person(`reset-${tag}@test.local`))).json();
    expect((await patch({ id: created.id, password: "tooshort" })).status).toBe(400);
    expect((await patch({ id: created.id, password: "twelve-chars" })).status).toBe(200);
  });

  it("lower-cases an edited email, and deactivation ends sign-in", async () => {
    const tag = uniq();
    const created = await (await post(person(`edit-${tag}@test.local`))).json();
    const res = await patch({ id: created.id, email: `Edited-${tag}@TEST.local`, isActive: false });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.email).toBe(`edited-${tag}@test.local`);
    expect(after.isActive).toBe(false);
  });

  it("never deactivates the onboarding account, nor the actor's own", async () => {
    const protectedUser = await prisma.user.create({
      data: {
        enterpriseId, email: `onboard-${uniq()}@test.local`, passwordHash: "x", firstName: "On", lastName: "Board",
        roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE", isProtected: true,
      },
    });
    expect((await patch({ id: protectedUser.id, isActive: false })).status).toBe(400);
    expect((await patch({ id: adminId, isActive: false })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).isActive).toBe(true);
  });
});

describe("Roles: users-assigned count is per enterprise", () => {
  it("counts only this enterprise's staff on a shared system role", async () => {
    // Another tenant's user on the same shared Admin role must not show up here.
    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `test-hubfix-other-${uniq()}`, type: "STANDARD" } });
    await prisma.user.create({
      data: {
        enterpriseId: other.id, email: `other-${uniq()}@test.local`, passwordHash: "x", firstName: "O", lastName: "T",
        roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    const expected = await prisma.userRole.count({ where: { roleId: roleIds["Admin"], user: { enterpriseId, isSystem: false } } });
    const res = await asUser(adminId, () => rolesRoute.GET());
    expect(res.status).toBe(200);
    const admin = (await res.json()).find((r: { id: string }) => r.id === roleIds["Admin"]);
    expect(admin._count.users).toBe(expected);
    const total = await prisma.userRole.count({ where: { roleId: roleIds["Admin"] } });
    expect(total).toBeGreaterThan(expected);
  });
});
