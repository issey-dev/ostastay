import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listWebsiteApiKeys, createWebsiteApiKey } from "@/lib/website-api/keys";

// Website API keys for the Hub — see .agents/docs/WEBSITE_API_PLAN.md. Every handler goes
// through requireHubAccess() as well as requirePermission(), the same rule as the rest of
// the Hub. Gated on INTEGRATIONS: a website is an integration, and the people who manage
// the channel manager are the people who manage this.

export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const [keys, properties] = await Promise.all([
      listWebsiteApiKeys(ctx.enterpriseId),
      prisma.property.findMany({
        where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return NextResponse.json({ keys, properties });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  propertyIds: z.array(z.string().min(1)).min(1),
  allowedOrigins: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "create");

    const data = createSchema.parse(await request.json());
    const { key, row } = await createWebsiteApiKey({
      enterpriseId: ctx.enterpriseId,
      userId: ctx.userId,
      name: data.name,
      propertyIds: data.propertyIds,
      allowedOrigins: data.allowedOrigins,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Created Website API key "${row.name}" for ${row.properties.map((p) => p.name).join(", ")}`,
      entityType: "WebsiteApiKey",
      entityId: row.id,
    });

    // The plaintext exists only in this response — see src/lib/website-api/key.ts.
    return NextResponse.json({ key, row, warning: "Copy this key now — it is shown only once." }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
