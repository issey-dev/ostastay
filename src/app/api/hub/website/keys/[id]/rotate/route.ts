import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { rotateWebsiteApiKey } from "@/lib/website-api/keys";

// Rotate a key: same row, new secret. The old plaintext stops working the moment this
// commits, so the website's configuration must be updated promptly — the Hub says so.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const { key, row } = await rotateWebsiteApiKey({ enterpriseId: ctx.enterpriseId, id });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Rotated Website API key "${row.name}" — the previous key no longer works`,
      entityType: "WebsiteApiKey",
      entityId: id,
    });
    return NextResponse.json({ key, row, warning: "Copy this key now — it is shown only once. The previous key has stopped working." });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
