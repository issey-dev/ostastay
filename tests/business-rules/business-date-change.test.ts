import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// Moving a property's business date by hand (Hub > the property > Night Audit;
// src/lib/business-date-change.ts). A property with no activity may go to any date; one with
// activity may only move forward, and only when nothing would be skipped over.

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
const { assessBusinessDateChange } = await import("@/lib/business-date-change");
const { customChargeCode } = await import("../helpers/charge-codes");
const route = await import("@/app/api/properties/[id]/business-date/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const move = (userId: string, propertyId: string, date: string) =>
  asUser(userId, () =>
    route.POST(
      new Request(`http://localhost/api/properties/${propertyId}/business-date`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      }),
      { params: Promise.resolve({ id: propertyId }) }
    )
  );

describe("Changing the business date by hand", () => {
  let enterpriseId: string;
  let adminId: string;
  let lagoonAdminId: string;
  let lagoonId: string;
  let guestId: string;

  const makeProperty = (name: string, businessDate = "2026-09-01") =>
    prisma.property.create({
      data: {
        enterpriseId, name, code: `BD-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00", businessDate: D(businessDate),
      },
    });

  const reservation = (propertyId: string, status: string, checkIn: string, checkOut: string) =>
    prisma.reservation.create({
      data: { propertyId, primaryGuestId: guestId, confirmationNo: `BD${uniq()}`, status, checkInDate: D(checkIn), checkOutDate: D(checkOut) },
    });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "BD", slug: `test-bd-${uniq()}`, type: "STANDARD" } })).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `bd-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    lagoonId = (await makeProperty("Lagoon")).id;
    lagoonAdminId = (await prisma.user.create({
      data: { enterpriseId, email: `bd-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: lagoonId },
    })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "G", lastName: "Uest" } })).upid;
  });

  it("lets a property with no activity go to ANY date — back or forward", async () => {
    const p = await makeProperty("Fresh");
    const back = await assessBusinessDateChange(p.id, D("2026-01-15"));
    expect(back.fresh).toBe(true);
    expect(back.allowed).toBe(true);

    const res = await move(adminId, p.id, "2026-01-15");
    expect(res.status).toBe(200);
    const row = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.businessDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
    // Staff are signed out, as after Night Audit.
    expect(row.eodSessionsInvalidAt).not.toBeNull();
  });

  it("only moves a property with activity forward", async () => {
    const p = await makeProperty("Active");
    await reservation(p.id, "CHECKED_OUT", "2026-08-20", "2026-08-25");
    const back = await assessBusinessDateChange(p.id, D("2026-08-15"));
    expect(back.fresh).toBe(false);
    expect(back.checks.find((c) => c.key === "forward")?.ok).toBe(false);
    expect((await move(adminId, p.id, "2026-08-15")).status).toBe(403);

    expect((await move(adminId, p.id, "2026-09-10")).status).toBe(200);
  });

  it("refuses while a guest is in house", async () => {
    const p = await makeProperty("InHouse");
    await reservation(p.id, "IN_HOUSE", "2026-08-30", "2026-09-05");
    const a = await assessBusinessDateChange(p.id, D("2026-09-10"));
    expect(a.checks.find((c) => c.key === "in-house")?.ok).toBe(false);
    expect(a.allowed).toBe(false);
  });

  it("refuses to skip over an arrival, but an arrival ON the new date is fine", async () => {
    const p = await makeProperty("Arrivals");
    await reservation(p.id, "RESERVED", "2026-09-10", "2026-09-12");
    expect((await assessBusinessDateChange(p.id, D("2026-09-11"))).checks.find((c) => c.key === "arrivals")?.ok).toBe(false);
    const onTheDay = await assessBusinessDateChange(p.id, D("2026-09-10"));
    expect(onTheDay.checks.find((c) => c.key === "arrivals")?.ok).toBe(true);
    expect(onTheDay.allowed).toBe(true);
  });

  it("refuses when there are financial records on or after the current business date", async () => {
    const p = await makeProperty("Postings");
    const code = await customChargeCode({ propertyId: p.id }, { code: "1000", description: "Room" });
    const folio = await prisma.folio.create({ data: { propertyId: p.id, folioNumber: 1 } });
    await prisma.folioLineItem.create({ data: { folioId: folio.id, chargeCodeId: code.id, date: D("2026-09-01"), description: "Room", amount: 100 } });
    const a = await assessBusinessDateChange(p.id, D("2026-09-05"));
    expect(a.checks.find((c) => c.key === "postings")?.ok).toBe(false);
    expect(a.allowed).toBe(false);
  });

  it("refuses while a cashier shift is open", async () => {
    const p = await makeProperty("Shift");
    await prisma.cashierShift.create({ data: { enterpriseId, propertyId: p.id, userId: adminId, businessDate: D("2026-09-01") } });
    const a = await assessBusinessDateChange(p.id, D("2026-09-05"));
    expect(a.checks.find((c) => c.key === "shifts")?.ok).toBe(false);
  });

  it("lets a single-property admin change only their own property's date", async () => {
    const beach = await makeProperty("Beach");
    expect((await move(lagoonAdminId, beach.id, "2026-10-01")).status).toBe(403);
    expect((await move(lagoonAdminId, lagoonId, "2026-10-01")).status).toBe(200);
  });
});
