import { NextResponse } from "next/server";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { listPropertyLinks } from "@/lib/channels/sharing";
import { authorizePropertyParam } from "@/lib/channels/hub-access";

// A property's channel-manager link and its mapping — see src/lib/channels/hub-access.ts.
// ?propertyId= is required; the caller needs Property Setup (INTEGRATIONS) there.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = await authorizePropertyParam(ctx, request, "view");
    const [link] = await listPropertyLinks(ctx.enterpriseId, propertyId);
    return NextResponse.json({ link: link ?? null });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Linking a property is part of CONNECTING it, which Uppsolut does from the Osta console
// (one connection per property, created together with its link — owner, 2026-09-23).
// Refused here rather than only hidden in the Hub UI.
export async function POST() {
  return NextResponse.json(
    { error: "A property is linked to the channel manager when Uppsolut connects it. Contact Uppsolut to connect a property." },
    { status: 403 }
  );
}
