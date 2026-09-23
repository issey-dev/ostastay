import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { rotateWebhookSecret } from "@/lib/website-api/webhooks";

/** New signing secret; deliveries are signed with it from now on. Shown once. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");
    const { secret, row } = await rotateWebhookSecret(ctx.enterpriseId, id);
    await logActivity({ ctx, module: "INTEGRATIONS", action: "UPDATE", description: `Rotated the signing secret of webhook ${row.url}`, entityType: "ApiWebhookEndpoint", entityId: id });
    return NextResponse.json({ secret, row, warning: "Copy this signing secret now — it is shown only once." });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
