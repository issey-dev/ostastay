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

const negotiatedRatesRoute = await import("@/app/api/profiles/[upid]/negotiated-rates/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
      enterpriseId: enterprise.id, email: `nr-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "NR", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
    },
  });
  return { enterpriseId: enterprise.id, propertyId: property.id, adminId: admin.id };
}

describe("Negotiated Rate Plans linked to a Company/Travel Agent profile", () => {
  it("links negotiated rate plans to a profile, rejects non-negotiated/cross-enterprise ones", async () => {
    const { enterpriseId, propertyId, adminId } = await setup("test-nr-link");
    const agent = await prisma.profile.create({
      data: { enterpriseId, profileType: "TRAVEL_AGENT", firstName: "", companyName: "Acme Travel" },
    });
    const negotiatedPlan = await prisma.ratePlan.create({
      data: { propertyId, code: "CORP1", name: "Corporate Rate 1", isNegotiated: true },
    });
    const publicPlan = await prisma.ratePlan.create({
      data: { propertyId, code: "BAR", name: "Best Available Rate", isNegotiated: false },
    });

    // Rejects a non-negotiated plan.
    const rejectPublic = await asUser(adminId, () =>
      negotiatedRatesRoute.PUT(
        new Request("http://localhost/api/profiles/x/negotiated-rates", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: [{ ratePlanId: publicPlan.id }] }),
        }),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    expect(rejectPublic.status).toBe(400);

    // Rejects a rate plan from a different enterprise.
    const { propertyId: otherPropertyId } = await setup("test-nr-other");
    const otherPlan = await prisma.ratePlan.create({
      data: { propertyId: otherPropertyId, code: "CORP2", name: "Other Corp Rate", isNegotiated: true },
    });
    const rejectCrossEnterprise = await asUser(adminId, () =>
      negotiatedRatesRoute.PUT(
        new Request("http://localhost/api/profiles/x/negotiated-rates", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: [{ ratePlanId: otherPlan.id }] }),
        }),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    expect(rejectCrossEnterprise.status).toBe(400);

    // Rejects an out-of-range commission rate.
    const rejectBadCommission = await asUser(adminId, () =>
      negotiatedRatesRoute.PUT(
        new Request("http://localhost/api/profiles/x/negotiated-rates", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: [{ ratePlanId: negotiatedPlan.id, commissionRate: 150 }] }),
        }),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    expect(rejectBadCommission.status).toBe(400);

    // Accepts a valid negotiated plan in the same enterprise, with a commission rate.
    const linkRes = await asUser(adminId, () =>
      negotiatedRatesRoute.PUT(
        new Request("http://localhost/api/profiles/x/negotiated-rates", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: [{ ratePlanId: negotiatedPlan.id, commissionRate: 12.5 }] }),
        }),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    expect(linkRes.status).toBe(200);

    const rows = await prisma.ratePlanAgentAccess.findMany({ where: { upid: agent.upid } });
    expect(rows).toHaveLength(1);
    expect(rows[0].ratePlanId).toBe(negotiatedPlan.id);
    expect(rows[0].commissionRate).toBe(12.5);

    const getRes = await asUser(adminId, () =>
      negotiatedRatesRoute.GET(
        new Request("http://localhost/api/profiles/x/negotiated-rates"),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    const body = await getRes.json();
    expect(body.links).toEqual([{ ratePlanId: negotiatedPlan.id, commissionRate: 12.5 }]);
    expect(body.available.some((rp: { id: string }) => rp.id === negotiatedPlan.id)).toBe(true);
    // The public (non-negotiated) plan never appears in the available list.
    expect(body.available.some((rp: { id: string }) => rp.id === publicPlan.id)).toBe(false);

    // Replacing with an empty set clears the link.
    await asUser(adminId, () =>
      negotiatedRatesRoute.PUT(
        new Request("http://localhost/api/profiles/x/negotiated-rates", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: [] }),
        }),
        { params: Promise.resolve({ upid: agent.upid }) }
      )
    );
    expect(await prisma.ratePlanAgentAccess.count({ where: { upid: agent.upid } })).toBe(0);
  });

  it("exposes negotiatedForProfileIds on GET /api/rate-plans so the reservation form can restrict selection", async () => {
    const { propertyId, enterpriseId, adminId } = await setup("test-nr-expose");
    const agent = await prisma.profile.create({
      data: { enterpriseId, profileType: "COMPANY", firstName: "", companyName: "Beta Corp" },
    });
    const plan = await prisma.ratePlan.create({
      data: { propertyId, code: "CORP3", name: "Corporate Rate 3", isNegotiated: true },
    });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: plan.id, upid: agent.upid } });

    const ratePlansRoute = await import("@/app/api/rate-plans/route");
    const res = await asUser(adminId, () =>
      ratePlansRoute.GET(new Request(`http://localhost/api/rate-plans?propertyId=${propertyId}`))
    );
    const list = await res.json();
    const found = list.find((rp: { id: string }) => rp.id === plan.id);
    expect(found.negotiatedForProfileIds).toEqual([agent.upid]);
  });
});
