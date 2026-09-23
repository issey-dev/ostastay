import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ForbiddenError, requireHubAccess, requirePermission, requireSession, toErrorResponse, type AuthContext } from "@/lib/scope";
import { GreenTaxError } from "@/lib/green-tax-registry";
import type { Action } from "@/lib/modules";

// Every /api/hub/green-tax route: Hub access + the GREEN_TAX permission, and the
// property named in the request must belong to the caller's enterprise (the Hub has no
// ambient current property — see the Hub layout).
export async function greenTaxContext(action: Action, propertyId: unknown): Promise<{ ctx: AuthContext; propertyId: string; propertyName: string }> {
  const ctx = await requireSession();
  requireHubAccess(ctx);
  requirePermission(ctx, "GREEN_TAX", action);
  const id = typeof propertyId === "string" ? propertyId : "";
  const property = id ? await prisma.property.findFirst({ where: { id, enterpriseId: ctx.enterpriseId }, select: { id: true, name: true } }) : null;
  if (!property) throw new ForbiddenError("Property not found in this enterprise");
  return { ctx, propertyId: property.id, propertyName: property.name };
}

export function greenTaxError(error: unknown) {
  if (error instanceof GreenTaxError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues }, { status: 400 });
  const { status, body } = toErrorResponse(error);
  return NextResponse.json(body, { status });
}
