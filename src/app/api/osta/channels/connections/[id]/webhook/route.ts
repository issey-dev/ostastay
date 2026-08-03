import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { generateWebhookToken, hashWebhookToken } from "@/lib/channels/webhook-token";

// Generate (or regenerate) a connection's inbound webhook URL from the Osta console.
//
// The platform-side twin of /api/hub/connections/[id]/webhook, and under the
// master-account topology the one that actually matters: the person who pastes this URL
// into Beds24's webhook settings is the app owner (who owns the Beds24 account), not the
// tenant — so minting it where that person works saves a support-grant round trip.
//
// Identical security posture to the Hub route, enforced by the same storage: only the
// SHA-256 hash is persisted (src/lib/channels/webhook-token.ts), so the plaintext in this
// response is the only copy that will ever exist. Regenerating is a ROTATION — the old
// URL 404s the moment the new hash lands, so it must be re-pasted into Beds24 promptly.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "update");

    const connection = await prisma.channelConnection.findUnique({
      where: { id },
      select: { id: true, enterpriseId: true, name: true, webhookTokenHash: true },
    });
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const token = generateWebhookToken();
    await prisma.channelConnection.update({
      where: { id },
      data: { webhookTokenHash: hashWebhookToken(token) },
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `${connection.webhookTokenHash ? "Regenerated" : "Generated"} the inbound webhook URL for "${connection.name}" — by Osta platform admin`,
      entityType: "ChannelConnection",
      entityId: id,
      targetEnterpriseId: connection.enterpriseId,
    });

    return NextResponse.json({
      // Relative on purpose — the caller knows its own public origin, and this endpoint
      // has no reliable way to know how the app is reached from outside.
      path: `/api/channels/webhook/${token}`,
      regenerated: !!connection.webhookTokenHash,
      warning: "Copy this now — it is shown only once.",
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
