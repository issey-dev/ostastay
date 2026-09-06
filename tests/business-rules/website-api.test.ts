import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie fake as tests/business-rules/hub-access.test.ts — only the Hub
// (session) routes need it; the public Website API routes are key-authenticated and never
// touch cookies.
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
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { createWebsiteApiKey, revokeWebsiteApiKey } = await import("@/lib/website-api/keys");
const { updateWebsitePropertySettings } = await import("@/lib/website-api/settings");
const { hashWebsiteApiKey } = await import("@/lib/website-api/key");
const { ensureChart } = await import("../helpers/charge-codes");

const propertiesRoute = await import("@/app/api/website/v1/properties/route");
const propertyRoute = await import("@/app/api/website/v1/properties/[propertyId]/route");
const availabilityRoute = await import("@/app/api/website/v1/properties/[propertyId]/availability/route");
const quoteRoute = await import("@/app/api/website/v1/properties/[propertyId]/quote/route");
const bookingsRoute = await import("@/app/api/website/v1/properties/[propertyId]/bookings/route");
const lookupRoute = await import("@/app/api/website/v1/bookings/[confirmationNo]/route");
const hubKeysRoute = await import("@/app/api/hub/website/keys/route");

const BASE = "http://localhost/api/website/v1";

function req(path: string, opts: { key?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
const params = <P,>(p: P) => ({ params: Promise.resolve(p) });

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

// The public Website API (src/app/api/website/v1/**) — a property's own brand website
// reading availability/prices and creating bookings through a Hub-minted key. See
// .agents/docs/WEBSITE_API_PLAN.md for the rules pinned here.
describe("Website API", () => {
  let enterpriseAId: string;
  let enterpriseBId: string;
  let propertyAId: string;
  let propertyA2Id: string; // second property in A, NOT on key A's list
  let propertyBId: string;
  let roomTypeAId: string;
  let ratePlanAId: string;
  let adminAId: string;
  let keyA = "";
  let keyAId = "";
  let keyB = "";

  const CHECK_IN = "2026-01-10";
  const CHECK_OUT = "2026-01-12";

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const stamp = Date.now();

    const enterpriseA = await prisma.enterprise.create({
      data: { name: `Web Ent A ${stamp}`, slug: `test-web-a-${stamp}`, type: "STANDARD" },
    });
    enterpriseAId = enterpriseA.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId: enterpriseAId, tier: "STANDARD", maxProperties: 5 } });
    // The quote prices nothing without an accommodation charge code (see
    // computeReservationQuote) — every real enterprise has the canonical chart.
    await ensureChart(enterpriseAId);
    const enterpriseB = await prisma.enterprise.create({
      data: { name: `Web Ent B ${stamp}`, slug: `test-web-b-${stamp}`, type: "STANDARD" },
    });
    enterpriseBId = enterpriseB.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId: enterpriseBId, tier: "STANDARD", maxProperties: 5 } });

    const makeProperty = (enterpriseId: string, code: string, name: string) =>
      prisma.property.create({
        data: {
          enterpriseId,
          name,
          code: `${code}-${stamp}`,
          legalName: `${name} LLC`,
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
          address: "1 Beach Road",
          contactEmail: "stay@example.com",
          // Pinned so the arrival floor is deterministic rather than the wall-clock date.
          businessDate: new Date(Date.UTC(2026, 0, 1)),
        },
      });
    const propertyA = await makeProperty(enterpriseAId, "WPA", "Web Property A");
    propertyAId = propertyA.id;
    const propertyA2 = await makeProperty(enterpriseAId, "WPA2", "Web Property A2");
    propertyA2Id = propertyA2.id;
    const propertyB = await makeProperty(enterpriseBId, "WPB", "Web Property B");
    propertyBId = propertyB.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "Standard", code: "STD", maxOccupancy: 3, baseOccupancy: 2, description: "A standard room" },
    });
    roomTypeAId = roomType.id;
    // Two sellable rooms — the sold-out test books both.
    for (const n of ["101", "102"]) {
      await prisma.room.create({ data: { propertyId: propertyAId, roomTypeId: roomTypeAId, roomNumber: `${n}-${stamp}` } });
    }
    await prisma.facility.create({ data: { propertyId: propertyAId, name: "Pool" } });

    const base = await prisma.ratePlan.create({
      data: { propertyId: propertyAId, code: "BASE", name: "Base Rate", isLocked: true },
    });
    const bar = await prisma.ratePlan.create({
      data: { propertyId: propertyAId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanAId = bar.id;
    // BAR priced at 100 for January 2026; BASE priced at 80 (the fallback, which the
    // BAR-configured site must NOT show).
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      const date = new Date(Date.UTC(2026, 0, d));
      rows.push({ ratePlanId: bar.id, roomTypeId: roomTypeAId, date, price: 100, extraAdultPrice: 25 });
      rows.push({ ratePlanId: base.id, roomTypeId: roomTypeAId, date, price: 80 });
    }
    await prisma.priceCalendar.createMany({ data: rows });

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId,
        email: `web-admin-a-${stamp}@test.local`,
        passwordHash,
        firstName: "Web",
        lastName: "Admin",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;
    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseBId,
        email: `web-admin-b-${stamp}@test.local`,
        passwordHash,
        firstName: "Web",
        lastName: "AdminB",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });

    const mintedA = await createWebsiteApiKey({
      enterpriseId: enterpriseAId,
      userId: adminAId,
      name: "www.property-a.test",
      propertyIds: [propertyAId],
      allowedOrigins: ["https://www.property-a.test/some/page"],
      expiresAt: null,
    });
    keyA = mintedA.key;
    keyAId = mintedA.row.id;
    const mintedB = await createWebsiteApiKey({
      enterpriseId: enterpriseBId,
      userId: adminB.id,
      name: "www.property-b.test",
      propertyIds: [propertyBId],
      allowedOrigins: [],
      expiresAt: null,
    });
    keyB = mintedB.key;
  });

  describe("authentication", () => {
    it("stores only the hash and a display prefix, never the key", async () => {
      const row = await prisma.websiteApiKey.findUniqueOrThrow({ where: { id: keyAId } });
      expect(row.keyHash).toBe(hashWebsiteApiKey(keyA));
      expect(row.keyHash).not.toContain(keyA);
      expect(keyA.startsWith(row.keyPrefix)).toBe(true);
      expect(row.keyPrefix.length).toBeLessThan(keyA.length / 2);
      // Origins are normalised to scheme + host — the pasted page path is dropped.
      expect(row.allowedOrigins).toEqual(["https://www.property-a.test"]);
    });

    it("rejects a missing key, an unknown key, and a revoked key identically at 401", async () => {
      const missing = await propertiesRoute.GET(req("/properties"), params({}));
      expect(missing.status).toBe(401);
      expect((await missing.json()).code).toBe("MISSING_API_KEY");

      const unknown = await propertiesRoute.GET(req("/properties", { key: "wsk_" + "0".repeat(64) }), params({}));
      expect(unknown.status).toBe(401);
      expect((await unknown.json()).code).toBe("INVALID_API_KEY");

      const revokable = await createWebsiteApiKey({
        enterpriseId: enterpriseAId,
        userId: adminAId,
        name: "temp",
        propertyIds: [propertyAId],
        allowedOrigins: [],
        expiresAt: null,
      });
      const before = await propertiesRoute.GET(req("/properties", { key: revokable.key }), params({}));
      expect(before.status).toBe(200);
      await revokeWebsiteApiKey({ enterpriseId: enterpriseAId, id: revokable.row.id, userId: adminAId });
      const after = await propertiesRoute.GET(req("/properties", { key: revokable.key }), params({}));
      expect(after.status).toBe(401);
      expect((await after.json()).code).toBe("INVALID_API_KEY");
    });

    it("accepts the key via X-Api-Key as well as a Bearer token", async () => {
      const res = await propertiesRoute.GET(req("/properties", { headers: { "x-api-key": keyA } }), params({}));
      expect(res.status).toBe(200);
    });

    it("emits CORS headers only for an origin on the key's allow-list", async () => {
      const allowed = await propertiesRoute.GET(
        req("/properties", { key: keyA, headers: { origin: "https://www.property-a.test" } }),
        params({})
      );
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://www.property-a.test");

      const other = await propertiesRoute.GET(
        req("/properties", { key: keyA, headers: { origin: "https://evil.example" } }),
        params({})
      );
      expect(other.status).toBe(200);
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("property scoping", () => {
    it("lists only the properties on the key, and answers 404 (not 403) for any other", async () => {
      const list = await propertiesRoute.GET(req("/properties", { key: keyA }), params({}));
      const body = await list.json();
      expect(body.properties.map((p: { id: string }) => p.id)).toEqual([propertyAId]);

      // Same enterprise, not on the list.
      const sibling = await propertyRoute.GET(req(`/properties/${propertyA2Id}`, { key: keyA }), params({ propertyId: propertyA2Id }));
      expect(sibling.status).toBe(404);
      // Another enterprise entirely.
      const foreign = await propertyRoute.GET(req(`/properties/${propertyAId}`, { key: keyB }), params({ propertyId: propertyAId }));
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).code).toBe("PROPERTY_NOT_FOUND");
    });

    it("exposes property info, room types and facilities — and reports booking as not set up until the Hub configures it", async () => {
      const res = await propertyRoute.GET(req(`/properties/${propertyAId}`, { key: keyA }), params({ propertyId: propertyAId }));
      expect(res.status).toBe(200);
      const { property } = await res.json();
      expect(property.name).toBe("Web Property A");
      expect(property.address).toBe("1 Beach Road");
      expect(property.contact.email).toBe("stay@example.com");
      expect(property.businessDate).toBe("2026-01-01");
      expect(property.facilities.map((f: { name: string }) => f.name)).toEqual(["Pool"]);
      expect(property.roomTypes).toHaveLength(1);
      expect(property.roomTypes[0]).toMatchObject({ code: "STD", maxOccupancy: 3, totalRooms: 2 });
      expect(property.booking.enabled).toBe(false);
      expect(property.booking.ratePlan).toBeNull();
      // Nothing operational leaks.
      expect(property).not.toHaveProperty("enterpriseId");
    });
  });

  describe("availability and quote", () => {
    beforeAll(async () => {
      await updateWebsitePropertySettings({
        enterpriseId: enterpriseAId,
        propertyId: propertyAId,
        input: { ratePlanId: ratePlanAId, headline: "Sea, sand, silence", deskRemark: "Collect balance at check-in" },
      });
    });

    it("refuses to sell a negotiated rate plan on the website", async () => {
      const negotiated = await prisma.ratePlan.create({
        data: { propertyId: propertyAId, code: "CORP", name: "Corporate", isNegotiated: true },
      });
      await expect(
        updateWebsitePropertySettings({ enterpriseId: enterpriseAId, propertyId: propertyAId, input: { ratePlanId: negotiated.id } })
      ).rejects.toThrow(/negotiated/i);
    });

    it("publishes actual inventory on the configured plan, and closes (not just zeroes) a stop-sale night", async () => {
      const closedNight = new Date(Date.UTC(2026, 0, 11));
      await prisma.availabilityRestriction.create({ data: { propertyId: propertyAId, roomTypeId: null, date: closedNight } });
      try {
        const res = await availabilityRoute.GET(
          req(`/properties/${propertyAId}/availability?from=${CHECK_IN}&to=2026-01-13`, { key: keyA }),
          params({ propertyId: propertyAId })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ratePlan.code).toBe("BAR");
        expect(body.bookingEnabled).toBe(true);
        const rt = body.roomTypes[0];
        expect(rt.nights.map((n: { date: string }) => n.date)).toEqual(["2026-01-10", "2026-01-11", "2026-01-12"]);
        expect(rt.nights[0]).toMatchObject({ available: 2, closed: false, price: 100, extraAdultPrice: 25 });
        expect(rt.nights[1]).toMatchObject({ available: 0, closed: true });
        expect(rt.minAvailable).toBe(0);
        expect(rt.bookable).toBe(false);
      } finally {
        await prisma.availabilityRestriction.deleteMany({ where: { propertyId: propertyAId } });
      }
    });

    it("rejects a window that starts before the property's business date", async () => {
      const res = await availabilityRoute.GET(
        req(`/properties/${propertyAId}/availability?from=2025-12-30&to=2026-01-02`, { key: keyA }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("ARRIVAL_IN_PAST");
    });

    it("quotes the full stay with the same figures the desk would post", async () => {
      const res = await quoteRoute.POST(
        req(`/properties/${propertyAId}/quote`, { key: keyA, body: { checkIn: CHECK_IN, checkOut: CHECK_OUT, roomTypeId: roomTypeAId, adults: 3, children: 0 } }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(200);
      const { quote } = await res.json();
      expect(quote.nights).toBe(2);
      expect(quote.available).toBe(true);
      expect(quote.roomsAvailable).toBe(2);
      expect(quote.totals.roomBase).toBe(200);
      // Third adult over baseOccupancy 2 → 25/night surcharge.
      expect(quote.totals.extraOccupancy).toBe(50);
      expect(quote.totals.grandTotal).toBeGreaterThanOrEqual(250);
      expect(quote.nightly).toHaveLength(2);
    });

    it("validates occupancy against the room type", async () => {
      const res = await quoteRoute.POST(
        req(`/properties/${propertyAId}/quote`, { key: keyA, body: { checkIn: CHECK_IN, checkOut: CHECK_OUT, roomTypeId: roomTypeAId, adults: 4, children: 0 } }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_OCCUPANCY");
    });
  });

  describe("booking", () => {
    const stay = { checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0 };
    const guest = { firstName: "Ada", lastName: "Lovelace", email: "Ada@Example.com", phone: "+960 7000000" };
    let firstConfirmation = "";

    it("creates a real RESERVED reservation through createReservation, tagged as a website booking", async () => {
      const res = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, {
          key: keyA,
          body: { ...stay, roomTypeId: roomTypeAId, guest, remarks: "Late arrival" },
          headers: { "idempotency-key": `idem-1-${keyAId}` },
        }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(201);
      const { booking } = await res.json();
      expect(booking.replayed).toBe(false);
      expect(booking.confirmationNo).toBeTruthy();
      expect(booking.status).toBe("RESERVED");
      expect(booking.guest.email).toBe("ada@example.com");
      firstConfirmation = booking.confirmationNo;

      const reservation = await prisma.reservation.findUniqueOrThrow({
        where: { id: booking.reservationId },
        include: { assignments: true, folios: true, primaryGuest: { include: { communications: true } } },
      });
      expect(reservation.propertyId).toBe(propertyAId);
      expect(reservation.externalRef).toMatch(/^WEB-[0-9A-F]{8}$/);
      expect(reservation.remarks).toContain("Booked via website");
      expect(reservation.remarks).toContain("Collect balance at check-in");
      expect(reservation.remarks).toContain("Late arrival");
      expect(reservation.assignments[0].ratePlanId).toBe(ratePlanAId);
      expect(reservation.folios).toHaveLength(1);
      expect(reservation.primaryGuest.firstName).toBe("Ada");
      expect(reservation.primaryGuest.communications.map((c) => c.value)).toEqual(expect.arrayContaining(["ada@example.com", "+960 7000000"]));

      const audit = await prisma.websiteBooking.findUniqueOrThrow({ where: { reservationId: reservation.id } });
      expect(audit.status).toBe("CONFIRMED");
      expect(audit.keyId).toBe(keyAId);
      expect(audit.quotedTotal).toBeGreaterThan(0);
    });

    it("replays the same booking for the same Idempotency-Key instead of creating a second one", async () => {
      const before = await prisma.reservation.count({ where: { propertyId: propertyAId } });
      const res = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, {
          key: keyA,
          body: { ...stay, roomTypeId: roomTypeAId, guest },
          headers: { "idempotency-key": `idem-1-${keyAId}` },
        }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(200);
      const { booking } = await res.json();
      expect(booking.replayed).toBe(true);
      expect(booking.confirmationNo).toBe(firstConfirmation);
      expect(await prisma.reservation.count({ where: { propertyId: propertyAId } })).toBe(before);
    });

    it("reuses the guest profile for a returning email, then refuses once the last room is gone — the website never overbooks", async () => {
      const profilesBefore = await prisma.profile.count({ where: { enterpriseId: enterpriseAId } });
      const second = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { ...stay, roomTypeId: roomTypeAId, guest } }),
        params({ propertyId: propertyAId })
      );
      expect(second.status).toBe(201);
      expect(await prisma.profile.count({ where: { enterpriseId: enterpriseAId } })).toBe(profilesBefore);

      const third = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { ...stay, roomTypeId: roomTypeAId, guest: { ...guest, email: "someone@else.test" } } }),
        params({ propertyId: propertyAId })
      );
      expect(third.status).toBe(409);
      expect((await third.json()).code).toBe("SOLD_OUT");
      const failed = await prisma.websiteBooking.findFirst({ where: { keyId: keyAId, status: "FAILED" } });
      expect(failed?.guestEmail).toBe("someone@else.test");
    });

    it("refuses a stay that touches a stop-sale night", async () => {
      await prisma.availabilityRestriction.create({ data: { propertyId: propertyAId, roomTypeId: roomTypeAId, date: new Date(Date.UTC(2026, 0, 20)) } });
      try {
        const res = await bookingsRoute.POST(
          req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { checkIn: "2026-01-20", checkOut: "2026-01-21", adults: 1, children: 0, roomTypeId: roomTypeAId, guest } }),
          params({ propertyId: propertyAId })
        );
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("STOP_SALE");
      } finally {
        await prisma.availabilityRestriction.deleteMany({ where: { propertyId: propertyAId } });
      }
    });

    it("refuses a stay with an unpriced night rather than confirm it at zero", async () => {
      const res = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { checkIn: "2026-01-31", checkOut: "2026-02-02", adults: 1, children: 0, roomTypeId: roomTypeAId, guest } }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("NO_RATE");
    });

    it("validates the body and reports field-level details", async () => {
      const res = await bookingsRoute.POST(
        req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { ...stay, roomTypeId: roomTypeAId, guest: { firstName: "", email: "not-an-email" } } }),
        params({ propertyId: propertyAId })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION");
      expect(body.details).toHaveProperty("guest.firstName");
      expect(body.details).toHaveProperty("guest.email");
    });

    it("refuses when the Hub switches booking off, without touching the property page", async () => {
      await updateWebsitePropertySettings({ enterpriseId: enterpriseAId, propertyId: propertyAId, input: { bookingEnabled: false } });
      try {
        const res = await bookingsRoute.POST(
          req(`/properties/${propertyAId}/bookings`, { key: keyA, body: { checkIn: "2026-01-25", checkOut: "2026-01-26", adults: 1, children: 0, roomTypeId: roomTypeAId, guest } }),
          params({ propertyId: propertyAId })
        );
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("BOOKING_DISABLED");
        const page = await propertyRoute.GET(req(`/properties/${propertyAId}`, { key: keyA }), params({ propertyId: propertyAId }));
        expect((await page.json()).property.booking).toMatchObject({ enabled: false, reason: expect.stringMatching(/switched off/) });
      } finally {
        await updateWebsitePropertySettings({ enterpriseId: enterpriseAId, propertyId: propertyAId, input: { bookingEnabled: true } });
      }
    });

    it("looks a booking up by confirmation number + email, only through the key that made it", async () => {
      const ok = await lookupRoute.GET(
        req(`/bookings/${firstConfirmation}?email=ADA@example.com`, { key: keyA }),
        params({ confirmationNo: firstConfirmation })
      );
      expect(ok.status).toBe(200);
      expect((await ok.json()).booking.confirmationNo).toBe(firstConfirmation);

      const wrongEmail = await lookupRoute.GET(
        req(`/bookings/${firstConfirmation}?email=other@example.com`, { key: keyA }),
        params({ confirmationNo: firstConfirmation })
      );
      expect(wrongEmail.status).toBe(404);

      const otherKey = await lookupRoute.GET(
        req(`/bookings/${firstConfirmation}?email=ada@example.com`, { key: keyB }),
        params({ confirmationNo: firstConfirmation })
      );
      expect(otherKey.status).toBe(404);
    });
  });

  describe("Hub management", () => {
    it("mints a key through the Hub route, returns the plaintext once, and never lists it again", async () => {
      const created = await asUser(adminAId, () =>
        hubKeysRoute.POST(
          new Request("http://localhost/api/hub/website/keys", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "hub-minted", propertyIds: [propertyAId, propertyA2Id], allowedOrigins: [] }),
          })
        )
      );
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body.key).toMatch(/^wsk_[0-9a-f]{64}$/);
      expect(body.row.properties).toHaveLength(2);

      const list = await asUser(adminAId, () => hubKeysRoute.GET());
      const listed = (await list.json()).keys as { id: string; keyPrefix: string }[];
      const row = listed.find((k) => k.id === body.row.id)!;
      expect(row.keyPrefix).toBe(body.key.slice(0, 12));
      expect(JSON.stringify(listed)).not.toContain(body.key);

      // A key covering two properties sees both; the sibling now resolves.
      const sibling = await propertyRoute.GET(req(`/properties/${propertyA2Id}`, { key: body.key }), params({ propertyId: propertyA2Id }));
      expect(sibling.status).toBe(200);
    });

    it("refuses to mint a key for another enterprise's property", async () => {
      const res = await asUser(adminAId, () =>
        hubKeysRoute.POST(
          new Request("http://localhost/api/hub/website/keys", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "cross-tenant", propertyIds: [propertyBId], allowedOrigins: [] }),
          })
        )
      );
      expect(res.status).toBe(403);
    });
  });
});
