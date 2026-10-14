import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { authorizeConnection } from "@/lib/channels/hub-access";
import { generateWebhookToken, hashWebhookToken } from "@/lib/channels/webhook-token";

// Generate (or regenerate) the connection's inbound webhook URL. The enterprise pastes it
// into its own Beds24 account (Settings → Properties → Access → Booking webhooks), so it
// mints it here — the same job the Osta console route does for a managed connection.
//
// Only the SHA-256 hash is persisted (src/lib/channels/webhook-token.ts): the plaintext in
// this response is the only copy that will ever exist. Regenerating is a ROTATION — the old
// URL 404s the moment the new hash lands, so it must be re-pasted into Beds24 promptly.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    const connection = await authorizeConnection(ctx, id, "update");

    const token = generateWebhookToken();
    await prisma.channelConnection.update({
      where: { id },
      data: { webhookTokenHash: hashWebhookToken(token) },
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `${connection.webhookTokenHash ? "Regenerated" : "Generated"} the inbound webhook URL for "${connection.name}"`,
      entityType: "ChannelConnection",
      entityId: id,
    });

    return NextResponse.json({
      // Relative on purpose — the caller knows its own public origin.
      path: `/api/channels/webhook/${token}`,
      regenerated: !!connection.webhookTokenHash,
      warning: "Copy this now — it is shown only once.",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
