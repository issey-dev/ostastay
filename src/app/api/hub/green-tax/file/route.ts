import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { fileMonth, monthName } from "@/lib/green-tax-registry";
import { greenTaxContext, greenTaxError } from "../_shared";

const schema = z.object({ propertyId: z.string(), year: z.number().int(), month: z.number().int(), note: z.string().max(500).nullable().optional() });

/** POST /api/hub/green-tax/file — mark a month as submitted to MIRA; its numbers are frozen from then on. */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const { ctx, propertyId, propertyName } = await greenTaxContext("update", body.propertyId);
    const f = await fileMonth({ propertyId, year: body.year, month: body.month, userId: ctx.userId, note: body.note });
    await logActivity({
      ctx, module: "GREEN_TAX", action: "CREATE", entityType: "GreenTaxFiling", entityId: f.id,
      description: `Marked Green Tax ${monthName(f.month)} ${f.year} as filed with MIRA for ${propertyName}`,
    });
    return NextResponse.json(f);
  } catch (error) {
    return greenTaxError(error);
  }
}
