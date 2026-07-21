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

const enterpriseModulesRoute = await import("@/app/api/licenses/enterprise-modules/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

describe("Per-enterprise module access override (/api/licenses/enterprise-modules)", () => {
  let enterpriseId: string;
  let tenantAdminId: string;
  let ostaAdminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Module Licensing Test", slug: `test-module-licensing-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const tenantAdmin = await prisma.user.create({
      data: {
        enterpriseId, email: `ml-tenant-${uniq()}@test.local`, passwordHash,
        firstName: "Tenant", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    tenantAdminId = tenantAdmin.id;

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id, email: `ml-osta-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;
  });

  it("GET 403s for a non-Osta user", async () => {
    const res = await asUser(tenantAdminId, () =>
      enterpriseModulesRoute.GET(new Request(`http://localhost/api/licenses/enterprise-modules?enterpriseId=${enterpriseId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET returns override: null for every module with no row yet", async () => {
    const res = await asUser(ostaAdminId, () =>
      enterpriseModulesRoute.GET(new Request(`http://localhost/api/licenses/enterprise-modules?enterpriseId=${enterpriseId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const posRow = body.find((r: { module: string }) => r.module === "POS");
    expect(posRow.override).toBeNull();
  });

  it("PATCH sets an explicit override, and enabled: null clears it back to no-override", async () => {
    const setRes = await asUser(ostaAdminId, () =>
      enterpriseModulesRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-modules", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId, module: "POS", enabled: false }),
        })
      )
    );
    expect(setRes.status).toBe(200);
    const setBody = await setRes.json();
    expect(setBody.override).toBe(false);

    const row = await prisma.enterpriseModuleAccess.findUnique({ where: { enterpriseId_module: { enterpriseId, module: "POS" } } });
    expect(row?.enabled).toBe(false);

    const clearRes = await asUser(ostaAdminId, () =>
      enterpriseModulesRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-modules", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId, module: "POS", enabled: null }),
        })
      )
    );
    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json();
    expect(clearBody.override).toBeNull();

    const clearedRow = await prisma.enterpriseModuleAccess.findUnique({ where: { enterpriseId_module: { enterpriseId, module: "POS" } } });
    expect(clearedRow).toBeNull();
  });

  it("PATCH 403s for a non-Osta user", async () => {
    const res = await asUser(tenantAdminId, () =>
      enterpriseModulesRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-modules", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId, module: "POS", enabled: false }),
        })
      )
    );
    expect(res.status).toBe(403);
  });
});
