import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie fake as tests/business-rules/hub-access.test.ts.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const propertyCreateRoute = await import("@/app/api/osta/properties/create/route");
const initialUserRoute = await import("@/app/api/osta/enterprises/[id]/initial-user/route");

const jsonPost = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Osta-side onboarding (app-owner requirement, 2026-08-03): the platform admin creates
// the enterprise, its properties, and its ONE initial handover user. The invariants
// under test: internal-only reach, tenant-equal license limits, full provisioning, and
// "initial user only" enforced rather than advisory.
describe("Osta-side onboarding", () => {
  let ostaAdminId: string;
  let tenantId: string;
  let tenantAdminId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id,
        email: `osta-onb-${stamp}@test.local`,
        passwordHash,
        firstName: "Osta",
        lastName: "Onboarder",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    // Room for two properties, so the duplicate-code check is reachable before the
    // license limit slams shut.
    const tenant = await prisma.enterprise.create({
      data: { name: `Onb Tenant ${stamp}`, slug: `test-onb-${stamp}`, type: "STANDARD" },
    });
    tenantId = tenant.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId: tenantId, tier: "STANDARD", maxProperties: 2 } });

    const tenantAdmin = await prisma.user.create({
      data: {
        enterpriseId: tenantId,
        email: `onb-tenant-${stamp}@test.local`,
        passwordHash,
        firstName: "Tenant",
        lastName: "Admin",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    tenantAdminId = tenantAdmin.id;
  });

  afterEach(async () => {
    await destroySession();
    cookieJar.clear();
  });

  const propertyBody = (code: string, extra: Record<string, unknown> = {}) => ({
    enterpriseId: tenantId,
    name: `Onb Property ${code}`,
    code,
    legalName: "Onb LLC",
    defaultCurrency: "USD",
    timeZone: "Indian/Maldives",
    ...extra,
  });

  it("a tenant admin is refused both onboarding endpoints", async () => {
    await createSession(tenantAdminId);

    const prop = await propertyCreateRoute.POST(jsonPost(propertyBody(`ONB-X-${stamp}`)));
    expect(prop.status).toBe(403);

    const user = await initialUserRoute.POST(jsonPost({ email: "x@y.z", firstName: "A", lastName: "B" }), {
      params: Promise.resolve({ id: tenantId }),
    });
    expect(user.status).toBe(403);
  });

  it("creates a fully-provisioned ACTIVE property, honouring license limits and code uniqueness", async () => {
    await createSession(ostaAdminId);

    const res = await propertyCreateRoute.POST(jsonPost(propertyBody(`ONB1-${stamp}`)));
    expect(res.status).toBe(201);
    const created = await res.json();

    // ACTIVE with the reviewer stamped — no self-approval ceremony through the queue.
    expect(created.status).toBe("ACTIVE");
    expect(created.reviewedByUserId).toBe(ostaAdminId);
    // Defaults applied when not sent.
    expect(created.checkInTime).toBe("14:00");
    expect(created.checkOutTime).toBe("11:00");

    // Same provisioning as tenant-side onboarding: the locked Base Rate plan and the
    // enterprise charge tree Night Audit depends on.
    const basePlan = await prisma.ratePlan.findFirst({ where: { propertyId: created.id, code: "BASE" } });
    expect(basePlan?.isLocked).toBe(true);
    expect(await prisma.chargeGroup.count({ where: { enterpriseId: tenantId } })).toBeGreaterThan(0);

    // The tenant's own trail shows who onboarded it.
    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId: tenantId, entityType: "Property", entityId: created.id },
    });
    expect(trail?.userId).toBe(ostaAdminId);

    // A duplicate code is a friendly 409, not a raw P2002.
    const dup = await propertyCreateRoute.POST(jsonPost(propertyBody(`ONB1-${stamp}`)));
    expect(dup.status).toBe(409);

    // Second property fits the 2-property license…
    const second = await propertyCreateRoute.POST(jsonPost(propertyBody(`ONB2-${stamp}`)));
    expect(second.status).toBe(201);
    // …the third does not: being the platform does not bypass the plan.
    const third = await propertyCreateRoute.POST(jsonPost(propertyBody(`ONB3-${stamp}`)));
    expect(third.status).toBe(403);
  });

  it("mints ONE initial admin user with a show-once generated password — and only for an empty enterprise", async () => {
    await createSession(ostaAdminId);

    // The fixture tenant already has a user, so it must refuse…
    const refused = await initialUserRoute.POST(jsonPost({ email: `no-${stamp}@t.local`, firstName: "N", lastName: "O" }), {
      params: Promise.resolve({ id: tenantId }),
    });
    expect(refused.status).toBe(400);

    // …while a genuinely empty enterprise gets exactly one handover account.
    const fresh = await prisma.enterprise.create({
      data: { name: `Onb Fresh ${stamp}`, slug: `test-onb-fresh-${stamp}`, type: "STANDARD" },
    });
    const email = `handover-${stamp}@client.local`;
    const res = await initialUserRoute.POST(jsonPost({ email, firstName: "Hand", lastName: "Over" }), {
      params: Promise.resolve({ id: fresh.id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { email: string; password: string; enterpriseSlug: string };
    expect(body.enterpriseSlug).toBe(fresh.slug);
    // 12 base64url characters — meets the bootstrap script's own minimum length.
    expect(body.password).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    expect(user.enterpriseId).toBe(fresh.id);
    expect(user.scope).toBe("ENTERPRISE");
    expect(user.roles).toHaveLength(1);
    expect(user.roles[0].role.name).toBe("Admin");
    expect(user.roles[0].role.isSystem).toBe(true);
    // Protected: this is the account that stops a tenant locking itself out of the Hub.
    expect(user.isProtected).toBe(true);
    // Show-once means hash-at-rest: the credential works, but the row never carries it.
    expect(await bcrypt.compare(body.password, user.passwordHash)).toBe(true);
    expect(JSON.stringify(user)).not.toContain(body.password);

    // The tenant's trail records the handover account's creation.
    const trail = await prisma.userActivityLog.findFirst({
      where: { enterpriseId: fresh.id, entityType: "User", entityId: user.id },
    });
    expect(trail).toBeTruthy();

    // And now that the enterprise has its user, the door is shut.
    const again = await initialUserRoute.POST(jsonPost({ email: `again-${stamp}@t.local`, firstName: "A", lastName: "G" }), {
      params: Promise.resolve({ id: fresh.id }),
    });
    expect(again.status).toBe(400);

    // A duplicate email anywhere on the platform is refused too.
    const fresh2 = await prisma.enterprise.create({
      data: { name: `Onb Fresh2 ${stamp}`, slug: `test-onb-fresh2-${stamp}`, type: "STANDARD" },
    });
    const dupEmail = await initialUserRoute.POST(jsonPost({ email, firstName: "D", lastName: "U" }), {
      params: Promise.resolve({ id: fresh2.id }),
    });
    expect(dupEmail.status).toBe(400);
  });
});
