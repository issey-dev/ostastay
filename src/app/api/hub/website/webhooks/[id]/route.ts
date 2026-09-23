import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { deleteWebhookEndpoint, updateWebhookEndpoint } from "@/lib/website-api/webhooks";

const patchSchema = z.object({
  url: z.string().trim().min(1).max(500).optional(),
  events: z.array(z.string()).min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

/** Change a webhook's URL or events, or switch it off/on (on also clears its failure count). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");
    const data = patchSchema.parse(await request.json());
    const row = await updateWebhookEndpoint({ enterpriseId: ctx.enterpriseId, id, ...data });
    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Updated Booking API webhook ${row.url}${data.status ? ` — ${data.status === "ACTIVE" ? "on" : "off"}` : ""}`,
      entityType: "ApiWebhookEndpoint",
      entityId: id,
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "delete");
    await deleteWebhookEndpoint(ctx.enterpriseId, id);
    await logActivity({ ctx, module: "INTEGRATIONS", action: "DELETE", description: "Removed a Booking API webhook", entityType: "ApiWebhookEndpoint", entityId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
