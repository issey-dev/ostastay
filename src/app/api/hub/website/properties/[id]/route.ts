import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listWebsitePropertySettings, updateWebsitePropertySettings } from "@/lib/website-api/settings";

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
  publishedAddOnIds: z.array(z.string().max(64)).max(300).optional(),
  maxNightsAhead: z.number().int().optional(),
  minNights: z.number().int().optional(),
  deskRemark: z.string().max(500).nullable().optional(),
});

// One property's website configuration (what its brand site shows and sells) — see
// src/lib/website-api/settings.ts. Property Setup for that property, INTEGRATIONS
// (Hub > the property > Online Booking; HUB_SETUP_PLAN.md, Phase 4).

/** GET /api/hub/website/properties/{propertyId} — the property's website settings. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    await requirePropertySetup(ctx, id, "INTEGRATIONS", "view");
    const [row] = await listWebsitePropertySettings(ctx.enterpriseId, id);
    if (!row) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** PATCH /api/hub/website/properties/{propertyId} — upsert the property's website settings. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    await requirePropertySetup(ctx, id, "INTEGRATIONS", "update");

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
