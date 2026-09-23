import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireEnterpriseHub, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { updateActivityItem } from "@/lib/website-api/activity-settings";

const patchSchema = z.object({
  module: z.enum(["EXCURSIONS", "SPA"]),
  publishOnline: z.boolean().optional(),
  publicDescription: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional(),
  inclusions: z.string().nullable().optional(),
});

/** Publish an excursion type / spa treatment to the Booking API, and its guest-facing copy. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireEnterpriseHub(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const { module, ...input } = patchSchema.parse(await request.json());
    const result = await updateActivityItem({ enterpriseId: ctx.enterpriseId, module, itemId: id, input });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `${
        input.publishOnline === undefined ? "Updated online details of" : input.publishOnline ? "Published online:" : "Withdrew from online sale:"
      } ${module === "SPA" ? "treatment" : "excursion"} "${result.item.name}"`,
      entityType: module === "SPA" ? "SpaTreatment" : "ExcursionType",
      entityId: id,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
