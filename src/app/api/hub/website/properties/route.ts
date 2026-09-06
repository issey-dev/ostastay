import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { listWebsitePropertySettings } from "@/lib/website-api/settings";

// Per-property website configuration (what the brand site shows and sells) — see
// src/lib/website-api/settings.ts. Same Hub gating as the keys routes.
export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const properties = await listWebsitePropertySettings(ctx.enterpriseId);
    return NextResponse.json({ properties });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
