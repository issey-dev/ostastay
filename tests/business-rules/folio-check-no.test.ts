import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Folio check numbers (owner, 2026-09-26 — .agents/docs/DECISIONS.md "Folio check numbers
// and roll-up"): every posting carries a property-wide running check number, a charge and
// the lines it generates share it, and a Night Audit stay-night shares ONE.

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
const { postCharge, chargeCodeInclude } = await import("@/lib/posting/post-charge");
const { allocateCheckNo } = await import("@/lib/document-sequence");
const { highestIssuedNumber } = await import("@/lib/sequence-guard");
const { postStayNight, STAY_NIGHT_INCLUDE } = await import("@/lib/night-audit/stay-night");
const checkNoRoute = await import("@/app/api/folios/[id]/line-items/check-no/route");
const sequencesRoute = await import("@/app/api/settings/sequences/route");
const { chargeCode, customChargeCode } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

async function freshProperty(name: string) {
  const enterprise = await prisma.enterprise.create({ data: { name, slug: `test-checkno-${name}-${uniq()}`, type: "STANDARD" } });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name, code: `CN-${uniq()}`, legalName: `${name} LLC`,
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  // Maldives defaults: Service Charge 10%, GST 17%, Green Tax $6 per adult per night.
  const settings = await setPropertySettings(property.id, {
    serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17,
    greenTaxEnabled: true, greenTaxAdultAmount: 6, greenTaxChildAmount: 0,
  });
  return { enterpriseId: enterprise.id, propertyId: property.id, settings };
}

const postable = (id: string) => prisma.chargeCode.findUniqueOrThrow({ where: { id }, include: chargeCodeInclude() });

describe("postCharge stamps one check number on a posting and everything it generates", () => {
  let propertyId: string;
  let settings: Awaited<ReturnType<typeof freshProperty>>["settings"];
  let folioId: string;

  beforeAll(async () => {
    ({ propertyId, settings } = await freshProperty("post"));
    await chargeCode({ propertyId }, "1000"); // seeds the chart
    folioId = (await prisma.folio.create({ data: { propertyId, folioNumber: 1 } })).id;
  });

  it("parent + Service Charge + GST + Green Tax share the number; the next posting gets the next one", async () => {
    const room = await postable((await chargeCode({ propertyId }, "1000")).id);
    const post = () =>
      prisma.$transaction((tx) =>
        postCharge(tx, {
          folioId, chargeCode: room, inputAmount: 100, settings, pricesIncludeTaxes: false, date: new Date("2026-10-01"),
          postingContext: { adults: 2, children: 0, nights: 1 },
        })
      );

    const first = await post();
    const codes = await prisma.chargeCode.findMany({ where: { id: { in: first.generated.map((l) => l.chargeCodeId) } } });
    // SC (7000), GST (8000) and Green Tax (8500) all generated.
    expect(codes.map((c) => c.code).sort()).toEqual(["7000", "8000", "8500"]);
    expect(first.checkNo).toMatch(/^[0-9]+$/);
    expect(first.parent.checkNo).toBe(first.checkNo);
    for (const line of first.generated) expect(line.checkNo, line.description).toBe(first.checkNo);

    const second = await post();
    expect(Number(second.checkNo)).toBe(Number(first.checkNo) + 1);
    const stored = await prisma.folioLineItem.findMany({ where: { folioId } });
    expect(stored.filter((l) => l.checkNo === first.checkNo)).toHaveLength(4);
    expect(stored.filter((l) => l.checkNo === second.checkNo)).toHaveLength(4);
  });

  it("uses a caller-supplied check number instead of drawing one", async () => {
    const fb = await postable((await chargeCode({ propertyId }, "2001")).id);
    const before = await prisma.propertySequence.findUnique({ where: { propertyId_sequenceType: { propertyId, sequenceType: "CHECK_NO" } } });
    const posted = await prisma.$transaction((tx) =>
      postCharge(tx, { folioId, chargeCode: fb, inputAmount: 40, settings, pricesIncludeTaxes: false, date: new Date("2026-10-01"), checkNo: "77" })
    );
    expect(posted.checkNo).toBe("77");
    expect([posted.parent, ...posted.generated].every((l) => l.checkNo === "77")).toBe(true);
    const after = await prisma.propertySequence.findUnique({ where: { propertyId_sequenceType: { propertyId, sequenceType: "CHECK_NO" } } });
    expect(after?.currentValue).toBe(before?.currentValue);
  });
});

describe("allocateCheckNo and the Sequence Manager", () => {
  it("increments the property's CHECK_NO counter, per property", async () => {
    const a = await freshProperty("seq-a");
    const b = await freshProperty("seq-b");
    expect(await allocateCheckNo(prisma, a.propertyId)).toBe("1");
    expect(await allocateCheckNo(prisma, a.propertyId)).toBe("2");
    expect(await allocateCheckNo(prisma, b.propertyId)).toBe("1");
    await prisma.$transaction(async (tx) => {
      expect(await allocateCheckNo(tx, a.propertyId)).toBe("3");
    });
  });

  it("lists CHECK_NO with its highest issued number and refuses a counter below it", async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const { enterpriseId, propertyId } = await freshProperty("seq-guard");
    const admin = await prisma.user.create({
      data: { enterpriseId, email: `cn-seq-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10), firstName: "A", lastName: "B", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    });
    const code = await chargeCode({ propertyId }, "2001");
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1 } });
    await prisma.folioLineItem.createMany({
      data: [
        { folioId: folio.id, chargeCodeId: code.id, date: new Date(), description: "x", amount: 1, checkNo: "12" },
        { folioId: folio.id, chargeCodeId: code.id, date: new Date(), description: "y", amount: 1, checkNo: "A-99" }, // edited, not counted
      ],
    });
    expect(await highestIssuedNumber(propertyId, "CHECK_NO")).toBe(12);

    const list = await asUser(admin.id, () => sequencesRoute.GET(new Request(`http://localhost/api/settings/sequences?propertyId=${propertyId}`)));
    const rows = (await list.json()) as Array<{ sequenceType: string; highestIssued: number | null }>;
    expect(rows.find((r) => r.sequenceType === "CHECK_NO")?.highestIssued).toBe(12);

    const put = (currentValue: number) =>
      asUser(admin.id, () =>
        sequencesRoute.PUT(new Request("http://localhost/api/settings/sequences", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId, sequenceType: "CHECK_NO", currentValue }),
        }))
      );
    expect((await put(11)).status).toBe(409);
    expect((await put(12)).status).toBe(200);
    expect(await allocateCheckNo(prisma, propertyId)).toBe("13");
  });
});

describe("Night Audit: one check number per stay-night", () => {
  it("room + extra occupancy + allocation + all their taxes share one number; the next night gets another", async () => {
    const { enterpriseId, propertyId, settings } = await freshProperty("night");
    const roomCode = await postable((await chargeCode({ propertyId }, "1000")).id);
    const fbCode = await chargeCode({ propertyId }, "2001");
    const roomType = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 4, baseOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: roomType.id, roomNumber: "101" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR", chargeCodeId: roomCode.id } });
    for (const d of ["2026-10-01", "2026-10-02"]) {
      await prisma.priceCalendar.create({ data: { ratePlanId: ratePlan.id, roomTypeId: roomType.id, date: new Date(d), price: 200, extraAdultPrice: 30 } });
    }
    const allocation = await prisma.allocation.create({
      data: {
        propertyId, code: "BF", name: "Breakfast", type: "FNB", chargeCodeId: fbCode.id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE",
        rates: { create: { adultPrice: 15, childPrice: 0, effectiveFrom: new Date("2026-09-01") } },
      },
    });
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Night", lastName: "Check" } });
    const created = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `CN-${uniq()}`, primaryGuestId: guest.upid, status: "IN_HOUSE", adults: 3, children: 0,
        checkInDate: new Date("2026-10-01"), checkOutDate: new Date("2026-10-04"),
        assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, startDate: new Date("2026-10-01"), endDate: new Date("2026-10-04") } },
        folios: { create: { folioNumber: 1, propertyId } },
        allocations: { create: { allocationId: allocation.id, source: "MANUAL" } },
      },
      include: { folios: true },
    });
    const folioId = created.folios[0].id;
    const res = await prisma.reservation.findUniqueOrThrow({ where: { id: created.id }, include: STAY_NIGHT_INCLUDE });
    const ctx = {
      settings, pricesIncludeTaxes: false, fallbackRoomCode: roomCode, baseRatePlan: null, impliedGreenTaxGenerate: [],
      routeTo: (_r: string, _c: string, d: string) => d,
    };

    const nights = ["2026-10-01", "2026-10-02"];
    for (const n of nights) {
      await prisma.$transaction((tx) => postStayNight(tx, res, { night: new Date(n), postDate: new Date(n), folioId }, ctx));
    }

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    const byNight = nights.map((n) => lines.filter((l) => l.date.toISOString().startsWith(n)));
    const checkNos = byNight.map((night) => [...new Set(night.map((l) => l.checkNo))]);
    for (const [i, night] of byNight.entries()) {
      // Room, extra occupancy, breakfast — each with SC + GST — plus the room's Green Tax.
      const roots = night.filter((l) => !l.generatedFromLineItemId).map((l) => l.description).sort();
      expect(roots).toEqual(["Breakfast (3 adults)", "Extra Occupancy Charge (1 extra adult)", "Nightly Room Charge"]);
      expect(night.some((l) => l.chargeCode.code === "8500")).toBe(true);
      expect(night.length).toBeGreaterThanOrEqual(10);
      expect(checkNos[i], `night ${nights[i]}`).toHaveLength(1);
      expect(checkNos[i][0]).toMatch(/^[0-9]+$/);
    }
    expect(checkNos[0][0]).not.toBe(checkNos[1][0]);
  });
});

describe("PATCH /api/folios/[id]/line-items/check-no", () => {
  let adminId: string;
  let propertyId: string;
  let codeId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const p = await freshProperty("patch");
    propertyId = p.propertyId;
    const admin = await prisma.user.create({
      data: { enterpriseId: p.enterpriseId, email: `cn-patch-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10), firstName: "A", lastName: "B", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    });
    adminId = admin.id;
    codeId = (await customChargeCode({ propertyId }, { code: "MINI", description: "Minibar" })).id;
  });

  const mkFolio = async (data: { isClosed?: boolean } = {}) => {
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1, ...data } });
    const line = (checkNo: string, amount: number) =>
      prisma.folioLineItem.create({ data: { folioId: folio.id, chargeCodeId: codeId, date: new Date("2026-10-01"), description: "Minibar", amount, taxAmount: 1.5, checkNo } });
    return { folio, lines: [await line("1", 10), await line("2", 20)] };
  };

  const patch = (folioId: string, body: unknown) =>
    asUser(adminId, () =>
      checkNoRoute.PATCH(
        new Request(`http://localhost/api/folios/${folioId}/line-items/check-no`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );

  it("sets the number on the chosen lines and changes nothing else", async () => {
    const { folio, lines } = await mkFolio();
    const res = await patch(folio.id, { lineItemIds: lines.map((l) => l.id), checkNo: "  CHK-7 " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    const after = await prisma.folioLineItem.findMany({ where: { folioId: folio.id }, orderBy: { amount: "asc" } });
    expect(after.map((l) => l.checkNo)).toEqual(["CHK-7", "CHK-7"]);
    expect(after.map((l) => [l.amount, l.taxAmount, l.description, l.isVoid])).toEqual([[10, 1.5, "Minibar", false], [20, 1.5, "Minibar", false]]);
  });

  it("validates the number: required, 20 characters at most, letters/digits/'-' only", async () => {
    const { folio, lines } = await mkFolio();
    const ids = [lines[0].id];
    for (const checkNo of ["", "   ", "x".repeat(21), "A 1", "A/1", "#5"]) {
      const res = await patch(folio.id, { lineItemIds: ids, checkNo });
      expect(res.status, JSON.stringify(checkNo)).toBe(400);
    }
    expect((await patch(folio.id, { lineItemIds: [], checkNo: "5" })).status).toBe(400);
    expect((await patch(folio.id, { checkNo: "5" })).status).toBe(400);
    expect((await patch(folio.id, { lineItemIds: ids, checkNo: "x".repeat(20) })).status).toBe(200);
  });

  it("refuses a line from another folio and changes nothing", async () => {
    const a = await mkFolio();
    const b = await mkFolio();
    const res = await patch(a.folio.id, { lineItemIds: [a.lines[0].id, b.lines[0].id], checkNo: "9" });
    expect(res.status).toBe(400);
    const untouched = await prisma.folioLineItem.findMany({ where: { id: { in: [a.lines[0].id, b.lines[0].id] } } });
    expect(untouched.every((l) => l.checkNo === "1")).toBe(true);
  });

  it("refuses a closed folio", async () => {
    const { folio, lines } = await mkFolio({ isClosed: true });
    const res = await patch(folio.id, { lineItemIds: [lines[0].id], checkNo: "9" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/closed/i);
    expect((await prisma.folioLineItem.findUniqueOrThrow({ where: { id: lines[0].id } })).checkNo).toBe("1");
  });

  it("404s an unknown folio", async () => {
    const res = await patch("00000000-0000-0000-0000-000000000000", { lineItemIds: ["x"], checkNo: "9" });
    expect(res.status).toBe(404);
  });
});
