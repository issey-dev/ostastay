import { prisma } from "@/lib/db";
import { authHeader, toConnectionError } from "@/lib/channels/beds24";
import { getValidAccessToken, makeLogSink } from "@/lib/channels/connection";
import { extractBookings } from "@/lib/channels/inbound/parse";
import { ingestBookings } from "@/lib/channels/inbound/ingest";
import { redactForLog } from "@/lib/channels/redact";

// The polling half of inbound.
//
// Webhooks are the fast path; this is the safety net. Beds24 itself endorses using both,
// and the reason is simple: a webhook that is never delivered leaves no trace anywhere. A
// missed booking is a guest arriving to a room nobody knows about, which is exactly the
// failure that must not depend on a single delivery succeeding.
//
// Deliberately re-reads an OVERLAPPING window rather than tracking a high-water mark. The
// overlap costs nothing because ingestion is idempotent on the channel's booking id, and it
// covers the cases a watermark misses: clock skew between systems, a booking modified after
// it was first seen, and anything that arrived during a deployment.

const BEDS24_API_BASE = process.env.BEDS24_API_BASE_URL ?? "https://beds24.com/api/v2";

/** How far back each poll looks. Generous on purpose — see the note above. */
export const POLL_LOOKBACK_HOURS = 48;

export type PollResult = {
  connectionId: string;
  connectionName: string;
  status: "POLLED" | "SKIPPED" | "FAILED";
  reason?: string;
  received: number;
  created: number;
  updated: number;
  overbookings: number;
};

/**
 * Poll one connection for recent bookings.
 *
 * ⚠️ The query parameter and response shape are NOT verified against a live account (see
 * src/lib/channels/inbound/parse.ts). extractBookings() accepts several plausible envelopes
 * for that reason, and the raw response is logged so the real shape is recoverable.
 */
export async function pollConnection(connectionId: string): Promise<PollResult> {
  const connection = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, enterpriseId: true, name: true, refreshToken: true },
  });
  if (!connection) throw new Error("Connection not found");

  const base = { connectionId, connectionName: connection.name, received: 0, created: 0, updated: 0, overbookings: 0 };

  if (!connection.refreshToken) {
    return { ...base, status: "SKIPPED", reason: "Connection has no credentials" };
  }

  const sink = makeLogSink({
    enterpriseId: connection.enterpriseId,
    connectionName: connection.name,
    connectionId: connection.id,
  });
  const since = new Date(Date.now() - POLL_LOOKBACK_HOURS * 60 * 60 * 1000);
  const startedAt = Date.now();

  try {
    const accessToken = await getValidAccessToken(connection.id);
    const url = `${BEDS24_API_BASE}/bookings?modifiedSince=${encodeURIComponent(since.toISOString())}`;

    const res = await fetch(url, { method: "GET", headers: authHeader(accessToken) });
    const body = await res.json().catch(() => null);

    await prisma.channelSyncLog
      .create({
        data: {
          enterpriseId: connection.enterpriseId,
          connectionId: connection.id,
          connectionName: connection.name,
          direction: "INBOUND",
          operation: "booking.poll",
          endpoint: "/bookings",
          ok: res.ok,
          httpStatus: res.status,
          latencyMs: Date.now() - startedAt,
          requestSummary: redactForLog({ modifiedSince: since.toISOString() }),
          responseSummary: redactForLog(body),
          errorMessage: res.ok ? null : `Poll failed (HTTP ${res.status})`,
        },
      })
      .catch((e) => console.error("could not log poll", e));

    if (!res.ok) {
      return { ...base, status: "FAILED", reason: `Beds24 returned HTTP ${res.status}` };
    }

    const bookings = extractBookings(body);
    const results = await ingestBookings({
      enterpriseId: connection.enterpriseId,
      connectionId: connection.id,
      bookings,
      source: "POLL",
    });

    return {
      ...base,
      status: "POLLED",
      received: bookings.length,
      created: results.filter((r) => r.status === "CREATED").length,
      updated: results.filter((r) => r.status === "UPDATED").length,
      overbookings: results.filter((r) => r.isOverbooking).length,
    };
  } catch (e) {
    // Never rethrows — one unreachable connection must not stop the sweep.
    void sink;
    return { ...base, status: "FAILED", reason: toConnectionError(e) };
  }
}

/** Poll every credentialled connection for one enterprise. */
export async function pollAllConnections(enterpriseId: string): Promise<PollResult[]> {
  const connections = await prisma.channelConnection.findMany({
    where: { enterpriseId, refreshToken: { not: null } },
    select: { id: true },
  });

  const results: PollResult[] = [];
  for (const c of connections) {
    results.push(await pollConnection(c.id));
  }
  return results;
}
