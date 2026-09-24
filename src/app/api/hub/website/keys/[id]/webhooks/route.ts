import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireEnterpriseHub, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { createWebhookEndpoint, listWebhookEndpoints, WEBHOOK_EVENTS } from "@/lib/website-api/webhooks";

// Webhooks of one Booking API key — see src/lib/website-api/webhooks.ts. Same gates as the
// keys themselves: Hub access + INTEGRATIONS.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireEnterpriseHub(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");
    return NextResponse.json({ webhooks: await listWebhookEndpoints(ctx.enterpriseId, id), events: WEBHOOK_EVENTS });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

const createSchema = z.object({ url: z.string().trim().min(1).max(500), events: z.array(z.string()).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireEnterpriseHub(ctx);
    requirePermission(ctx, "INTEGRATIONS", "create");
    const data = createSchema.parse(await request.json());
    const { secret, row } = await createWebhookEndpoint({ enterpriseId: ctx.enterpriseId, keyId: id, url: data.url, events: data.events });
    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Added Booking API webhook ${row.url} (${row.events.join(", ")})`,
      entityType: "ApiWebhookEndpoint",
      entityId: row.id,
    });
    // The signing secret exists in plaintext only in this response.
    return NextResponse.json({ secret, row, warning: "Copy this signing secret now — it is shown only once." }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
