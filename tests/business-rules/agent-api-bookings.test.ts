import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 6 (9.6.0): the whole of §1a end to end through the Agent API, plus
// isolation, idempotent replay, a price change, cancel rules and change requests.

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
const { createSession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { invitePortalLogin } = await import("@/lib/agent-api/auth");
const { approveSlotRequest } = await import("@/lib/groups/slot-requests");
const { confirmTentative } = await import("@/lib/reservations/options");
const { serverToday } = await import("@/lib/business-date");
const { setPropertySettings } = await import("../helpers/property-settings");
const { ensureChart } = await import("../helpers/charge-codes");

const acceptRoute = await import("@/app/api/agent/v1/auth/accept-invite/route");
const slotReqRoute = await import("@/app/api/agent/v1/properties/[propertyId]/slot-requests/route");
const slotRoute = await import("@/app/api/agent/v1/slots/[code]/route");
const slotBookingsRoute = await import("@/app/api/agent/v1/slots/[code]/bookings/route");
const roomingRoute = await import("@/app/api/agent/v1/slots/[code]/rooming-list/route");
const bookingsRoute = await import("@/app/api/agent/v1/bookings/route");
const bookingRoute = await import("@/app/api/agent/v1/bookings/[ref]/route");
const reqConfRoute = await import("@/app/api/agent/v1/bookings/[ref]/request-confirmation/route");
const guestsRoute = await import("@/app/api/agent/v1/bookings/[ref]/guests/route");
const travelRoute = await import("@/app/api/agent/v1/bookings/[ref]/travel/route");
const requestsRoute = await import("@/app/api/agent/v1/bookings/[ref]/requests/route");
const cancelRoute = await import("@/app/api/agent/v1/bookings/[ref]/cancel/route");
const changeRoute = await import("@/app/api/agent/v1/bookings/[ref]/change-requests/route");
const confirmationRoute = await import("@/app/api/agent/v1/bookings/[ref]/confirmation/route");

const DAY = 86_400_000;
const day = (o: number) => new Date(serverToday().getTime() + o * DAY).toISOString().slice(0, 10);
const noParams = { params: Promise.resolve({}) } as { params: Promise<Record<string, never>> };
let idem = 0;
function req(key: string, token: string | undefined, opts: { method?: string; body?: unknown; url?: string; idemKey?: string; accept?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  if (token) headers["x-agent-token"] = token;
  if (opts.method && opts.method !== "GET") headers["idempotency-key"] = opts.idemKey ?? `test-${Date.now()}-${idem++}`;
  if (opts.accept) headers.accept = opts.accept;
  return new Request(`http://localhost${opts.url ?? "/x"}`, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("Agent API: slots and bookings (§1a end to end)", () => {
  const stamp = Date.now();
  let enterpriseId: string, propertyId: string, roomTypeId: string, sourceA: string, sourceB: string, adminId: string, key: string;
  let tokenA: string, tokenB: string;

  beforeAll(async () => {
    await _resetWebsiteRateLimiter();
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: `AgB ${stamp}`, slug: `test-agb-${stamp}`, type: "STANDARD" } })).id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 3 } });
    propertyId = (
      await prisma.property.create({
        data: { enterpriseId, name: "AgB", code: `AGB-${stamp}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday() },
      })
    ).id;
    await ensureChart({ propertyId });
    await setPropertySettings(propertyId, { agentPortalEnabled: true, tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false, guestDetailsDueDays: 7 });
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 3 } })).id;
    await prisma.room.createMany({ data: [1, 2, 3, 4, 5, 6].map((n) => ({ propertyId, roomTypeId, roomNumber: `40${n}`, status: "AVAILABLE" })) });
    await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } });
    const neg = await prisma.ratePlan.create({ data: { propertyId, code: "NEG", name: "Contract", isNegotiated: true, priority: 5 } });
    for (let i = 0; i < 90; i++) await prisma.priceCalendar.create({ data: { ratePlanId: neg.id, roomTypeId, date: new Date(serverToday().getTime() + i * DAY), price: 200 } });
    sourceA = (await prisma.profile.create({ data: { enterpriseId, firstName: "A", companyName: "Atoll Tours", profileType: "SOURCE" } })).upid;
    sourceB = (await prisma.profile.create({ data: { enterpriseId, firstName: "B", companyName: "Beach DMC", profileType: "SOURCE" } })).upid;
    await prisma.ratePlanAgentAccess.createMany({ data: [{ ratePlanId: neg.id, upid: sourceA }, { ratePlanId: neg.id, upid: sourceB }] });
    adminId = (
      await prisma.user.create({
        data: { enterpriseId, email: `agb-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
    key = (await createWebsiteApiKey({ enterpriseId, userId: adminId, name: "Portal", propertyId: null, allowedOrigins: [], scopes: ["AGENT"], expiresAt: null })).key;
    const ctx = await staff();
    for (const [src, email] of [[sourceA, `a-${stamp}@example.com`], [sourceB, `b-${stamp}@example.com`]] as const) {
      const inv = await invitePortalLogin(ctx, src, { email, name: email });
      const t = (await (await acceptRoute.POST(req(key, undefined, { method: "POST", body: { token: inv.token, password: "long-enough-pw" } }), noParams)).json()).token;
      if (src === sourceA) tokenA = t;
      else tokenB = t;
    }
  });

  const staff = async () => {
    cookieJar.clear();
    await createSession(adminId);
    return requireSession();
  };

  it("request → approve → book on option → request confirmation → hotel confirms → details → confirmation PDF", async () => {
    // 2. The agent requests a slot.
    const r1 = await slotReqRoute.POST(
      req(key, tokenA, { method: "POST", body: { from: day(40), to: day(44), rooms: [{ roomTypeId, quantity: 3 }], note: "Spring group" } }),
      { params: Promise.resolve({ propertyId }) }
    );
    expect(r1.status).toBe(201);
    const slot = await r1.json();
    expect(slot.status).toBe("AWAITING_HOTEL");
    expect(slot.rooms[0].askedFor).toBe(3);

    // Booking before approval is refused.
    const early = await slotBookingsRoute.POST(
      req(key, tokenA, { method: "POST", body: { rooms: [{ roomTypeId, checkIn: day(40), checkOut: day(42), adults: 2, leadGuest: { firstName: "Ann", lastName: "Lee" } }] } }),
      { params: Promise.resolve({ code: slot.code }) }
    );
    expect((await early.json()).code).toBe("SLOT_NOT_APPROVED");

    // 3. The hotel approves 2 rooms with a cutoff.
    const block = await prisma.groupBlock.findFirstOrThrow({ where: { code: slot.code, propertyId } });
    await approveSlotRequest(await staff(), block.id, { rooms: [{ roomTypeId, quantity: 2 }], rules: { cutoffDate: new Date(`${day(30)}T00:00:00Z`) } });
    const approved = await (await slotRoute.GET(req(key, tokenA), { params: Promise.resolve({ code: slot.code }) })).json();
    expect(approved.status).toBe("TENTATIVE");
    expect(approved.rooms[0].approved).toBe(2);

    // 4. A booking with the lead guest only: on option until the cutoff. Wrong expected price → PRICE_CHANGED.
    const body = { rooms: [{ roomTypeId, checkIn: day(40), checkOut: day(42), adults: 2, leadGuest: { firstName: "Ann", lastName: "Lee" }, agentReference: "FILE-77" }] };
    const stale = await slotBookingsRoute.POST(req(key, tokenA, { method: "POST", body: { ...body, expectedTotal: 1 } }), { params: Promise.resolve({ code: slot.code }) });
    expect((await stale.json()).code).toBe("PRICE_CHANGED");
    const made = await slotBookingsRoute.POST(req(key, tokenA, { method: "POST", body: { ...body, expectedTotal: 400 }, idemKey: `idem-${stamp}` }), { params: Promise.resolve({ code: slot.code }) });
    expect(made.status).toBe(201);
    const [b] = (await made.json()).bookings;
    expect(b.status).toBe("ON_OPTION");
    expect(b.optionUntil?.slice(0, 10)).toBe(day(30));
    expect(b.ref).toMatch(/^AG-/);
    // Idempotent replay: same key → same booking, nothing new.
    const replay = await slotBookingsRoute.POST(req(key, tokenA, { method: "POST", body: { ...body, expectedTotal: 400 }, idemKey: `idem-${stamp}` }), { params: Promise.resolve({ code: slot.code }) });
    expect((await replay.json()).bookings[0].ref).toBe(b.ref);
    expect(await prisma.reservation.count({ where: { groupBlockId: block.id, status: { not: "CANCELLED" } } })).toBe(1);

    // 5. Request confirmation; the hotel confirms.
    const asked = await (await reqConfRoute.POST(req(key, tokenA, { method: "POST", body: { paymentReference: "TT-1234" } }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(asked.status).toBe("CONFIRMATION_REQUESTED");
    const row = await prisma.reservation.findFirstOrThrow({ where: { agentRef: b.ref } });
    expect(row.confirmationNote).toMatch(/TT-1234/);
    await confirmTentative(await staff(), row.id);
    expect((await (await bookingRoute.GET(req(key, tokenA), { params: Promise.resolve({ ref: b.ref }) })).json()).status).toBe("CONFIRMED");

    // 6. Details later: guests, travel, requests.
    const g = await (await guestsRoute.PATCH(req(key, tokenA, { method: "PATCH", body: { guests: [{ firstName: "Ben", lastName: "Lee", nationality: "gbr", dateOfBirth: "1990-04-02" }] } }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(g.guests[0].nationality).toBe("GBR");
    expect(g.guestDetailsComplete).toBe(true);
    const t = await (await travelRoute.PATCH(req(key, tokenA, { method: "PATCH", body: { arrival: { flight: "EK652", time: `${day(40)}T09:30:00Z`, transfer: "Speedboat" } } }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(t.travel[0]).toMatchObject({ direction: "ARRIVAL", flight: "EK652" });
    const rq = await (await requestsRoute.PATCH(req(key, tokenA, { method: "PATCH", body: { packageName: "Honeymoon", requests: "High floor, no nuts" } }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(rq.packageName).toBe("Honeymoon");

    // The confirmation: a PDF, version 1, then version 2.
    const pdf = await confirmationRoute.POST(req(key, tokenA, { method: "POST", body: { email: false } }), { params: Promise.resolve({ ref: b.ref }) });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const json = await (await confirmationRoute.POST(req(key, tokenA, { method: "POST", body: { email: false }, accept: "application/json" }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(json.version).toBe(2);

    // A confirmed booking cannot be cancelled here; a change request goes to the hotel.
    expect((await (await cancelRoute.POST(req(key, tokenA, { method: "POST", body: { reason: "x" } }), { params: Promise.resolve({ ref: b.ref }) })).json()).code).toBe("BOOKING_LOCKED");
    const cr = await (await changeRoute.POST(req(key, tokenA, { method: "POST", body: { type: "CANCEL", note: "Client ill" } }), { params: Promise.resolve({ ref: b.ref }) })).json();
    expect(cr.changeRequests[0]).toMatchObject({ type: "CANCEL", status: "PENDING" });

    // Isolation: the other agent sees none of it.
    expect((await bookingRoute.GET(req(key, tokenB), { params: Promise.resolve({ ref: b.ref }) })).status).toBe(404);
    expect((await slotRoute.GET(req(key, tokenB), { params: Promise.resolve({ code: slot.code }) })).status).toBe(404);
    const listB = await (await bookingsRoute.GET(req(key, tokenB, { url: "/api/agent/v1/bookings" }), noParams)).json();
    expect(listB.bookings).toEqual([]);
  });

  it("a tentative booking can be cancelled with a reason; a rooming list applies line by line", async () => {
    const slot = await (await slotReqRoute.POST(req(key, tokenA, { method: "POST", body: { from: day(60), to: day(62), rooms: [{ roomTypeId, quantity: 2 }] } }), { params: Promise.resolve({ propertyId }) })).json();
    const block = await prisma.groupBlock.findFirstOrThrow({ where: { code: slot.code, propertyId } });
    await approveSlotRequest(await staff(), block.id);
    const list = await roomingRoute.POST(
      req(key, tokenA, {
        method: "POST",
        body: {
          rooms: [
            { roomTypeId, checkIn: day(60), checkOut: day(62), adults: 1, leadGuest: { firstName: "C", lastName: "One" } },
            { roomTypeId, checkIn: day(70), checkOut: day(71), adults: 1, leadGuest: { firstName: "C", lastName: "Two" } }, // outside the slot
            { roomTypeId, checkIn: day(60), checkOut: day(61), adults: 1, leadGuest: { firstName: "C", lastName: "Three" } },
          ],
        },
      }),
      { params: Promise.resolve({ code: slot.code }) }
    );
    const res = await list.json();
    expect(res.accepted).toBe(2);
    expect(res.results[1]).toMatchObject({ ok: false, code: "SLOT_FULL" });
    const ref = res.results[0].ref;
    expect((await (await cancelRoute.POST(req(key, tokenA, { method: "POST", body: {} }), { params: Promise.resolve({ ref }) })).json()).code).toBe("REASON_REQUIRED");
    const cancelled = await (await cancelRoute.POST(req(key, tokenA, { method: "POST", body: { reasonCode: "CLIENT_CANCELLED", reason: "Trip off" } }), { params: Promise.resolve({ ref }) })).json();
    expect(cancelled.status).toBe("CANCELLED");
    expect(await prisma.reservation.count({ where: { agentRef: ref } })).toBe(1); // never deleted
  });

  // Phase 9 hardening: a burst of parallel bookings for a slot's last rooms never oversells it,
  // and malformed or oversized bodies are refused before anything is written.
  it("parallel bookings racing for a slot's last rooms: exactly the slot fills, the rest are refused", async () => {
    await _resetWebsiteRateLimiter(); // earlier tests used up this key's per-minute quota
    const slot = await (await slotReqRoute.POST(req(key, tokenA, { method: "POST", body: { from: day(80), to: day(82), rooms: [{ roomTypeId, quantity: 2 }] } }), { params: Promise.resolve({ propertyId }) })).json();
    const block = await prisma.groupBlock.findFirstOrThrow({ where: { code: slot.code, propertyId } });
    await approveSlotRequest(await staff(), block.id);
    const one = (n: number) =>
      slotBookingsRoute.POST(
        req(key, tokenA, { method: "POST", body: { rooms: [{ roomTypeId, checkIn: day(80), checkOut: day(82), adults: 1, leadGuest: { firstName: "Race", lastName: `N${n}` } }] } }),
        { params: Promise.resolve({ code: slot.code }) }
      );
    const answers = await Promise.all([0, 1, 2, 3, 4, 5].map(one));
    const ok = answers.filter((r) => r.status === 201).length;
    expect(ok).toBe(2);
    for (const r of answers.filter((r) => r.status !== 201)) expect(r.status, JSON.stringify(await r.clone().json())).toBeLessThan(500);
    expect(await prisma.reservation.count({ where: { groupBlockId: block.id, status: { not: "CANCELLED" } } })).toBe(2);
  });

  it("malformed and oversized bodies are refused with a 4xx and write nothing", async () => {
    await _resetWebsiteRateLimiter(); // earlier tests used up this key's per-minute quota
    const slot = await (await slotReqRoute.POST(req(key, tokenA, { method: "POST", body: { from: day(85), to: day(86), rooms: [{ roomTypeId, quantity: 1 }] } }), { params: Promise.resolve({ propertyId }) })).json();
    const block = await prisma.groupBlock.findFirstOrThrow({ where: { code: slot.code, propertyId } });
    await approveSlotRequest(await staff(), block.id);
    const params = { params: Promise.resolve({ code: slot.code }) };
    const broken = new Request("http://localhost/x", { method: "POST", headers: { authorization: `Bearer ${key}`, "x-agent-token": tokenA, "content-type": "application/json", "idempotency-key": `bad-${stamp}` }, body: "{not json" });
    const r1 = await slotBookingsRoute.POST(broken, params);
    expect(r1.status).toBeGreaterThanOrEqual(400);
    expect(r1.status).toBeLessThan(500);
    const many = Array.from({ length: 31 }, (_, i) => ({ roomTypeId, checkIn: day(85), checkOut: day(86), adults: 1, leadGuest: { firstName: "X", lastName: `${i}` } }));
    expect((await (await slotBookingsRoute.POST(req(key, tokenA, { method: "POST", body: { rooms: many } }), params)).json()).code).toBe("INVALID_BODY");
    const huge = Array.from({ length: 201 }, () => ({}));
    expect((await (await roomingRoute.POST(req(key, tokenA, { method: "POST", body: { rooms: huge } }), params)).json()).code).toBe("INVALID_BODY");
    const past = await (await slotBookingsRoute.POST(req(key, tokenA, { method: "POST", body: { rooms: [{ roomTypeId, checkIn: day(-3), checkOut: day(-1), adults: 1, leadGuest: { firstName: "P", lastName: "Q" } }] } }), params)).json();
    expect(past.code).toBe("INVALID_DATES");
    expect(await prisma.reservation.count({ where: { groupBlockId: block.id } })).toBe(0);
  });
});
