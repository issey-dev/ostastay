import { NextResponse } from "next/server";
import { requireSession, requireEnterpriseHub, requirePermission, toErrorResponse } from "@/lib/scope";
import { sendTestWebhook } from "@/lib/website-api/webhooks";

/** Send a signed `ping` now and report what the website answered. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireEnterpriseHub(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");
    return NextResponse.json(await sendTestWebhook(ctx.enterpriseId, id));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
