import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { createHmac } from "crypto";
import type { AddressInfo } from "net";
import bcrypt from "bcryptjs";

// Phase 5 of BOOKING_API_ADDONS_PLAN.md — signed webhooks, against a real local receiver:
// the booking the website makes and the changes the desk makes afterwards are delivered,
// signed; a failing endpoint is retried on backoff; unsafe URLs are refused; bookings made
// at the desk (no website behind them) send nothing.

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { customChargeCode } = await import("../helpers/charge-codes");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { systemActorContext } = await import("@/lib/system-actor");
const { cancelExcursionBooking, createExcursionBooking } = await import("@/lib/excursion-booking");
import { setPropertySettings } from "../helpers/property-settings";
const webhooks = await import("@/lib/website-api/webhooks");
const bookingsRoute = await import("@/app/api/website/v1/properties/[propertyId]/excursions/bookings/route");

type Received = { headers: Record<string, string | string[] | undefined>; raw: string; body: { id: string; event: string; data: { booking?: { reference: string; status: string } } } };

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const day = (offset: number) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
};
// Generous: the first attempt is fire-and-forget after the booking commits, and a full
// suite run on a loaded machine can take seconds to get to it.
const waitFor = async <T,>(fn: () => T | undefined, ms = 15_000): Promise<T> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for a webhook");
};

describe("Booking API — webhooks (Phase 5)", () => {
  let server: Server;
  let base = "";
  let failNext = 0;
  const received: Received[] = [];
  let enterpriseId: string;
  let propertyId: string;
  let typeId: string;
  let keyId: string;
  let key = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (failNext > 0) {
          failNext -= 1;
          res.writeHead(500).end();
          return;
        }
        received.push({ headers: req.headers, raw, body: JSON.parse(raw) });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "Hooks", slug: `test-hooks-${uniq()}`, type: "STANDARD" } })).id;
    propertyId = (
      await prisma.property.create({
        data: { enterpriseId, name: "Coral Bay", code: `CBW-${uniq()}`, legalName: "Coral Bay LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      })
    ).id;
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `hooks-${uniq()}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "B",
        roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "EXCURSIONS", enabled: true } });
    const code = await customChargeCode({ propertyId }, { code: "CBWEXC", description: "Excursion" });
    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Tours", code: "CBWT", outletType: "EXCURSION" } });
    await setPropertySettings(propertyId, { tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false, excursionOutletId: outlet.id });
    await prisma.activityOnlineSettings.create({ data: { propertyId, module: "EXCURSIONS", enabled: true, maxPartySize: 6 } });
    typeId = (
      await prisma.excursionType.create({
        data: { propertyId, code: "HK", name: "Sunset Cruise", chargeCodeId: code.id, publishOnline: true, rates: { create: [{ adultPrice: 80, childPrice: 40, infantPrice: 0, effectiveFrom: new Date(2020, 0, 1) }] } },
      })
    ).id;
    const minted = await createWebsiteApiKey({ enterpriseId, userId: admin.id, name: "hooks-site", propertyIds: [propertyId], allowedOrigins: [], scopes: ["EXCURSIONS"], expiresAt: null });
    key = minted.key;
    keyId = minted.row.id;
    _resetWebsiteRateLimiter();
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  let slot = 0;
  const departure = () => {
    slot += 1;
    return prisma.excursionDeparture.create({
      data: { excursionTypeId: typeId, departureDate: day(6), departureTime: `${String(6 + slot).padStart(2, "0")}:00`, capacity: 20 },
    });
  };

  const bookOnline = async (departureId: string) => {
    const res = await bookingsRoute.POST(
      new Request(`http://localhost/api/website/v1/properties/${propertyId}/excursions/bookings`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": `idem-${uniq()}` },
        body: JSON.stringify({ departureId, adults: 1, guest: { firstName: "Ada", email: `ada-${uniq()}@example.com` }, payment: { status: "UNPAID" } }),
      }),
      { params: Promise.resolve({ propertyId }) }
    );
    expect(res.status).toBe(201);
    return (await res.json()).booking as { reference: string };
  };

  it("refuses unsafe webhook URLs", async () => {
    await expect(webhooks.assertSafeWebhookUrl("http://example.com/hook")).rejects.toThrow(/https/);
    await expect(webhooks.assertSafeWebhookUrl("https://10.0.0.5/hook")).rejects.toThrow(/public/);
    await expect(webhooks.assertSafeWebhookUrl("https://169.254.169.254/latest")).rejects.toThrow(/public/);
    await expect(webhooks.assertSafeWebhookUrl("https://user:pw@example.com/")).rejects.toThrow(/credentials/);
    await expect(webhooks.assertSafeWebhookUrl(`${base}/hook`)).resolves.toBeTruthy(); // local dev only
  });

  it("delivers the website's booking and the desk's later cancellation, signed", async () => {
    const { secret } = await webhooks.createWebhookEndpoint({ enterpriseId, keyId, url: `${base}/hook`, events: ["booking.confirmed", "booking.cancelled"] });
    expect(secret).toMatch(/^whsec_/);
    // Only a prefix is ever shown again.
    const stored = await prisma.apiWebhookEndpoint.findFirstOrThrow({ where: { keyId } });
    expect(stored.secretPrefix).toBe(secret.slice(0, 12));

    const dep = await departure();
    const booking = await bookOnline(dep.id);
    const confirmed = await waitFor(() => received.find((r) => r.body.event === "booking.confirmed" && r.body.data.booking?.reference === booking.reference));
    const ts = String(confirmed.headers["uppsolut-webhook-timestamp"]);
    const expected = `v1=${createHmac("sha256", secret).update(`${ts}.${confirmed.raw}`).digest("hex")}`;
    expect(confirmed.headers["uppsolut-webhook-signature"]).toBe(expected);
    expect(confirmed.headers["uppsolut-webhook-id"]).toBe(confirmed.body.id);

    // The desk cancels (e.g. weather) — the website hears about it.
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference } });
    await cancelExcursionBooking(await systemActorContext(enterpriseId), record.excursionBookingId!, { reason: "Weather" }, { canOverride: true, canVoid: true });
    const cancelled = await waitFor(() => received.find((r) => r.body.event === "booking.cancelled" && r.body.data.booking?.reference === booking.reference));
    expect(cancelled.body.data.booking!.status).toBe("CANCELLED");
  }, 60_000);

  it("a booking made at the desk sends nothing", async () => {
    const before = await prisma.apiWebhookDelivery.count({ where: { enterpriseId } });
    const dep = await departure();
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 1, walkInGuestName: "Desk guest" } });
    const booking = await createExcursionBooking(await systemActorContext(enterpriseId), {
      departureId: dep.id, guest: { kind: "WALK_IN_FOLIO", folioId: folio.id }, adultCount: 1, childCount: 0, infantCount: 0,
    });
    await cancelExcursionBooking(await systemActorContext(enterpriseId), booking.id, { reason: "Test" }, { canOverride: true, canVoid: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.apiWebhookDelivery.count({ where: { enterpriseId } })).toBe(before);
  });

  it("retries a failing endpoint on backoff, and the job delivers it later", async () => {
    failNext = 1;
    const endpoint = await prisma.apiWebhookEndpoint.findFirstOrThrow({ where: { keyId } });
    const test = await webhooks.sendTestWebhook(enterpriseId, endpoint.id);
    expect(test.outcome).toBe("RETRY");
    expect(test.statusCode).toBe(500);
    const pending = await prisma.apiWebhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id, event: "ping" }, orderBy: { createdAt: "desc" } });
    expect(pending).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.apiWebhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).failureCount).toBe(1);

    // Not due yet: the job leaves it alone.
    await webhooks.processDueWebhooks(enterpriseId);
    expect((await prisma.apiWebhookDelivery.findUniqueOrThrow({ where: { id: pending.id } })).attempts).toBe(1);
    await prisma.apiWebhookDelivery.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const run = await webhooks.processDueWebhooks(enterpriseId);
    expect(run.DELIVERED).toBeGreaterThanOrEqual(1);
    const done = await prisma.apiWebhookDelivery.findUniqueOrThrow({ where: { id: pending.id } });
    expect(done).toMatchObject({ status: "DELIVERED", attempts: 2 });
    expect((await prisma.apiWebhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).failureCount).toBe(0);
  });

  it("a switched-off endpoint gets nothing; limits and validation hold", async () => {
    const endpoint = await prisma.apiWebhookEndpoint.findFirstOrThrow({ where: { keyId } });
    await webhooks.updateWebhookEndpoint({ enterpriseId, id: endpoint.id, status: "DISABLED" });
    const before = received.length;
    await bookOnline((await departure()).id);
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBe(before);

    await expect(webhooks.createWebhookEndpoint({ enterpriseId, keyId, url: `${base}/x`, events: ["booking.exploded"] })).rejects.toThrow(/Unknown event/);
    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `test-hooks-o-${uniq()}`, type: "STANDARD" } });
    await expect(webhooks.listWebhookEndpoints(other.id, keyId)).rejects.toThrow(/not found/);
  });
});
