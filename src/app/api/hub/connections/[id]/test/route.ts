import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { testConnection } from "@/lib/channels/connection";

// Exercise the stored credentials against Beds24 and record the outcome.
//
// Gated on "update" rather than "view": it mutates the connection (status, lastError,
// cached token, lastTokenRefreshAt) and makes a real outbound API call, so it is not a
// read. It also doubles as the keep-alive — a successful refresh resets Beds24's 30-day
// idle clock, which is what stops an unused connection dying silently.
//
// Always 200 with the connection's new state on a reachable-but-failing connection: "the
// credentials are rejected" is a successful health CHECK reporting bad health, and the UI
// needs the recorded lastError to show. Only auth/permission problems with the ostastay
// request itself are error statuses.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const existing = await prisma.channelConnection.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ connection: await testConnection(id) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
