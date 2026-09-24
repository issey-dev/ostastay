import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listActivitySettings, updateActivityModuleSettings } from "@/lib/website-api/activity-settings";

const patchSchema = z.object({
  module: z.enum(["EXCURSIONS", "SPA"]),
  enabled: z.boolean().optional(),
  holdMinutes: z.number().int().optional(),
  leadHours: z.number().int().optional(),
  maxPartySize: z.number().int().nullable().optional(),
  offerGenderPreference: z.boolean().optional(),
  onlinePaymentMethodId: z.string().nullable().optional(),
  deskRemark: z.string().nullable().optional(),
  policies: z.string().nullable().optional(),
});

// What one property sells online for Excursions and Spa through the Booking API — see
// src/lib/website-api/activity-settings.ts. Property Setup for that property, INTEGRATIONS.

/** GET — the property's online-sale settings for every module the enterprise holds. */
export async function GET(_request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await params;
    const ctx = await requireSession();
    await requirePropertySetup(ctx, propertyId, "INTEGRATIONS", "view");
    return NextResponse.json(await listActivitySettings(ctx.enterpriseId, propertyId));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** A property's online-sale settings for one module (Excursions or Spa). */
export async function PATCH(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await params;
    const ctx = await requireSession();
    await requirePropertySetup(ctx, propertyId, "INTEGRATIONS", "update");

    const { module, ...input } = patchSchema.parse(await request.json());
    const settings = await updateActivityModuleSettings({ enterpriseId: ctx.enterpriseId, propertyId, module, input });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Updated online ${module === "SPA" ? "Spa" : "Excursions"} settings${
        input.enabled === undefined ? "" : input.enabled ? " — selling online" : " — not selling online"
      }`,
      entityType: "ActivityOnlineSettings",
      entityId: propertyId,
    });
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
