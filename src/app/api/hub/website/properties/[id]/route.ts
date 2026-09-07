import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { updateWebsitePropertySettings } from "@/lib/website-api/settings";

const patchSchema = z.object({
  headline: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  imageUrls: z.array(z.string().max(2000)).max(30).optional(),
  policies: z.string().max(5000).nullable().optional(),
  bookingEnabled: z.boolean().optional(),
  ratePlanId: z.string().nullable().optional(),
  mealPlanCode: z.string().max(40).optional(),
  offerMealPlans: z.boolean().optional(),
  offerAddOns: z.boolean().optional(),
  maxNightsAhead: z.number().int().optional(),
  minNights: z.number().int().optional(),
  deskRemark: z.string().max(500).nullable().optional(),
});

/** PATCH /api/hub/website/properties/{propertyId} — upsert the property's website settings. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const input = patchSchema.parse(await request.json());
    const row = await updateWebsitePropertySettings({ enterpriseId: ctx.enterpriseId, propertyId: id, input });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Updated website settings for "${row.property.name}"`,
      entityType: "WebsitePropertySettings",
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
