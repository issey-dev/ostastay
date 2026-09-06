import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { updateWebsiteApiKey, revokeWebsiteApiKey } from "@/lib/website-api/keys";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  propertyIds: z.array(z.string().min(1)).min(1).optional(),
  allowedOrigins: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** Edit a key's name, properties, origins or expiry. Never the key itself — see rotate. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const data = patchSchema.parse(await request.json());
    const row = await updateWebsiteApiKey({
      enterpriseId: ctx.enterpriseId,
      id,
      name: data.name,
      propertyIds: data.propertyIds,
      allowedOrigins: data.allowedOrigins,
      expiresAt: data.expiresAt === undefined ? undefined : data.expiresAt ? new Date(data.expiresAt) : null,
    });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Updated Website API key "${row.name}"`,
      entityType: "WebsiteApiKey",
      entityId: id,
    });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Revoke. Permanent; the row stays for the audit trail and its bookings keep their link. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "delete");

    const row = await revokeWebsiteApiKey({ enterpriseId: ctx.enterpriseId, id, userId: ctx.userId });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "DELETE",
      description: `Revoked Website API key "${row.name}"`,
      entityType: "WebsiteApiKey",
      entityId: id,
    });
    return NextResponse.json(row);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
