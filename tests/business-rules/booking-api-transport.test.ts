import { describe, it, expect, beforeAll } from "vitest";

// The Booking API's TRANSPORT scope (TRANSPORTATION_PLAN.md, Phase 3): the gate order
// (property on the key → scope → server-only key → module on), configuration and booking
// CRUD through the same services as the desk, cursor pagination, billing without voids,
// and no reach into another property or enterprise.

const { prisma } = await import("@/lib/db");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { ensureChart } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");
const base = "@/app/api/website/v1/properties/[propertyId]/transport";
const moduleRoute = await import(`${base}/route`);
const entityRoute = await import(`${base}/config/[entity]/route`);
const entityIdRoute = await import(`${base}/config/[entity]/[id]/route`);
const bookingsRoute = await import(`${base}/bookings/route`);
const bookingRoute = await import(`${base}/bookings/[bookingId]/route`);
const billingRoute = await import(`${base}/bookings/[bookingId]/billing/route`);
const manifestsRoute = await import(`${base}/manifests/route`);
const reportRoute = await import(`${base}/report/route`);

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function call(handler: any, method: string, key: string, path: string, params: Record<string, string>, body?: unknown) {
  const res: Response = await handler(
    new Request(`http://localhost/api/website/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
  return { status: res.status, json: await res.json() };
}

describe("Booking API — TRANSPORT scope", () => {
  let enterpriseId: string;
  let userId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let transportKey: string;
  let roomsKey: string;
  let otherEnterpriseKey: string;
  let routeId: string;
  let bookingId: string;
  const p = () => ({ propertyId });
  const path = (rest = "") => `/properties/${propertyId}/transport${rest}`;

  beforeAll(async () => {
    await _resetWebsiteRateLimiter();
    const enterprise = await prisma.enterprise.create({ data: { name: "API Transport", slug: `api-transport-${uniq()}` } });
    enterpriseId = enterprise.id;
    const mk = (name: string, ent = enterpriseId) =>
      prisma.property.create({
        data: { enterpriseId: ent, name, code: `APT-${uniq()}`, legalName: name, defaultCurrency: "USD", timeZone: "Indian/Maldives", checkInTime: "14:00", checkOutTime: "12:00", businessDate: D("2027-05-01") },
      });
    propertyId = (await mk("API Lagoon")).id;
    otherPropertyId = (await mk("API Reef")).id;
    await ensureChart({ propertyId });
    await setPropertySettings(propertyId, { tgstEnabled: true, tgstRate: 17, serviceChargeEnabled: true, serviceChargeRate: 10, greenTaxEnabled: false });

    const userFor = async (ent: string) =>
      (await prisma.user.create({ data: { enterpriseId: ent, email: `api-transport-${uniq()}@test.local`, passwordHash: "x", firstName: "Key", lastName: "Owner", scope: "ENTERPRISE" } })).id;
    userId = await userFor(enterpriseId);
    const mint = async (scopes: string[], ent = enterpriseId, origins: string[] = [], prop: string | null = propertyId) =>
      (await createWebsiteApiKey({ enterpriseId: ent, userId: ent === enterpriseId ? userId : await userFor(ent), name: `k-${uniq()}`, propertyId: prop, allowedOrigins: origins, scopes, expiresAt: null })).key;
    transportKey = await mint(["TRANSPORT"]);
    roomsKey = await mint(["ROOMS"]);
    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `api-transport-o-${uniq()}` } });
    await mk("Other hotel", other.id);
    otherEnterpriseKey = await mint(["TRANSPORT"], other.id, [], null);
  });

  it("a browser key can never hold the TRANSPORT scope", async () => {
    await expect(
      createWebsiteApiKey({ enterpriseId, userId, name: "browser", propertyId, allowedOrigins: ["https://lagoon.example"], scopes: ["ROOMS", "TRANSPORT"], expiresAt: null })
    ).rejects.toThrow(/server-to-server/);
  });

  it("gates in order: property on the key, scope, then the module being on", async () => {
    const foreign = await call(moduleRoute.GET, "GET", otherEnterpriseKey, path(), p());
    expect(foreign.status).toBe(404);
    expect(foreign.json.code).toBe("PROPERTY_NOT_FOUND");
    const noScope = await call(moduleRoute.GET, "GET", roomsKey, path(), p());
    expect(noScope.status).toBe(403);
    expect(noScope.json.code).toBe("SCOPE_NOT_GRANTED");
    // Configuration is reachable before the module is switched on; operations are not.
    const info = await call(moduleRoute.GET, "GET", transportKey, path(), p());
    expect(info.status).toBe(200);
    expect(info.json).toMatchObject({ enabled: false, timeZone: "Indian/Maldives", currency: "USD" });
    const ops = await call(bookingsRoute.GET, "GET", transportKey, path("/bookings"), p());
    expect(ops.status).toBe(409);
    expect(ops.json.code).toBe("MODULE_NOT_ENABLED");
    // Another property of the same enterprise is not on this key either.
    const sibling = await call(moduleRoute.GET, "GET", transportKey, `/properties/${otherPropertyId}/transport`, { propertyId: otherPropertyId });
    expect(sibling.status).toBe(404);
  });

  it("configures the catalogue with the same rules and error shape as the Hub", async () => {
    await prisma.transportSettings.create({ data: { propertyId, enabled: true } });
    const ent = (entity: string) => ({ propertyId, entity });
    const type = await call(entityRoute.POST, "POST", transportKey, path("/config/types"), ent("types"), { code: "spb", name: "Speedboat", mode: "SPEEDBOAT" });
    expect(type.status).toBe(201);
    const bad = await call(entityRoute.POST, "POST", transportKey, path("/config/types"), ent("types"), { code: "x", name: "?", mode: "BALLOON" });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ code: "VALIDATION" });
    expect(bad.json.details).toHaveProperty("mode");
    const mle = await call(entityRoute.POST, "POST", transportKey, path("/config/locations"), ent("locations"), { code: "MLE", name: "Velana", type: "AIRPORT" });
    const home = await call(entityRoute.POST, "POST", transportKey, path("/config/locations"), ent("locations"), { code: "HOME", name: "API Lagoon", type: "RESORT" });
    const route = await call(entityRoute.POST, "POST", transportKey, path("/config/routes"), ent("routes"), {
      code: "MLE-HOME", name: "Airport transfer", originId: mle.json.id, destinationId: home.json.id, transportTypeId: type.json.id, category: "AIRPORT_TRANSFER", direction: "BOTH", departureSlots: ["10:00"],
    });
    expect(route.status).toBe(201);
    routeId = route.json.id;
    const code = await prisma.chargeCode.findFirstOrThrow({ where: { propertyId, postingType: "CHARGE", chargeSubgroup: { chargeGroup: { reportBucket: "TRANSPORT" } } } });
    const rate = await call(entityRoute.POST, "POST", transportKey, path("/config/rates"), ent("rates"), {
      routeId, direction: "BOTH", pricingBasis: "PER_TRIP", price: 100, chargeCodeId: code.id, taxMode: "DEFAULT",
    });
    expect(rate.status).toBe(201);
    const list = await call(entityRoute.GET, "GET", transportKey, path("/config/routes"), ent("routes"));
    expect(list.json.data.map((r: any) => r.code)).toEqual(["MLE-HOME"]);
    const off = await call(entityIdRoute.PATCH, "PATCH", transportKey, path(`/config/types/${type.json.id}`), { propertyId, entity: "types", id: type.json.id }, { isActive: false });
    expect(off.json.isActive).toBe(false);
    await call(entityIdRoute.PATCH, "PATCH", transportKey, path(`/config/types/${type.json.id}`), { propertyId, entity: "types", id: type.json.id }, { isActive: true });
    const inUse = await call(entityIdRoute.DELETE, "DELETE", transportKey, path(`/config/types/${type.json.id}`), { propertyId, entity: "types", id: type.json.id });
    expect(inUse.status).toBe(409);
    expect(inUse.json.code).toBe("IN_USE");
  });

  it("books a transfer, pages the list with a cursor, and builds a departure", async () => {
    const make = (name: string) =>
      call(bookingsRoute.POST, "POST", transportKey, path("/bookings"), p(), {
        direction: "PICKUP", serviceDate: "2027-05-01", guestName: name, guestContact: "+960 7000000", routeId, flightNo: "EK652", flightTime: "09:00",
      });
    const first = await make("Hassan Ali");
    expect(first.status).toBe(201);
    bookingId = first.json.id;
    // PER_TRIP 100 with Service Charge 10% + GST 17% on top (prices include taxes by default → backed out).
    expect(first.json.pricing.amount).toBe(100);
    await make("Mariyam Saeed");
    await make("Ahmed Naseem");

    const page1 = await call(bookingsRoute.GET, "GET", transportKey, path("/bookings?from=2027-05-01&to=2027-05-01&limit=2"), p());
    expect(page1.json.data).toHaveLength(2);
    expect(page1.json.nextCursor).toBeTruthy();
    const page2 = await call(bookingsRoute.GET, "GET", transportKey, path(`/bookings?from=2027-05-01&to=2027-05-01&limit=2&cursor=${page1.json.nextCursor}`), p());
    expect(page2.json.data).toHaveLength(1);
    expect(page2.json.nextCursor).toBeNull();
    const ids = [...page1.json.data, ...page2.json.data].map((b: any) => b.id);
    expect(new Set(ids).size).toBe(3);

    const m = await call(manifestsRoute.POST, "POST", transportKey, path("/manifests"), p(), { routeId, direction: "PICKUP", serviceDate: "2027-05-01", departureTime: "10:00", bookingIds: ids });
    expect(m.status).toBe(201);
    expect(m.json.pax).toBe(3);
    expect(m.json.departureLocal).toEqual({ dateKey: "2027-05-01", time: "10:00" });

    const patched = await call(bookingRoute.PATCH, "PATCH", transportKey, path(`/bookings/${bookingId}`), { propertyId, bookingId }, { flightTime: "09:40" });
    expect(patched.json.attention.map((a: any) => a.code)).toEqual(expect.arrayContaining(["TOO_SOON_AFTER_LANDING", "FLIGHT_CHANGED"]));
  });

  it("posts and waives charges, but never voids one", async () => {
    const posted = await call(billingRoute.POST, "POST", transportKey, path(`/bookings/${bookingId}/billing`), { propertyId, bookingId }, { action: "POST", mode: "FULL" });
    expect(posted.status).toBe(200);
    expect(posted.json.booking.billing.status).toBe("POSTED");
    expect(posted.json.posted.grandTotal).toBe(100);
    const folio = await prisma.folio.findUniqueOrThrow({ where: { id: posted.json.posted.folioId } });
    expect(folio.walkInGuestName).toBe("Hassan Ali");
    const voided = await call(billingRoute.POST, "POST", transportKey, path(`/bookings/${bookingId}/billing`), { propertyId, bookingId }, { action: "VOID", reason: "API test" });
    expect(voided.status).toBe(403);
    // The system user is on the activity log for the posting.
    const log = await prisma.userActivityLog.findFirst({ where: { entityId: bookingId, action: "POST_CHARGE" } });
    expect(log?.userName).toBe("Online Bookings");
  });

  it("serves the daily report's data", async () => {
    const r = await call(reportRoute.GET, "GET", transportKey, path("/report?from=2027-05-01"), p());
    expect(r.status).toBe(200);
    expect(r.json.title).toBe("Daily Transportation Report");
    expect(JSON.stringify(r.json.groups)).toMatch(/Hassan Ali/);
  });
});
