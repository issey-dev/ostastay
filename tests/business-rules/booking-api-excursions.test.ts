import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// Phase 2 of BOOKING_API_ADDONS_PLAN.md — the public Excursions endpoints, driven through
// the real route handlers with real keys:
//  catalogue, departures (live seats incl. holds), quote == what the booking posts,
//  hold -> pay -> book, idempotency, price change, instant refusal, server-only writes,
//  paid bookings settled on the bill, guest lookup and self-cancel, desk changes seen.

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { customChargeCode } = await import("../helpers/charge-codes");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const catalogueRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/route");
const departuresRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/departures/route");
const quoteRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/quote/route");
const holdsRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/holds/route");
const bookingsRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/bookings/route");
const lookupRoute = await import("@/app/api/website/v1/activity-bookings/[reference]/route");
const { listOnlineBookings } = await import("@/lib/website-api/online-bookings");
import { setPropertySettings } from "../helpers/property-settings";
const cancelRoute = await import("@/app/api/website/v1/activity-bookings/[reference]/cancel/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const day = (offset: number) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
};
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const BASE = "http://localhost/api/website/v1";

function req(path: string, key: string, opts: { body?: unknown; idem?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  return new Request(`${BASE}${path}`, {
    method: opts.body !== undefined ? "POST" : "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
const p = <P,>(x: P) => ({ params: Promise.resolve(x) });
const idem = () => `idem-${uniq()}`;
const guest = (email = `guest-${uniq()}@example.com`) => ({ firstName: "Ada", lastName: "Lovelace", email, phone: "+000 000 0000" });

describe("Booking API — Excursions (Phase 2)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let typeId: string;
  let hiddenTypeId: string;
  let paymentMethodId: string;
  let serverKey = "";
  let otherServerKey = "";
  let browserKey = "";
  let roomsOnlyKey = "";

  // Each departure gets the next minute of the day — a random time (as this used to pick)
  // could repeat on the same type and day and trip the unique (type, date, time) constraint.
  let departureSeq = 0
  const nextDepartureTime = () => {
    const minutes = 8 * 60 + departureSeq++
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
  }
  const makeDeparture = (opts: { offset?: number; capacity?: number; min?: number | null; type?: string } = {}) =>
    prisma.excursionDeparture.create({
      data: {
        excursionTypeId: opts.type ?? typeId,
        departureDate: day(opts.offset ?? 5),
        departureTime: nextDepartureTime(),
        capacity: opts.capacity ?? 4,
        minCapacity: opts.min === undefined ? 2 : opts.min,
        meetingPoint: "Main Jetty",
      },
    });

  const book = (propId: string, key: string, body: Record<string, unknown>, idemKey = idem()) =>
    bookingsRoute.POST(req(`/properties/${propId}/excursions/bookings`, key, { body, idem: idemKey }), p({ propertyId: propId }));

  const unpaid = { status: "UNPAID" };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "Exc API", slug: `test-excapi-${uniq()}`, type: "STANDARD" } })).id;
    propertyId = (
      await prisma.property.create({
        data: {
          enterpriseId, name: "Coral Bay Resort", code: `CBR-${uniq()}`, legalName: "Coral Bay LLC",
          defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        },
      })
    ).id;
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `excapi-${uniq()}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "B",
        roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "EXCURSIONS", enabled: true } });

    // A code that generates a 10% service line: the quote must include it, and equal what
    // the booking posts.
    const code = await customChargeCode({ propertyId }, { code: "CBEXC", description: "Excursion" });
    const svc = await customChargeCode({ propertyId }, { code: "CBSVC", description: "Service" });
    await prisma.chargeCodeGenerate.create({
      data: { enterpriseId, propertyId, generatorCodeId: code.id, generatedCodeId: svc.id, method: "PERCENT", value: 10 },
    });
    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Tours", code: "CBTR", outletType: "EXCURSION" } });
    await setPropertySettings(propertyId, { tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false, excursionOutletId: outlet.id });
    const cardCode = await customChargeCode({ propertyId }, { code: "CBPAY", description: "Online card", postingType: "PAYMENT" });
    paymentMethodId = (await prisma.paymentMethod.create({ data: { enterpriseId, propertyId, name: "Online card", type: "CARD", chargeCodeId: cardCode.id } })).id;
    await prisma.activityOnlineSettings.create({
      data: { propertyId, module: "EXCURSIONS", enabled: true, holdMinutes: 10, leadHours: 2, maxPartySize: 6, onlinePaymentMethodId: paymentMethodId, deskRemark: "Check ID at the jetty" },
    });

    typeId = (
      await prisma.excursionType.create({
        data: {
          propertyId, code: "SNK", name: "Snorkel Safari", chargeCodeId: code.id, cutoffHours: 24, publishOnline: true,
          publicDescription: "Reef snorkelling", imageUrls: ["https://cdn.example.com/snorkel.jpg"],
          rates: { create: [{ adultPrice: 100, childPrice: 50, infantPrice: 0, effectiveFrom: new Date(2020, 0, 1) }] },
        },
      })
    ).id;
    hiddenTypeId = (
      await prisma.excursionType.create({
        data: {
          propertyId, code: "HID", name: "Not online", chargeCodeId: code.id, publishOnline: false,
          rates: { create: [{ adultPrice: 10, childPrice: 5, infantPrice: 0, effectiveFrom: new Date(2020, 0, 1) }] },
        },
      })
    ).id;

    const mint = async (scopes: string[], origins: string[] = []) =>
      (await createWebsiteApiKey({ enterpriseId, userId: admin.id, name: `k-${uniq()}`, propertyId: propertyId, allowedOrigins: origins, scopes, expiresAt: null })).key;
    serverKey = await mint(["ROOMS", "EXCURSIONS"]);
    otherServerKey = await mint(["EXCURSIONS"]);
    browserKey = await mint(["EXCURSIONS"], ["https://www.example.com"]);
    roomsOnlyKey = await mint(["ROOMS"]);
  });

  beforeEach(() => _resetWebsiteRateLimiter());

  // -------------------------------------------------------------------------------------
  it("catalogue: only published excursions, with prices and the online booking rules", async () => {
    const res = await catalogueRoute.GET(req(`/properties/${propertyId}/excursions`, serverKey), p({ propertyId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.excursions.map((e: { id: string }) => e.id)).toEqual([typeId]);
    expect(body.excursions[0]).toMatchObject({ name: "Snorkel Safari", description: "Reef snorkelling", prices: { adult: 100, child: 50, infant: 0 }, freeCancellationHours: 24 });
    expect(body.booking).toMatchObject({ enabled: true, holdMinutes: 10, leadHours: 2, maxPartySize: 6, paidOnlineAccepted: true });

    const noScope = await catalogueRoute.GET(req(`/properties/${propertyId}/excursions`, roomsOnlyKey), p({ propertyId }));
    expect(noScope.status).toBe(403);
    expect((await noScope.json()).code).toBe("SCOPE_NOT_GRANTED");
  });

  it("departures: live seats, guaranteed flag, unpublished excursions hidden, window capped", async () => {
    const dep = await makeDeparture({ offset: 6, capacity: 4, min: 2 });
    await makeDeparture({ offset: 6, type: hiddenTypeId });
    const res = await departuresRoute.GET(
      req(`/properties/${propertyId}/excursions/departures?from=${dayStr(day(6))}&to=${dayStr(day(6))}`, serverKey),
      p({ propertyId })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.departures.find((d: { id: string }) => d.id === dep.id);
    expect(row).toMatchObject({ seatsLeft: 4, capacity: 4, guaranteed: false, bookable: true, meetingPoint: "Main Jetty" });
    expect(body.departures.every((d: { excursionId: string }) => d.excursionId === typeId)).toBe(true);

    const tooWide = await departuresRoute.GET(
      req(`/properties/${propertyId}/excursions/departures?from=${dayStr(day(1))}&to=${dayStr(day(80))}`, serverKey),
      p({ propertyId })
    );
    expect(tooWide.status).toBe(400);
  });

  it("the quote is exactly what the booking posts; a PAID booking settles the bill to zero", async () => {
    const dep = await makeDeparture();
    const q = await quoteRoute.POST(
      req(`/properties/${propertyId}/excursions/quote`, serverKey, { body: { departureId: dep.id, adults: 2, children: 1 } }),
      p({ propertyId })
    );
    expect(q.status).toBe(200);
    const { quote } = await q.json();
    expect(quote.available).toBe(true);
    expect(quote.totals.base).toBeCloseTo(250, 2);
    expect(quote.totals.grandTotal).toBeGreaterThan(250); // + the generated 10% service line
    expect(await prisma.folio.count({ where: { walkInGuestName: "Quote" } })).toBe(0); // rolled back

    const res = await book(propertyId, serverKey, {
      departureId: dep.id, adults: 2, children: 1, guest: guest(), expectedTotal: quote.totals.grandTotal,
      payment: { status: "PAID", provider: "Stripe", reference: "pi_123", amount: quote.totals.grandTotal, currency: "USD" },
    });
    expect(res.status).toBe(201);
    const { booking } = await res.json();
    expect(booking.reference).toMatch(/^EXC-[0-9A-Z]{8}$/);
    expect(booking.status).toBe("CONFIRMED");

    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference }, include: { excursionBooking: true } });
    const lines = await prisma.folioLineItem.findMany({ where: { folioId: record.excursionBooking!.folioId, isVoid: false } });
    const charged = lines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(charged).toBeCloseTo(quote.totals.grandTotal, 2);
    const payments = await prisma.payment.findMany({ where: { folioId: record.excursionBooking!.folioId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBeCloseTo(quote.totals.grandTotal, 2);
    expect(payments[0].paymentMethodId).toBe(paymentMethodId);
    expect(record.excursionBooking!.source).toBe("API");
    expect(record.excursionBooking!.notes).toContain("Check ID at the jetty");
    expect(record.excursionBooking!.notes).toContain("pi_123");
    expect(record.amountMismatch).toBe(false);
  });

  it("hold → book: held seats are kept from everyone else, and a hold converts once", async () => {
    const dep = await makeDeparture({ capacity: 4 });
    const h = await holdsRoute.POST(
      req(`/properties/${propertyId}/excursions/holds`, serverKey, { body: { departureId: dep.id, adults: 3 } }),
      p({ propertyId })
    );
    expect(h.status).toBe(201);
    const { hold } = await h.json();
    expect(new Date(hold.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Another website can't take the held seats…
    const other = await book(propertyId, otherServerKey, { departureId: dep.id, adults: 2, guest: guest(), payment: unpaid });
    expect(other.status).toBe(409);
    expect((await other.json()).code).toBe("SOLD_OUT");
    // …and a failed attempt is kept for the audit trail.
    expect(await prisma.apiActivityBooking.count({ where: { excursionDepartureId: dep.id, status: "FAILED" } })).toBe(1);

    const ok = await book(propertyId, serverKey, { holdId: hold.holdId, guest: guest(), payment: unpaid });
    expect(ok.status).toBe(201);
    const again = await book(propertyId, serverKey, { holdId: hold.holdId, guest: guest(), payment: unpaid });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("HOLD_USED");
    expect(await prisma.excursionBooking.count({ where: { departureId: dep.id, status: "CONFIRMED" } })).toBe(1);
  });

  it("an expired hold frees its seats and can no longer be booked", async () => {
    const dep = await makeDeparture({ capacity: 2 });
    const { hold } = await (
      await holdsRoute.POST(req(`/properties/${propertyId}/excursions/holds`, serverKey, { body: { departureId: dep.id, adults: 2 } }), p({ propertyId }))
    ).json();
    await prisma.apiActivityBooking.update({ where: { id: hold.holdId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    const expired = await book(propertyId, serverKey, { holdId: hold.holdId, guest: guest(), payment: unpaid });
    expect(expired.status).toBe(409);
    expect((await expired.json()).code).toBe("HOLD_EXPIRED");
    const direct = await book(propertyId, otherServerKey, { departureId: dep.id, adults: 2, guest: guest(), payment: unpaid });
    expect(direct.status).toBe(201);
  });

  it("idempotency: the same key returns the same booking, never a second one", async () => {
    const dep = await makeDeparture();
    const key = idem();
    const first = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid }, key);
    const second = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = (await first.json()).booking;
    const b = (await second.json()).booking;
    expect(b.reference).toBe(a.reference);
    expect(b.replayed).toBe(true);
    expect(await prisma.excursionBooking.count({ where: { departureId: dep.id } })).toBe(1);

    const missing = await bookingsRoute.POST(
      req(`/properties/${propertyId}/excursions/bookings`, serverKey, { body: { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid } }),
      p({ propertyId })
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("refuses a changed price, a browser key, too big a party, and a closed booking window", async () => {
    const dep = await makeDeparture();
    const price = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid, expectedTotal: 1 });
    expect(price.status).toBe(409);
    expect((await price.json()).code).toBe("PRICE_CHANGED");

    const browser = await book(propertyId, browserKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid });
    expect(browser.status).toBe(403);
    expect((await browser.json()).code).toBe("SERVER_KEY_REQUIRED");
    // The same browser key may still read.
    expect((await catalogueRoute.GET(req(`/properties/${propertyId}/excursions`, browserKey), p({ propertyId }))).status).toBe(200);

    const big = await book(propertyId, serverKey, { departureId: dep.id, adults: 7, guest: guest(), payment: unpaid });
    expect(big.status).toBe(400);
    expect((await big.json()).code).toBe("PARTY_TOO_LARGE");

    await prisma.activityOnlineSettings.update({ where: { propertyId_module: { propertyId, module: "EXCURSIONS" } }, data: { leadHours: 168 } });
    try {
      const late = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid });
      expect(late.status).toBe(409);
      expect((await late.json()).code).toBe("BOOKING_CUTOFF");
    } finally {
      await prisma.activityOnlineSettings.update({ where: { propertyId_module: { propertyId, module: "EXCURSIONS" } }, data: { leadHours: 2 } });
    }
  });

  it("PAID needs a payment method set up; a paid amount that doesn't match is booked and flagged", async () => {
    const dep = await makeDeparture();
    await prisma.activityOnlineSettings.update({ where: { propertyId_module: { propertyId, module: "EXCURSIONS" } }, data: { onlinePaymentMethodId: null } });
    try {
      const res = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: { status: "PAID", amount: 110 } });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("PAYMENT_NOT_CONFIGURED");
    } finally {
      await prisma.activityOnlineSettings.update({ where: { propertyId_module: { propertyId, module: "EXCURSIONS" } }, data: { onlinePaymentMethodId: paymentMethodId } });
    }
    const odd = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: { status: "PAID", amount: 1, currency: "USD" } });
    expect(odd.status).toBe(201);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: (await odd.json()).booking.reference }, include: { excursionBooking: true } });
    expect(record.amountMismatch).toBe(true);
    expect(record.excursionBooking!.notes).toContain("CHECK PAYMENT");
  });

  it("lookup needs the matching email and the booking's own key", async () => {
    const dep = await makeDeparture();
    const email = `Look-${uniq()}@Example.com`;
    const { booking } = await (await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(email), payment: unpaid })).json();

    const ok = await lookupRoute.GET(req(`/activity-bookings/${booking.reference}?email=${encodeURIComponent(email.toUpperCase())}`, serverKey), p({ reference: booking.reference }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).booking).toMatchObject({ reference: booking.reference, status: "CONFIRMED", departure: { id: dep.id } });

    const wrongEmail = await lookupRoute.GET(req(`/activity-bookings/${booking.reference}?email=x@example.com`, serverKey), p({ reference: booking.reference }));
    expect(wrongEmail.status).toBe(404);
    const otherKey = await lookupRoute.GET(req(`/activity-bookings/${booking.reference}?email=${encodeURIComponent(email)}`, otherServerKey), p({ reference: booking.reference }));
    expect(otherKey.status).toBe(404);
  });

  it("guest self-cancel: voids the charge, says a refund is due when paid, and only before the deadline", async () => {
    const dep = await makeDeparture();
    const email = `cancel-${uniq()}@example.com`;
    const q = (await (await quoteRoute.POST(req(`/properties/${propertyId}/excursions/quote`, serverKey, { body: { departureId: dep.id, adults: 1 } }), p({ propertyId }))).json()).quote;
    const { booking } = await (
      await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(email), payment: { status: "PAID", amount: q.totals.grandTotal } })
    ).json();

    const cancel = () =>
      cancelRoute.POST(req(`/activity-bookings/${booking.reference}/cancel`, serverKey, { body: { email, reason: "Change of plans" } }), p({ reference: booking.reference }));
    const res = await cancel();
    expect(res.status).toBe(200);
    const body = (await res.json()).booking;
    expect(body.status).toBe("CANCELLED");
    expect(body.cancellation.refundRequired).toBe(true);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference }, include: { excursionBooking: true } });
    expect(await prisma.folioLineItem.count({ where: { folioId: record.excursionBooking!.folioId, isVoid: false } })).toBe(0);

    const twice = await cancel();
    expect(twice.status).toBe(409);
    expect((await twice.json()).code).toBe("ALREADY_CANCELLED");

    // Past the deadline the guest must call the property.
    const lateDep = await makeDeparture();
    const lateEmail = `late-${uniq()}@example.com`;
    const late = (await (await book(propertyId, serverKey, { departureId: lateDep.id, adults: 1, guest: guest(lateEmail), payment: unpaid })).json()).booking;
    await prisma.excursionType.update({ where: { id: typeId }, data: { cutoffHours: 1000 } });
    try {
      const refused = await cancelRoute.POST(
        req(`/activity-bookings/${late.reference}/cancel`, serverKey, { body: { email: lateEmail } }),
        p({ reference: late.reference })
      );
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe("CANCEL_CUTOFF_PASSED");
    } finally {
      await prisma.excursionType.update({ where: { id: typeId }, data: { cutoffHours: 24 } });
    }
  });

  it("what the desk does is what the website sees; switching the add-on off stops bookings", async () => {
    const dep = await makeDeparture();
    const email = `desk-${uniq()}@example.com`;
    const { booking } = await (await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(email), payment: unpaid })).json();
    await prisma.excursionBooking.updateMany({ where: { departureId: dep.id }, data: { status: "CANCELLED", cancellationReason: "Weather" } });
    const seen = await lookupRoute.GET(req(`/activity-bookings/${booking.reference}?email=${email}`, serverKey), p({ reference: booking.reference }));
    expect((await seen.json()).booking.status).toBe("CANCELLED");

    await prisma.enterpriseAddonAccess.update({ where: { enterpriseId_module: { enterpriseId, module: "EXCURSIONS" } }, data: { enabled: false } });
    try {
      const off = await book(propertyId, serverKey, { departureId: (await makeDeparture()).id, adults: 1, guest: guest(), payment: unpaid });
      expect(off.status).toBe(409);
      expect((await off.json()).code).toBe("MODULE_NOT_ENABLED");
    } finally {
      await prisma.enterpriseAddonAccess.update({ where: { enterpriseId_module: { enterpriseId, module: "EXCURSIONS" } }, data: { enabled: true } });
    }
  });

  it("the Hub's online bookings list shows confirmed, failed and expired attempts with their state", async () => {
    const dep = await makeDeparture({ capacity: 1 });
    const ok = (await (await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid })).json()).booking;
    const failed = await book(propertyId, serverKey, { departureId: dep.id, adults: 1, guest: guest(), payment: unpaid });
    expect(failed.status).toBe(409);
    const other = await makeDeparture();
    const { hold } = await (
      await holdsRoute.POST(req(`/properties/${propertyId}/excursions/holds`, serverKey, { body: { departureId: other.id, adults: 1 } }), p({ propertyId }))
    ).json();
    await prisma.apiActivityBooking.update({ where: { id: hold.holdId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    const rows = await listOnlineBookings(enterpriseId, { module: "EXCURSIONS" });
    const confirmed = rows.find((r) => r.reference === ok.reference);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", module: "EXCURSIONS", payment: "Pay at property" });
    expect(rows.some((r) => r.status === "FAILED" && r.problem?.startsWith("SOLD_OUT"))).toBe(true);
    expect(rows.find((r) => r.id === hold.holdId)?.status).toBe("EXPIRED");
    const onlyFailed = await listOnlineBookings(enterpriseId, { status: "FAILED" });
    expect(onlyFailed.every((r) => r.status === "FAILED")).toBe(true);
  });
});
