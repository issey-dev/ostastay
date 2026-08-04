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
const propertyRoute = await import("@/app/api/properties/[id]/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// PUT /api/properties/[id] is written as a partial update — several Controls panels send
// a ONE-FIELD body (banner colour, stationery font, allocation mode, session timeout).
// Any field that falls through to a concrete value instead of `undefined` therefore
// silently destroys data on every one of those saves.
//
// That is not hypothetical: `starRating` did exactly this until 2026-08-05 — changing a
// property's banner colour wiped its star rating. These tests hold the line for every
// field a partial body must leave alone.
describe("Property partial update leaves untouched fields alone", () => {
  let propertyId: string;
  let adminId: string;

  const put = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      propertyRoute.PUT(
        new Request(`http://localhost/api/properties/${propertyId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: propertyId }) }
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({
      data: { name: "PartialUpdate", slug: `test-partial-${uniq()}`, type: "STANDARD" },
    });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id,
        name: "Partial", code: `PU-${uniq()}`, legalName: "Partial LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        status: "ACTIVE",
        // The values a one-field save must not disturb.
        starRating: 5,
        taxId: "TAX-123",
        contactPhone: "+960 000 0000",
      },
    });
    propertyId = property.id;

    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id,
        email: `pu-admin-${uniq()}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "PU",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("keeps the star rating when only the banner colour is sent", async () => {
    // The exact live bug: starRating fell through to null on every partial PUT.
    const res = await put({ bannerColor: "#123456" });
    expect(res.status).toBe(200);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.starRating).toBe(5);
    expect(after.bannerColor).toBe("#123456");
  });

  it("keeps the star rating when only the session timeout is sent", async () => {
    const res = await put({ sessionIdleMinutes: 30 });
    expect(res.status).toBe(200);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.sessionIdleMinutes).toBe(30);
    expect(after.starRating).toBe(5);
  });

  it("leaves name, tax id and contact details untouched by a one-field save", async () => {
    await put({ sessionIdleMinutes: 15 });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.name).toBe("Partial");
    expect(after.taxId).toBe("TAX-123");
    expect(after.contactPhone).toBe("+960 000 0000");
  });

  it("still clears the star rating when that is what was asked", async () => {
    // Guarding against accidental wipes must not make a deliberate one impossible.
    const res = await put({ starRating: null });
    expect(res.status).toBe(200);
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.starRating).toBeNull();
  });
});

describe("Session idle timeout is clamped server-side", () => {
  let propertyId: string;
  let adminId: string;

  const put = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      propertyRoute.PUT(
        new Request(`http://localhost/api/properties/${propertyId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: propertyId }) }
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({
      data: { name: "IdleClamp", slug: `test-idle-${uniq()}`, type: "STANDARD" },
    });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id,
        name: "Idle", code: `ID-${uniq()}`, legalName: "Idle LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        status: "ACTIVE",
      },
    });
    propertyId = property.id;
    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id,
        email: `idle-admin-${uniq()}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "Idle",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("accepts 0 as 'off'", async () => {
    await put({ sessionIdleMinutes: 0 });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.sessionIdleMinutes).toBe(0);
  });

  it("raises anything between 1 and 4 to the 5-minute floor", async () => {
    // Activity is stamped at most once a minute, so a 1-minute timeout would fire
    // unpredictably rather than promptly. The server enforces the floor the UI states.
    await put({ sessionIdleMinutes: 1 });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.sessionIdleMinutes).toBe(5);
  });

  it("refuses to store a negative timeout", async () => {
    await put({ sessionIdleMinutes: -30 });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(after.sessionIdleMinutes).toBeGreaterThanOrEqual(0);
  });
});
