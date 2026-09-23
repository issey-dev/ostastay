import { createHmac, randomBytes } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { activityBookingResult } from "@/lib/website-api/activity-bookings";

// Signed webhooks for the Booking API (BOOKING_API_ADDONS_PLAN.md Phase 5, B-8).
//
// A brand website that booked an excursion or spa treatment learns when the PROPERTY
// changes it — a departure cancelled for weather, a guest moved to another boat, a
// no-show, a completed treatment — without polling. Each API key may register endpoints;
// only bookings made with that key are ever sent to them.
//
// Delivery contract (documented for developers in the docs portal):
//  - POST, JSON body { id, event, createdAt, data: { booking } } — `booking` is the same
//    object GET /activity-bookings/{reference} returns.
//  - Headers: Uppsolut-Webhook-Id, Uppsolut-Webhook-Event, Uppsolut-Webhook-Timestamp
//    (unix seconds), Uppsolut-Webhook-Signature: v1=<hex HMAC-SHA256 of
//    `${timestamp}.${rawBody}` with the endpoint secret>.
//  - Any 2xx is success. Anything else, a timeout (10 s) or a redirect is retried with
//    backoff for about a day, then marked FAILED. Delivery is at-least-once: dedupe on id.
//
// Safety: https only (plain http to localhost is allowed outside production, for local
// development), no redirects followed, and the host must not resolve to a private,
// loopback or link-local address — checked when the endpoint is saved AND again at every
// delivery, so a DNS change cannot turn a public hostname into an internal one (SSRF).

export const WEBHOOK_EVENTS = [
  "booking.confirmed",
  "booking.cancelled",
  "booking.moved",
  "booking.completed",
  "booking.no_show",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

export const MAX_ENDPOINTS_PER_KEY = 5;
const TIMEOUT_MS = 10_000;
// Minutes before attempt n+1 (index = attempts made so far). ~1 day in total.
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;

// ---------------------------------------------------------------------------------------
// URL safety

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return false;
}

const isProduction = () => process.env.NODE_ENV === "production";

/** Throws ForbiddenError (with a reason an administrator can act on) for an unsafe URL. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ForbiddenError("Enter a full URL, e.g. https://www.example.com/webhooks/uppsolut");
  }
  if (url.username || url.password) throw new ForbiddenError("The webhook URL must not contain credentials");
  const localDev = !isProduction() && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(localDev && url.protocol === "http:")) {
    throw new ForbiddenError("The webhook URL must use https");
  }
  if (localDev) return url;
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true }).catch(() => {
        throw new ForbiddenError(`"${url.hostname}" does not resolve`);
      });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ForbiddenError("The webhook URL must point to a public internet address");
  }
  return url;
}

// ---------------------------------------------------------------------------------------
// Signing

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function newSecret() {
  const secret = `whsec_${randomBytes(32).toString("hex")}`;
  return { secret, secretEncrypted: encryptSecret(secret)!, secretPrefix: secret.slice(0, 12) };
}

// ---------------------------------------------------------------------------------------
// Emitting

/** The Booking API record behind an excursion booking, following desk moves backwards. */
async function recordForExcursionBooking(bookingId: string) {
  let id = bookingId;
  for (let hops = 0; hops < 10; hops++) {
    const record = await prisma.apiActivityBooking.findUnique({ where: { excursionBookingId: id }, select: { id: true, keyId: true, enterpriseId: true } });
    if (record) return record;
    const previous = await prisma.excursionBooking.findUnique({ where: { movedToBookingId: id }, select: { id: true } });
    if (!previous) return null;
    id = previous.id;
  }
  return null;
}

/**
 * Queue `event` for every endpoint of the key that made this booking, and try to deliver
 * at once. A booking made at the desk has no Booking API record and emits nothing. Never
 * throws — a webhook problem must not undo or fail the desk action that caused it.
 */
export async function emitBookingEvent(
  event: Exclude<WebhookEvent, "ping">,
  source: { excursionBookingId: string } | { spaAppointmentId: string }
): Promise<void> {
  try {
    const record =
      "excursionBookingId" in source
        ? await recordForExcursionBooking(source.excursionBookingId)
        : await prisma.apiActivityBooking.findUnique({ where: { spaAppointmentId: source.spaAppointmentId }, select: { id: true, keyId: true, enterpriseId: true } });
    if (!record) return;
    const endpoints = await prisma.apiWebhookEndpoint.findMany({
      where: { keyId: record.keyId, status: "ACTIVE", events: { has: event } },
      select: { id: true },
    });
    if (endpoints.length === 0) return;
    const booking = await activityBookingResult(record.id, { replayed: false });
    const ids: string[] = [];
    for (const e of endpoints) {
      const delivery = await prisma.apiWebhookDelivery.create({
        data: { enterpriseId: record.enterpriseId, endpointId: e.id, event, payload: {} },
      });
      await prisma.apiWebhookDelivery.update({
        where: { id: delivery.id },
        data: { payload: { id: delivery.id, event, createdAt: delivery.createdAt.toISOString(), data: { booking } } },
      });
      ids.push(delivery.id);
    }
    // First attempt now, off the request's critical path; the job retries whatever fails.
    void Promise.allSettled(ids.map((id) => attemptDelivery(id)));
  } catch (e) {
    console.error("[booking-api webhooks] emit failed", e);
  }
}

// ---------------------------------------------------------------------------------------
// Delivering

/**
 * One delivery attempt. Claims the row with a short lease first, so two workers (or the
 * immediate attempt racing the job) never send the same attempt twice.
 */
export async function attemptDelivery(deliveryId: string): Promise<"DELIVERED" | "RETRY" | "FAILED" | "SKIPPED"> {
  const now = new Date();
  const claimed = await prisma.apiWebhookDelivery.updateMany({
    where: { id: deliveryId, status: "PENDING", nextAttemptAt: { lte: now } },
    data: { nextAttemptAt: new Date(now.getTime() + 2 * 60_000) },
  });
  if (claimed.count === 0) return "SKIPPED";
  const delivery = await prisma.apiWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { endpoint: true } });
  if (delivery.endpoint.status !== "ACTIVE") {
    await prisma.apiWebhookDelivery.update({ where: { id: deliveryId }, data: { status: "FAILED", lastError: "Endpoint disabled" } });
    return "FAILED";
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    await assertSafeWebhookUrl(delivery.endpoint.url);
    const secret = decryptSecret(delivery.endpoint.secretEncrypted)!;
    const res = await fetch(delivery.endpoint.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "Uppsolut-Stay-Webhooks/1",
        "uppsolut-webhook-id": delivery.id,
        "uppsolut-webhook-event": delivery.event,
        "uppsolut-webhook-timestamp": String(timestamp),
        "uppsolut-webhook-signature": signWebhook(secret, timestamp, body),
      },
      body,
    });
    statusCode = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : "Delivery failed";
  }

  const attempts = delivery.attempts + 1;
  if (!error) {
    await prisma.$transaction([
      prisma.apiWebhookDelivery.update({
        where: { id: deliveryId },
        data: { status: "DELIVERED", attempts, lastStatusCode: statusCode, lastError: null, deliveredAt: new Date() },
      }),
      prisma.apiWebhookEndpoint.update({ where: { id: delivery.endpointId }, data: { failureCount: 0, lastDeliveryAt: new Date() } }),
    ]);
    return "DELIVERED";
  }
  const giveUp = attempts >= MAX_ATTEMPTS;
  await prisma.$transaction([
    prisma.apiWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: giveUp ? "FAILED" : "PENDING",
        attempts,
        lastStatusCode: statusCode,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + (BACKOFF_MINUTES[attempts - 1] ?? 60) * 60_000),
      },
    }),
    prisma.apiWebhookEndpoint.update({ where: { id: delivery.endpointId }, data: { failureCount: { increment: 1 } } }),
  ]);
  return giveUp ? "FAILED" : "RETRY";
}

/** The job's work for one enterprise: every delivery that is due. */
export async function processDueWebhooks(enterpriseId: string, limit = 200) {
  const due = await prisma.apiWebhookDelivery.findMany({
    where: { enterpriseId, status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const tally = { DELIVERED: 0, RETRY: 0, FAILED: 0, SKIPPED: 0 };
  for (const d of due) tally[await attemptDelivery(d.id)] += 1;
  return { processed: due.length, ...tally };
}

// ---------------------------------------------------------------------------------------
// Hub management

export type WebhookEndpointRow = {
  id: string;
  keyId: string;
  url: string;
  secretPrefix: string;
  events: string[];
  status: string;
  failureCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
};

function shape(e: Awaited<ReturnType<typeof prisma.apiWebhookEndpoint.findFirstOrThrow>>): WebhookEndpointRow {
  return {
    id: e.id,
    keyId: e.keyId,
    url: e.url,
    secretPrefix: e.secretPrefix,
    events: e.events,
    status: e.status,
    failureCount: e.failureCount,
    lastDeliveryAt: e.lastDeliveryAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

function normalizeEvents(events: string[]): string[] {
  const chosen = [...new Set(events)];
  if (chosen.length === 0) throw new ForbiddenError("Choose at least one event");
  for (const e of chosen) {
    if (!WEBHOOK_EVENTS.includes(e as (typeof WEBHOOK_EVENTS)[number])) throw new ForbiddenError(`Unknown event "${e}"`);
  }
  return WEBHOOK_EVENTS.filter((e) => chosen.includes(e));
}

async function ownKey(enterpriseId: string, keyId: string) {
  const key = await prisma.websiteApiKey.findFirst({ where: { id: keyId, enterpriseId } });
  if (!key) throw new ForbiddenError("API key not found");
  return key;
}

async function ownEndpoint(enterpriseId: string, id: string) {
  const endpoint = await prisma.apiWebhookEndpoint.findFirst({ where: { id, enterpriseId } });
  if (!endpoint) throw new ForbiddenError("Webhook not found");
  return endpoint;
}

export async function listWebhookEndpoints(enterpriseId: string, keyId: string) {
  await ownKey(enterpriseId, keyId);
  const rows = await prisma.apiWebhookEndpoint.findMany({ where: { keyId }, orderBy: { createdAt: "asc" } });
  return rows.map(shape);
}

export async function createWebhookEndpoint(params: { enterpriseId: string; keyId: string; url: string; events: string[] }) {
  const key = await ownKey(params.enterpriseId, params.keyId);
  if (key.status !== "ACTIVE") throw new ForbiddenError("A revoked key cannot have webhooks");
  if ((await prisma.apiWebhookEndpoint.count({ where: { keyId: key.id } })) >= MAX_ENDPOINTS_PER_KEY) {
    throw new ForbiddenError(`At most ${MAX_ENDPOINTS_PER_KEY} webhooks per key`);
  }
  const url = await assertSafeWebhookUrl(params.url);
  const { secret, secretEncrypted, secretPrefix } = newSecret();
  const row = await prisma.apiWebhookEndpoint.create({
    data: { enterpriseId: params.enterpriseId, keyId: key.id, url: url.toString(), events: normalizeEvents(params.events), secretEncrypted, secretPrefix },
  });
  return { secret, row: shape(row) };
}

export async function updateWebhookEndpoint(params: { enterpriseId: string; id: string; url?: string; events?: string[]; status?: "ACTIVE" | "DISABLED" }) {
  await ownEndpoint(params.enterpriseId, params.id);
  const row = await prisma.apiWebhookEndpoint.update({
    where: { id: params.id },
    data: {
      url: params.url === undefined ? undefined : (await assertSafeWebhookUrl(params.url)).toString(),
      events: params.events === undefined ? undefined : normalizeEvents(params.events),
      status: params.status,
      ...(params.status === "ACTIVE" ? { failureCount: 0 } : {}),
    },
  });
  return shape(row);
}

export async function rotateWebhookSecret(enterpriseId: string, id: string) {
  await ownEndpoint(enterpriseId, id);
  const { secret, secretEncrypted, secretPrefix } = newSecret();
  const row = await prisma.apiWebhookEndpoint.update({ where: { id }, data: { secretEncrypted, secretPrefix } });
  return { secret, row: shape(row) };
}

export async function deleteWebhookEndpoint(enterpriseId: string, id: string) {
  await ownEndpoint(enterpriseId, id);
  await prisma.apiWebhookEndpoint.delete({ where: { id } });
}

/** Queue and send a `ping` so an administrator can check the website receives and verifies it. */
export async function sendTestWebhook(enterpriseId: string, id: string) {
  const endpoint = await ownEndpoint(enterpriseId, id);
  const delivery = await prisma.apiWebhookDelivery.create({ data: { enterpriseId, endpointId: endpoint.id, event: "ping", payload: {} } });
  await prisma.apiWebhookDelivery.update({
    where: { id: delivery.id },
    data: { payload: { id: delivery.id, event: "ping", createdAt: delivery.createdAt.toISOString(), data: { message: "Webhook set up correctly." } } },
  });
  const outcome = await attemptDelivery(delivery.id);
  const after = await prisma.apiWebhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  return { outcome, statusCode: after.lastStatusCode, error: after.lastError };
}

export async function listWebhookDeliveries(enterpriseId: string, id: string) {
  await ownEndpoint(enterpriseId, id);
  const rows = await prisma.apiWebhookDelivery.findMany({ where: { endpointId: id }, orderBy: { createdAt: "desc" }, take: 25 });
  return rows.map((d) => ({
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: d.status === "PENDING" ? d.nextAttemptAt.toISOString() : null,
  }));
}
