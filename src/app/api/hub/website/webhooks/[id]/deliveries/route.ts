import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { listWebhookDeliveries } from "@/lib/website-api/webhooks";

/** The latest deliveries of a webhook, newest first — what went out and what came back. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");
    return NextResponse.json({ deliveries: await listWebhookDeliveries(ctx.enterpriseId, id) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
