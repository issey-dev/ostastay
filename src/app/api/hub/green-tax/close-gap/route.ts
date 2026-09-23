import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { closeGap } from "@/lib/green-tax-registry";
import { greenTaxContext, greenTaxError } from "../_shared";

const schema = z.object({ propertyId: z.string(), year: z.number().int(), registrationNo: z.number().int(), reason: z.string().max(500) });

/** POST /api/hub/green-tax/close-gap — renumber the numbers above a missing one down by one. */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const { ctx, propertyId, propertyName } = await greenTaxContext("update", body.propertyId);
    const c = await closeGap({ propertyId, year: body.year, registrationNo: body.registrationNo, reason: body.reason, userId: ctx.userId });
    await logActivity({
      ctx, module: "GREEN_TAX", action: "UPDATE", entityType: "GreenTaxCorrection", entityId: c.id,
      description: `Closed the gap at Green Tax Reg No ${c.registrationNo}/${c.year} at ${propertyName} — Nos ${c.shiftFrom}–${c.shiftTo} renumbered down by one. Reason: ${c.reason}`,
    });
    return NextResponse.json(c);
  } catch (error) {
    return greenTaxError(error);
  }
}
