import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { computeChannelAvailability, resolveWindow } from "@/lib/channels/sync";

// What WOULD be published for this link — computed, never sent.
//
// Read-only and gated on "view": this makes no outbound call and changes nothing. It exists
// so the numbers can be checked against a real property before sharing is switched on,
// which is the only cheap moment to catch a mapping mistake. Afterwards, the OTAs find it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const { searchParams } = new URL(request.url);
    const days = Number.parseInt(searchParams.get("days") ?? "14", 10);
    const { from, to } = resolveWindow(searchParams.get("from"), Number.isFinite(days) ? days : 14);

    const plan = await computeChannelAvailability({ enterpriseId: ctx.enterpriseId, linkId: id, from, to });
    return NextResponse.json(plan);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
