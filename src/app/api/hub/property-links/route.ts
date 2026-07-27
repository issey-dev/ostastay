import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listPropertyLinks, createPropertyLink } from "@/lib/channels/sharing";

// Sharing / mapping for the Hub — which properties a channel-manager connection covers.
// Every handler goes through requireHubAccess() as well as requirePermission(), the same
// rule as the rest of the Hub.
export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    // Properties that could still be linked — the UI needs this to offer a choice, and
    // computing it here keeps the "one property, one channel manager" rule in one place.
    const [links, allProperties] = await Promise.all([
      listPropertyLinks(ctx.enterpriseId),
      prisma.property.findMany({
        where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" },
        select: { id: true, name: true, channelLink: { select: { id: true } } },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      links,
      availableProperties: allProperties
        .filter((p) => !p.channelLink)
        .map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "create");

    const body = await request.json().catch(() => null);
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : "";
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    const externalPropertyId =
      typeof body?.externalPropertyId === "string" ? body.externalPropertyId.trim() : "";

    if (!connectionId || !propertyId) {
      return NextResponse.json({ error: "A connection and a property are required" }, { status: 400 });
    }
    if (!externalPropertyId) {
      return NextResponse.json({ error: "The channel manager's property ID is required" }, { status: 400 });
    }

    const link = await createPropertyLink({
      enterpriseId: ctx.enterpriseId,
      connectionId,
      propertyId,
      externalPropertyId,
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Linked a property to the channel manager (external id ${externalPropertyId})`,
      entityType: "ChannelPropertyLink",
      entityId: link.id,
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "That property, or that channel-manager property, is already linked" },
        { status: 409 }
      );
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
