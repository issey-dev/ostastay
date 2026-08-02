import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { testConnection } from "@/lib/channels/connection";

// Osta-console health check — identical semantics to the Hub's test route: gated on
// "update" because it mutates the connection and makes a real outbound call; always 200
// with the recorded state when the connection is reachable-but-failing (a health check
// reporting bad health has succeeded); doubles as the keep-alive that resets Beds24's
// idle clock. Under the master-account topology this is how the platform admin keeps
// EVERY tenant's credentials alive from one screen instead of touring the tenant Hubs.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "update");

    const existing = await prisma.channelConnection.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ connection: await testConnection(id) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
