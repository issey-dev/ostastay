import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-defaults-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { createConnection } = await import("@/lib/channels/connection");
const { createPropertyLink } = await import("@/lib/channels/sharing");
const { getBookingDefaults, setBookingDefaults, resolveBookingDefaults } = await import(
  "@/lib/channels/defaults"
);
const { ForbiddenError } = await import("@/lib/scope");

function stubBeds24(response: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response));
}

async function makeProperty(enterpriseId: string, name: string) {
  return prisma.property.create({
    data: {
      enterpriseId,
      name,
      code: `${name.slice(0, 2).toUpperCase()}-${Date.now()}-${Math.floor(performance.now() * 1000) % 10000}`,
      legalName: `${name} LLC`,
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    },
  });
}

describe("Channel booking defaults", () => {
  let enterpriseId: string;
  let connectionId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Defaults Ent ${Date.now()}`, slug: `test-defaults-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 5 } });

    stubBeds24({ refreshToken: "r", token: "a", expiresIn: 86400 });
    connectionId = (await createConnection({ enterpriseId, name: `Defaults Conn ${Date.now()}`, inviteCode: "x" })).id;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports no defaults configured until an operator sets one", async () => {
    const property = await makeProperty(enterpriseId, "Fresh");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-fresh-${Date.now()}`,
    });

    const defaults = await getBookingDefaults(enterpriseId, link.id);
    expect(defaults).toEqual({ linkId: link.id, ratePlanId: null, ratePlanName: null, mealPlanCode: "NONE" });

    const resolved = await resolveBookingDefaults(property.id);
    expect(resolved.ratePlanId).toBeNull();
    expect(resolved.problem).toContain("No default rate plan");
  });

  it("configures a rate plan and meal plan, and resolves them for the property", async () => {
    const property = await makeProperty(enterpriseId, "Configured");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-cfg-${Date.now()}`,
    });
    const ratePlan = await prisma.ratePlan.create({
      data: { propertyId: property.id, code: "BAR", name: "Best Available" },
    });

    const saved = await setBookingDefaults({
      enterpriseId,
      linkId: link.id,
      ratePlanId: ratePlan.id,
      mealPlanCode: "BB",
    });
    expect(saved).toEqual({ linkId: link.id, ratePlanId: ratePlan.id, ratePlanName: "Best Available", mealPlanCode: "BB" });

    const fetched = await getBookingDefaults(enterpriseId, link.id);
    expect(fetched.ratePlanId).toBe(ratePlan.id);
    expect(fetched.mealPlanCode).toBe("BB");

    const resolved = await resolveBookingDefaults(property.id);
    expect(resolved).toEqual({ ratePlanId: ratePlan.id, mealPlanCode: "BB", problem: null });
  });

  it("refuses a rate plan from another property", async () => {
    const a = await makeProperty(enterpriseId, "DefA");
    const b = await makeProperty(enterpriseId, "DefB");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: a.id,
      externalPropertyId: `ext-defa-${Date.now()}`,
    });
    const strayPlan = await prisma.ratePlan.create({ data: { propertyId: b.id, code: "X", name: "Stray" } });

    await expect(
      setBookingDefaults({ enterpriseId, linkId: link.id, ratePlanId: strayPlan.id, mealPlanCode: "NONE" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("clearing the rate plan puts conversion back into the unresolved state", async () => {
    const property = await makeProperty(enterpriseId, "Clear");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-clr-${Date.now()}`,
    });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "BAR" } });
    await setBookingDefaults({ enterpriseId, linkId: link.id, ratePlanId: ratePlan.id, mealPlanCode: "HB" });

    await setBookingDefaults({ enterpriseId, linkId: link.id, ratePlanId: null, mealPlanCode: "HB" });

    const resolved = await resolveBookingDefaults(property.id);
    expect(resolved.ratePlanId).toBeNull();
    expect(resolved.mealPlanCode).toBe("HB");
    expect(resolved.problem).toContain("No default rate plan");
  });

  it("refuses a link belonging to another enterprise", async () => {
    const other = await prisma.enterprise.create({
      data: { name: `Defaults Other ${Date.now()}`, slug: `test-defaultso-${Date.now()}`, type: "STANDARD" },
    });
    const property = await makeProperty(enterpriseId, "Isolated");
    const link = await createPropertyLink({
      enterpriseId,
      connectionId,
      propertyId: property.id,
      externalPropertyId: `ext-iso-${Date.now()}`,
    });

    await expect(getBookingDefaults(other.id, link.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setBookingDefaults({ enterpriseId: other.id, linkId: link.id, ratePlanId: null, mealPlanCode: "NONE" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reports a problem for a property with no channel link at all", async () => {
    const property = await makeProperty(enterpriseId, "Unlinked");
    const resolved = await resolveBookingDefaults(property.id);
    expect(resolved.problem).toContain("not linked");
  });
});
