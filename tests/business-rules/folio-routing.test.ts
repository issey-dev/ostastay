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

const routingRoute = await import("@/app/api/reservations/[id]/routing-rules/route");
const lineItemsRoute = await import("@/app/api/folios/[id]/line-items/route");
const moveRoute = await import("@/app/api/folios/line-items/move/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Folio routing + cross-folio move", () => {
  let enterpriseId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let chargeCodeId: string;
  let adminId: string;
  let guestId: string;

  const inHouseWithTwoFolios = async (propId = propertyId) => {
    const res = await prisma.reservation.create({
      data: {
        propertyId: propId, confirmationNo: `RT-${uniq()}`, primaryGuestId: guestId,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"), status: "IN_HOUSE", adults: 1,
        folios: { create: [{ folioNumber: 1, propertyId: propId }, { folioNumber: 2, propertyId: propId }] },
      },
      include: { folios: { orderBy: { folioNumber: "asc" } } },
    });
    return { id: res.id, folio1: res.folios[0].id, folio2: res.folios[1].id };
  };

  const postCharge = (folioId: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      lineItemsRoute.POST(new Request(`http://localhost/api/folios/${folioId}/line-items`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: folioId }) })
    );

  const createRouting = (reservationId: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      routingRoute.POST(new Request(`http://localhost/api/reservations/${reservationId}/routing-rules`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ id: reservationId }) })
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Routing", slug: `test-routing-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const p1 = await prisma.property.create({ data: { enterpriseId, name: "R1", code: `R1-${uniq()}`, legalName: "R LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    propertyId = p1.id;
    const p2 = await prisma.property.create({ data: { enterpriseId, name: "R2", code: `R2-${uniq()}`, legalName: "R LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    otherPropertyId = p2.id;
    const cc = await prisma.chargeCode.create({ data: { enterpriseId, code: "TRF", description: "Transfer" } });
    chargeCodeId = cc.id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `rt-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "RT", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Route", lastName: "Guest" } });
    guestId = guest.upid;
  });

  it("creating a rule moves existing matching charges (apply-now) and redirects future postings", async () => {
    const r = await inHouseWithTwoFolios();
    // Pre-post a matching charge on folio 1.
    const pre = await postCharge(r.folio1, { chargeCodeId, amount: 30 });
    expect(pre.status).toBe(201);

    // Route TRF → folio 2.
    const rule = await createRouting(r.id, { chargeCodeIds: [chargeCodeId], targetFolioId: r.folio2 });
    expect(rule.status).toBe(200);
    expect((await rule.json()).movedCount).toBe(1);

    // The pre-existing charge moved to folio 2.
    const onF2 = await prisma.folioLineItem.findMany({ where: { folioId: r.folio2 } });
    expect(onF2.length).toBe(1);
    const onF1 = await prisma.folioLineItem.findMany({ where: { folioId: r.folio1 } });
    expect(onF1.length).toBe(0);

    // A NEW charge posted to folio 1 is auto-routed to folio 2.
    const post = await postCharge(r.folio1, { chargeCodeId, amount: 40 });
    expect(post.status).toBe(201);
    expect((await post.json()).folioId).toBe(r.folio2);
  });

  it("routes to another in-house room's folio and moves charges cross-reservation", async () => {
    const a = await inHouseWithTwoFolios();
    const b = await inHouseWithTwoFolios();
    await postCharge(a.folio1, { chargeCodeId, amount: 15 });

    const rule = await createRouting(a.id, { chargeCodeIds: [chargeCodeId], targetFolioId: b.folio1 });
    expect(rule.status).toBe(200);
    const onB = await prisma.folioLineItem.findMany({ where: { folioId: b.folio1 } });
    expect(onB.length).toBe(1); // moved to the other room's folio
  });

  it("manual move allows cross-reservation same-property, rejects cross-property", async () => {
    const a = await inHouseWithTwoFolios();
    const b = await inHouseWithTwoFolios();
    const posted = await postCharge(a.folio1, { chargeCodeId, amount: 22 });
    const itemId = (await posted.json()).id;

    const ok = await asUser(adminId, () =>
      moveRoute.POST(new Request("http://localhost/api/folios/line-items/move", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineItemIds: [itemId], targetFolioId: b.folio1 }),
      }))
    );
    expect(ok.status).toBe(200);
    expect((await prisma.folioLineItem.findUnique({ where: { id: itemId } }))!.folioId).toBe(b.folio1);

    // Cross-property move is rejected.
    const other = await inHouseWithTwoFolios(otherPropertyId);
    const posted2 = await postCharge(a.folio2, { chargeCodeId, amount: 10 });
    const item2 = (await posted2.json()).id;
    const bad = await asUser(adminId, () =>
      moveRoute.POST(new Request("http://localhost/api/folios/line-items/move", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineItemIds: [item2], targetFolioId: other.folio1 }),
      }))
    );
    expect(bad.status).toBe(400);
  });
});
