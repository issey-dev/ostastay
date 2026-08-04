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
const masterFolioRoute = await import("@/app/api/groups/[id]/master-folio/route");
const folioIdRoute = await import("@/app/api/folios/[id]/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Group block City-Ledger master bill → debtor invoice", () => {
  let propertyId: string;
  let adminId: string;
  let accountUpid: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({ data: { name: "GML", slug: `test-gml-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id, name: "P", code: `GML-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    // A credit-account travel agent the block can settle to.
    const account = await prisma.profile.create({
      data: { enterpriseId: enterprise.id, upid: `TA-${uniq()}`, profileType: "TRAVEL_AGENT", firstName: "Blue", lastName: "Horizon", companyName: "Blue Horizon Tours", isCreditAccount: true },
    });
    accountUpid = account.upid;

    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id, email: `gml-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "GML", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("creates the master folio as City-Ledger for the linked account, and closing it finalizes a debtor invoice", async () => {
    const block = await prisma.groupBlock.create({
      data: {
        propertyId, code: `B-${uniq()}`, name: "Linked Block", status: "DEFINITE",
        startDate: new Date("2026-09-01"), endDate: new Date("2026-09-10"),
        payeeProfileId: accountUpid,
      },
    });

    // Master folio inherits the block's City-Ledger account.
    const created = await asUser(adminId, () =>
      masterFolioRoute.POST(new Request(`http://localhost/api/groups/${block.id}/master-folio`, { method: "POST" }), { params: Promise.resolve({ id: block.id }) })
    );
    expect(created.status).toBe(201);
    const folio = await created.json();
    expect(folio.isMaster).toBe(true);
    expect(folio.settlementMethod).toBe("CITY_LEDGER");
    expect(folio.payeeProfileId).toBe(accountUpid);
    expect(folio.isDebtorAccount).toBe(false); // not until closed

    // Closing it finalizes the debtor invoice for the account.
    const closed = await asUser(adminId, () =>
      folioIdRoute.PATCH(
        new Request(`http://localhost/api/folios/${folio.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isClosed: true }),
        }),
        { params: Promise.resolve({ id: folio.id }) }
      )
    );
    expect(closed.status).toBe(200);

    const finalized = await prisma.folio.findUnique({ where: { id: folio.id }, select: { isClosed: true, isDebtorAccount: true, payeeProfileId: true } });
    expect(finalized?.isClosed).toBe(true);
    expect(finalized?.isDebtorAccount).toBe(true);
    expect(finalized?.payeeProfileId).toBe(accountUpid);
  });

  it("leaves a block with no linked account billing direct (master folio not City-Ledger)", async () => {
    const block = await prisma.groupBlock.create({
      data: {
        propertyId, code: `B-${uniq()}`, name: "Direct Block", status: "DEFINITE",
        startDate: new Date("2026-09-01"), endDate: new Date("2026-09-10"),
      },
    });
    const created = await asUser(adminId, () =>
      masterFolioRoute.POST(new Request(`http://localhost/api/groups/${block.id}/master-folio`, { method: "POST" }), { params: Promise.resolve({ id: block.id }) })
    );
    const folio = await created.json();
    expect(folio.settlementMethod).toBe("DIRECT");
    expect(folio.payeeProfileId).toBeNull();
  });
});
