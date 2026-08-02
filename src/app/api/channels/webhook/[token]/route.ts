import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestBookings } from "@/lib/channels/inbound/ingest";
import { redactForLog } from "@/lib/channels/redact";
import { getProvider } from "@/lib/channels/providers/registry";
import { hashWebhookToken } from "@/lib/channels/webhook-token";

// Inbound booking webhook — the channel manager calling US.
//
// Not a session route: the caller is Beds24, not a user, so requireSession() has nothing to
// check. It is authenticated by a per-connection secret embedded in the URL, which the
// operator copies into Beds24's webhook settings.
//
// A URL secret rather than a payload signature DELIBERATELY: Beds24's signing scheme is not
// publicly documented, so building signature verification would mean guessing at a security
// mechanism — the one place a guess is least acceptable. A high-entropy URL secret is
// verifiable today and works regardless of what signing Beds24 does or does not offer. If a
// documented signature scheme turns out to exist, it should be added ON TOP of this.
//
// The secret is stored ONLY as a SHA-256 hash (see src/lib/channels/webhook-token.ts), so
// this route hashes what arrives and looks the connection up by that. A database dump
// therefore yields hashes, not working webhook URLs.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const startedAt = Date.now();
  const { token } = await params;

  // The lookup IS the authentication: a row only comes back when the stored hash equals
  // the hash of the token just presented. Nothing further to compare — see the closing
  // note in src/lib/channels/webhook-token.ts for why the old post-lookup timing-safe
  // compare is not merely redundant here but tautological.
  const connection = token
    ? await prisma.channelConnection.findUnique({
        where: { webhookTokenHash: hashWebhookToken(token) },
        select: { id: true, enterpriseId: true, name: true, provider: true },
      })
    : null;

  if (!connection) {
    // Deliberately terse and identical for a bad token and an unknown one — a webhook URL
    // is a credential, and a distinguishable response would let it be probed.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const provider = getProvider(connection.provider);
  const bookings = provider.extractBookings(body);
  const results =
    bookings.length > 0
      ? await ingestBookings({
          enterpriseId: connection.enterpriseId,
          connectionId: connection.id,
          bookings,
          source: "WEBHOOK",
          parse: provider.parseBooking,
          isCancelled: provider.isCancelledStatus,
        })
      : [];

  // The first thing in this integration to write an INBOUND log entry — until now the
  // Exchange Log's inbound filter could never match anything.
  //
  // Redacted like everything else in that table. A booking payload carries guest details
  // rather than credentials, but the redactor is deny-by-default and this keeps one rule
  // rather than two.
  await prisma.channelSyncLog
    .create({
      data: {
        enterpriseId: connection.enterpriseId,
        connectionId: connection.id,
        connectionName: connection.name,
        direction: "INBOUND",
        operation: "booking.webhook",
        endpoint: "/api/channels/webhook",
        ok: true,
        httpStatus: 200,
        latencyMs: Date.now() - startedAt,
        requestSummary: redactForLog(body),
        responseSummary: redactForLog({
          received: bookings.length,
          created: results.filter((r) => r.status === "CREATED").length,
          updated: results.filter((r) => r.status === "UPDATED").length,
          rejected: results.filter((r) => r.status === "REJECTED").length,
          overbookings: results.filter((r) => r.isOverbooking).length,
        }),
        errorMessage: null,
      },
    })
    .catch((e) => console.error("could not log inbound webhook", e));

  // Always 200 once authenticated, even when a booking could not be understood.
  //
  // A channel manager retries on a non-2xx, and retrying will not fix an unmapped room or a
  // malformed payload — it would just redeliver the same thing forever while the real
  // problem sits unseen. The booking IS stored with its problem noted, so nothing is lost;
  // the operator resolves it in the Hub rather than the channel hammering the endpoint.
  return NextResponse.json({
    ok: true,
    received: bookings.length,
    stored: results.filter((r) => r.status !== "REJECTED").length,
  });
}
