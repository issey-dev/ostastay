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

const propertiesRoute = await import("@/app/api/properties/route");
const resubmitRoute = await import("@/app/api/properties/[id]/resubmit/route");
const ostaPropertiesRoute = await import("@/app/api/osta/properties/route");
const approveRoute = await import("@/app/api/osta/properties/[id]/approve/route");
const rejectRoute = await import("@/app/api/osta/properties/[id]/reject/route");

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

describe("Property approval workflow: hard gate, Osta approve/reject/resubmit", () => {
  let enterpriseId: string;
  let adminUserId: string;
  let ostaAdminUserId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Property Approval Test", slug: `test-property-approval-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 5 } });

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `pa-admin-${uniq()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "PA", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminUserId = admin.id;

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id, email: `pa-osta-admin-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    ostaAdminUserId = ostaAdmin.id;
  });

  it("POST /api/properties creates a PENDING property, not ACTIVE", async () => {
    const res = await asUser(adminUserId, () =>
      propertiesRoute.POST(
        new Request("http://localhost/api/properties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "New Beach House", code: `NBH-${uniq()}`, legalName: "New Beach House LLC",
            defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("PENDING");
  });

  it("GET /api/osta/properties 403s for a non-Osta user", async () => {
    const res = await asUser(adminUserId, () =>
      ostaPropertiesRoute.GET(new Request("http://localhost/api/osta/properties"))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/osta/properties lists PENDING properties across enterprises by default, for an Osta user", async () => {
    const res = await asUser(ostaAdminUserId, () =>
      ostaPropertiesRoute.GET(new Request("http://localhost/api/osta/properties"))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.every((p: { status: string }) => p.status === "PENDING")).toBe(true);
    expect(body.some((p: { enterprise: { id: string } }) => p.enterprise.id === enterpriseId)).toBe(true);
  });

  it("POST /api/osta/properties/[id]/approve 403s for a non-Osta user, and flips PENDING to ACTIVE for an Osta user", async () => {
    const created = await prisma.property.create({
      data: {
        enterpriseId, name: "Approve Me", code: `AM-${uniq()}`, legalName: "Approve Me LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "PENDING",
      },
    });

    const deniedRes = await asUser(adminUserId, () =>
      approveRoute.POST(new Request(`http://localhost/api/osta/properties/${created.id}/approve`, { method: "POST" }), { params: Promise.resolve({ id: created.id }) })
    );
    expect(deniedRes.status).toBe(403);

    const approvedRes = await asUser(ostaAdminUserId, () =>
      approveRoute.POST(new Request(`http://localhost/api/osta/properties/${created.id}/approve`, { method: "POST" }), { params: Promise.resolve({ id: created.id }) })
    );
    expect(approvedRes.status).toBe(200);
    const body = await approvedRes.json();
    expect(body.status).toBe("ACTIVE");
    expect(body.reviewedByUserId).toBe(ostaAdminUserId);

    // Logged in BOTH Osta's own trail and the target enterprise's own trail.
    const targetLog = await prisma.userActivityLog.findFirst({ where: { enterpriseId, entityId: created.id, entityType: "Property" } });
    expect(targetLog).toBeTruthy();
    expect(targetLog?.description).toMatch(/Approved/i);
  });

  it("POST /api/osta/properties/[id]/reject requires a reason, sets REJECTED, and blocks the property via assertPropertyAccess", async () => {
    const created = await prisma.property.create({
      data: {
        enterpriseId, name: "Reject Me", code: `RM-${uniq()}`, legalName: "Reject Me LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "PENDING",
      },
    });

    const noReasonRes = await asUser(ostaAdminUserId, () =>
      rejectRoute.POST(
        new Request(`http://localhost/api/osta/properties/${created.id}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(noReasonRes.status).toBe(400);

    const rejectedRes = await asUser(ostaAdminUserId, () =>
      rejectRoute.POST(
        new Request(`http://localhost/api/osta/properties/${created.id}/reject`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rejectionReason: "Missing tax ID" }),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(rejectedRes.status).toBe(200);
    const body = await rejectedRes.json();
    expect(body.status).toBe("REJECTED");
    expect(body.rejectionReason).toBe("Missing tax ID");
  });

  it("POST /api/properties/[id]/resubmit only works from REJECTED, and flips back to PENDING", async () => {
    const created = await prisma.property.create({
      data: {
        enterpriseId, name: "Resubmit Me", code: `RSM-${uniq()}`, legalName: "Resubmit Me LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        status: "PENDING",
      },
    });

    // Not legal from PENDING.
    const tooEarlyRes = await asUser(adminUserId, () =>
      resubmitRoute.POST(new Request(`http://localhost/api/properties/${created.id}/resubmit`, { method: "POST" }), { params: Promise.resolve({ id: created.id }) })
    );
    expect(tooEarlyRes.status).toBe(400);

    await prisma.property.update({ where: { id: created.id }, data: { status: "REJECTED", rejectionReason: "test" } });

    const resubmitRes = await asUser(adminUserId, () =>
      resubmitRoute.POST(new Request(`http://localhost/api/properties/${created.id}/resubmit`, { method: "POST" }), { params: Promise.resolve({ id: created.id }) })
    );
    expect(resubmitRes.status).toBe(200);
    const body = await resubmitRes.json();
    expect(body.status).toBe("PENDING");
    expect(body.rejectionReason).toBeNull();
  });
});
