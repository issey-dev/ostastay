import { NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity-log";
import { removeRegistration } from "@/lib/green-tax-registry";
import { greenTaxContext, greenTaxError } from "../_shared";

const schema = z.object({ propertyId: z.string(), registrationId: z.string(), reason: z.string().max(500) });

/** POST /api/hub/green-tax/remove — take a wrongly given Reg No away; later numbers move down by one. */
export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const { ctx, propertyId, propertyName } = await greenTaxContext("update", body.propertyId);
    const c = await removeRegistration({ propertyId, registrationId: body.registrationId, reason: body.reason, userId: ctx.userId });
    await logActivity({
      ctx, module: "GREEN_TAX", action: "DELETE", entityType: "GuestRegistration", entityId: body.registrationId,
      description: `Removed Green Tax Reg No ${c.registrationNo}/${c.year} (${c.guestName ?? "guest"}, ${c.confirmationNo ?? ""}) at ${propertyName}` +
        (c.shiftFrom ? ` — Nos ${c.shiftFrom}–${c.shiftTo} renumbered down by one` : "") + `. Reason: ${c.reason}`,
    });
    return NextResponse.json(c);
  } catch (error) {
    return greenTaxError(error);
  }
}
