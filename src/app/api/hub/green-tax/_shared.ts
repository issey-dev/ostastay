import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ForbiddenError, requirePropertySetup, requireSession, toErrorResponse, type AuthContext } from "@/lib/scope";
import { GreenTaxError } from "@/lib/green-tax-registry";
import type { Action } from "@/lib/modules";

// Every /api/hub/green-tax route: the register is one PROPERTY's (Hub > the property >
// Green Tax), so the caller needs Property Setup for the property named in the request —
// the GREEN_TAX permission, and that property must be theirs to set up (a single-property
// admin reaches only their own). The Hub has no ambient current property.
export async function greenTaxContext(action: Action, propertyId: unknown): Promise<{ ctx: AuthContext; propertyId: string; propertyName: string }> {
  const ctx = await requireSession();
  const id = typeof propertyId === "string" ? propertyId : "";
  if (!id) throw new ForbiddenError("Property not found in this enterprise");
  await requirePropertySetup(ctx, id, "GREEN_TAX", action);
  const property = await prisma.property.findFirst({ where: { id, enterpriseId: ctx.enterpriseId }, select: { id: true, name: true } });
  if (!property) throw new ForbiddenError("Property not found in this enterprise");
  return { ctx, propertyId: property.id, propertyName: property.name };
}

export function greenTaxError(error: unknown) {
  if (error instanceof GreenTaxError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
