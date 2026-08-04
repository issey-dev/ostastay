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
const { netBaseCashFromExchanges, expectedCashForShift } = await import("@/lib/shift-summary");

const exchangeRoute = await import("@/app/api/cashiering/currency-exchange/route");
const statusRoute = await import("@/app/api/cashiering/status/route");

async function asUser<T>(userId: string, propertyId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  cookieJar.set("current_property_id", propertyId);
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const exchange = (userId: string, propertyId: string, body: object) =>
  asUser(userId, propertyId, () =>
    exchangeRoute.POST(new Request("http://localhost/api/cashiering/currency-exchange", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }))
  );

describe("Currency exchange — drawer balancing, validation, shift scope (A3/A4)", () => {
  let propertyId: string;
  let userId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "FX", slug: `test-fx-${uniq()}`, type: "STANDARD" } });
    const eRoles = await ensureRoles(prisma, enterprise.id, SYSTEM_ROLE_DEFS, true);
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "FX Prop", code: `FX-${uniq()}`, legalName: "FX LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: new Date(Date.UTC(2026, 5, 1)) } });
    propertyId = property.id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const user = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `fx-${uniq()}@test.local`, passwordHash, firstName: "Cash", lastName: "Ier", roles: { create: { roleId: eRoles["Admin"] ?? roleIds["Admin"] } }, scope: "PROPERTY", propertyId } });
    userId = user.id;
  });

  // Pure helper: base-currency leg only. Base = USD.
  it("netBaseCashFromExchanges counts only the base-currency leg", () => {
    const xs = [
      { fromCurrency: "EUR", toCurrency: "USD", amountFrom: 100, amountTo: 105 }, // pay out 105 USD → -105
      { fromCurrency: "USD", toCurrency: "GBP", amountFrom: 200, amountTo: 150 }, // take in 200 USD → +200
      { fromCurrency: "EUR", toCurrency: "GBP", amountFrom: 50, amountTo: 40 },   // foreign↔foreign → 0
    ];
    expect(netBaseCashFromExchanges(xs, "USD")).toBe(95); // -105 + 200
    expect(netBaseCashFromExchanges(xs, null)).toBe(0);    // unknown base → contribute nothing
    // Fold into expected cash: opening 500, no payments → 500 + 95.
    expect(expectedCashForShift(500, [], [], xs, "usd")).toBe(595); // case-insensitive base
  });

  it("records a valid exchange, scopes the shift to the property, and reflects it in expected cash", async () => {
    // Guest gives 100 EUR at 1.05, receives 105 USD (base) — drawer pays out 105 USD.
    const resp = await exchange(userId, propertyId, { fromCurrency: "EUR", toCurrency: "USD", rate: 1.05, amountFrom: 100, amountTo: 105 });
    expect(resp.status).toBe(201);

    // A4: the exchange attached to a shift scoped to THIS property (not a null/foreign one).
    const created = await resp.json();
    const shift = await prisma.cashierShift.findUnique({ where: { id: created.shiftId } });
    expect(shift!.propertyId).toBe(propertyId);

    // A3: expected cash now reflects the 105 USD paid out (opening float 0).
    const statusRes = await asUser(userId, propertyId, () => statusRoute.GET());
    const body = await statusRes.json();
    expect(body.data.summary.expectedCash).toBe(-105);
  });

  it("rejects an internally-inconsistent amount triple", async () => {
    const resp = await exchange(userId, propertyId, { fromCurrency: "EUR", toCurrency: "USD", rate: 15, amountFrom: 100, amountTo: 9999 });
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/inconsistent/i);
  });

  it("rejects a non-positive amount", async () => {
    const resp = await exchange(userId, propertyId, { fromCurrency: "EUR", toCurrency: "USD", rate: 1.05, amountFrom: -100, amountTo: -105 });
    expect(resp.status).toBe(400);
  });
});
