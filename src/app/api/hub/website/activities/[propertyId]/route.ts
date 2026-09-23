import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { updateActivityModuleSettings } from "@/lib/website-api/activity-settings";

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

/** A property's online-sale settings for one module (Excursions or Spa). */
export async function PATCH(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

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
