import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { generateWebhookToken, hashWebhookToken } from "@/lib/channels/webhook-token";

// Generate (or regenerate) this connection's inbound webhook URL.
//
// The token is a credential: anyone holding the URL can post bookings into the enterprise.
// It is therefore returned ONCE, at the moment it is created, and never again — the same
// posture as the channel-manager credentials themselves. If it is lost, regenerate.
//
// "Never again" is now enforced by the storage rather than by this route's restraint:
// only the SHA-256 hash is written, so no code path — and no database dump — can produce
// the plaintext after this response. A lost URL genuinely cannot be recovered, only
// replaced, which also means regenerating REQUIRES re-pasting the new URL into the
// channel manager.
//
// POST rather than GET because it MINTS a secret: a GET that silently rotates a credential
// on every page load would be both surprising and dangerous.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const connection = await prisma.channelConnection.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true, name: true, webhookTokenHash: true },
    });
    if (!connection || connection.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // 32 bytes of randomness, hex-encoded. This is the whole of the webhook's security, so
    // it is sized as a real secret rather than a convenient short id. Only its hash is
    // persisted; `token` below is the only time the plaintext exists outside the request
    // that will carry it to the operator.
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
      // Relative on purpose — the caller knows its own public origin, and this endpoint has
      // no reliable way to know how the app is reached from outside.
      path: `/api/channels/webhook/${token}`,
      regenerated: !!connection.webhookTokenHash,
      warning: "Copy this now — it is shown only once.",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
